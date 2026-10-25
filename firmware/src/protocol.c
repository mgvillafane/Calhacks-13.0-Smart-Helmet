#include "protocol.h"

static int reject_null(const void *value) {
    return value == NULL ? -1 : 0;
}

int encode_cue(const Cue *cue, uint8_t out[CUE_PACKET_LEN]) {
    if (reject_null(cue) || reject_null(out)) {
        return -1;
    }
    if (cue->direction > DIRECTION_UTURN) {
        return -1;
    }
    if ((cue->flags & ~(FLAG_ARRIVED | FLAG_OFF_ROUTE | FLAG_REROUTING)) != 0) {
        return -1;
    }
    out[0] = PROTOCOL_VERSION;
    out[1] = cue->direction;
    out[2] = cue->intensity;
    out[3] = (uint8_t)(cue->pulse_period_ms & 0xFFu);
    out[4] = (uint8_t)((cue->pulse_period_ms >> 8) & 0xFFu);
    out[5] = (uint8_t)(cue->distance_m & 0xFFu);
    out[6] = (uint8_t)((cue->distance_m >> 8) & 0xFFu);
    out[7] = cue->flags;
    return 0;
}

int decode_cue(const uint8_t *packet, size_t length, Cue *out) {
    if (reject_null(packet) || reject_null(out) || length != CUE_PACKET_LEN) {
        return -1;
    }
    if (packet[0] != PROTOCOL_VERSION || packet[1] > DIRECTION_UTURN) {
        return -1;
    }
    if ((packet[7] & ~(FLAG_ARRIVED | FLAG_OFF_ROUTE | FLAG_REROUTING)) != 0) {
        return -1;
    }
    out->direction = packet[1];
    out->intensity = packet[2];
    out->pulse_period_ms = (uint16_t)(packet[3] | ((uint16_t)packet[4] << 8));
    out->distance_m = (uint16_t)(packet[5] | ((uint16_t)packet[6] << 8));
    out->flags = packet[7];
    return 0;
}

int encode_helmet_state(const HelmetState *state, uint8_t out[HELMET_STATE_PACKET_LEN]) {
    if (reject_null(state) || reject_null(out)) {
        return -1;
    }
    if ((state->buttons & ~(BUTTON_MODE | BUTTON_SOS | BUTTON_TALK)) != 0) {
        return -1;
    }
    if (state->heading_valid) {
        if (state->heading_decidegrees > 3599) {
            return -1;
        }
    } else if (state->heading_decidegrees != HEADING_INVALID) {
        return -1;
    }
    out[0] = (uint8_t)(state->heading_decidegrees & 0xFFu);
    out[1] = (uint8_t)((state->heading_decidegrees >> 8) & 0xFFu);
    out[2] = state->heading_valid ? 1u : 0u;
    out[3] = state->buttons;
    return 0;
}

int decode_helmet_state(const uint8_t *packet, size_t length, HelmetState *out) {
    uint16_t heading;
    if (reject_null(packet) || reject_null(out) || length != HELMET_STATE_PACKET_LEN) {
        return -1;
    }
    if (packet[2] > 1u || (packet[3] & ~(BUTTON_MODE | BUTTON_SOS | BUTTON_TALK)) != 0) {
        return -1;
    }
    heading = (uint16_t)(packet[0] | ((uint16_t)packet[1] << 8));
    if (packet[2] == 1u) {
        if (heading > 3599) {
            return -1;
        }
    } else if (heading != HEADING_INVALID) {
        return -1;
    }
    out->heading_decidegrees = heading;
    out->heading_valid = packet[2] == 1u;
    out->buttons = packet[3];
    return 0;
}

static void put_i16(uint8_t *out, int16_t value) {
    uint16_t raw = (uint16_t)value;
    out[0] = (uint8_t)(raw & 0xFFu);
    out[1] = (uint8_t)((raw >> 8) & 0xFFu);
}

static int16_t get_i16(const uint8_t *packet) {
    return (int16_t)(uint16_t)(packet[0] | ((uint16_t)packet[1] << 8));
}

int encode_sensor_sample(const SensorSample *sample, uint8_t out[SENSOR_PACKET_LEN]) {
    uint8_t flags;
    if (reject_null(sample) || reject_null(out)) {
        return -1;
    }
    flags = 0;
    if (sample->imu_ok) {
        flags |= FLAG_IMU_OK;
    }
    if (sample->mic_ok) {
        flags |= FLAG_MIC_OK;
    }
    out[0] = PROTOCOL_VERSION;
    out[1] = flags;
    put_i16(out + 2, sample->ax_mg);
    put_i16(out + 4, sample->ay_mg);
    put_i16(out + 6, sample->az_mg);
    put_i16(out + 8, sample->gx_dps10);
    put_i16(out + 10, sample->gy_dps10);
    put_i16(out + 12, sample->gz_dps10);
    put_i16(out + 14, sample->mic_peak);
    out[16] = 0;
    out[17] = 0;
    out[18] = 0;
    out[19] = 0;
    return 0;
}

int decode_sensor_sample(const uint8_t *packet, size_t length, SensorSample *out) {
    if (reject_null(packet) || reject_null(out) || length != SENSOR_PACKET_LEN) {
        return -1;
    }
    if (packet[0] != PROTOCOL_VERSION || (packet[1] & ~(FLAG_IMU_OK | FLAG_MIC_OK)) != 0) {
        return -1;
    }
    out->imu_ok = (packet[1] & FLAG_IMU_OK) != 0;
    out->mic_ok = (packet[1] & FLAG_MIC_OK) != 0;
    out->ax_mg = get_i16(packet + 2);
    out->ay_mg = get_i16(packet + 4);
    out->az_mg = get_i16(packet + 6);
    out->gx_dps10 = get_i16(packet + 8);
    out->gy_dps10 = get_i16(packet + 10);
    out->gz_dps10 = get_i16(packet + 12);
    out->mic_peak = get_i16(packet + 14);
    return 0;
}

#define ULAW_BIAS 0x84
#define ULAW_CLIP 32635

uint8_t ulaw_encode(int16_t sample) {
    int32_t magnitude = sample;
    uint8_t sign = 0;
    uint8_t exponent = 7;
    int32_t mask = 0x4000;
    if (magnitude < 0) {
        sign = 0x80u;
        magnitude = -magnitude;
    }
    if (magnitude > ULAW_CLIP) {
        magnitude = ULAW_CLIP;
    }
    magnitude += ULAW_BIAS;
    while (exponent > 0 && (magnitude & mask) == 0) {
        exponent -= 1;
        mask >>= 1;
    }
    return (uint8_t)~(sign | (exponent << 4) | ((magnitude >> (exponent + 3)) & 0x0F));
}

int16_t ulaw_decode(uint8_t value) {
    uint8_t bits = (uint8_t)~value;
    int32_t magnitude = ((((int32_t)(bits & 0x0Fu) << 3) + ULAW_BIAS) << ((bits >> 4) & 0x07u)) - ULAW_BIAS;
    return (int16_t)((bits & 0x80u) != 0 ? -magnitude : magnitude);
}

int encode_audio_packet(uint8_t sequence, const int16_t *samples, size_t count, uint8_t *out) {
    if (reject_null(samples) || reject_null(out) || count == 0 || count > AUDIO_MAX_SAMPLES) {
        return -1;
    }
    out[0] = PROTOCOL_VERSION;
    out[1] = sequence;
    for (size_t index = 0; index < count; index += 1) {
        out[AUDIO_HEADER_LEN + index] = ulaw_encode(samples[index]);
    }
    return (int)(AUDIO_HEADER_LEN + count);
}
