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
    if ((state->buttons & ~(BUTTON_MODE | BUTTON_SOS)) != 0) {
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
    if (packet[2] > 1u || (packet[3] & ~(BUTTON_MODE | BUTTON_SOS)) != 0) {
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
