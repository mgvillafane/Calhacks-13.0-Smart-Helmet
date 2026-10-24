#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Phone is the BLE central. The ESP32-S3 peripheral is named SmartHelmet.
 * Cue is written by the phone. Helmet state is notified by the ESP32.
 * Multi-byte fields are little-endian. Return 0 on success, -1 on reject.
 */

#define PROTOCOL_VERSION 1

#define CUE_PACKET_LEN 8
#define HELMET_STATE_PACKET_LEN 4
#define SENSOR_PACKET_LEN 20

#define DIRECTION_NONE 0
#define DIRECTION_LEFT 1
#define DIRECTION_FRONT 2
#define DIRECTION_RIGHT 3
#define DIRECTION_UTURN 4

#define FLAG_ARRIVED 0x01u
#define FLAG_OFF_ROUTE 0x02u
#define FLAG_REROUTING 0x04u

#define BUTTON_MODE 0x01u
#define BUTTON_SOS 0x02u

#define FLAG_IMU_OK 0x01u
#define FLAG_MIC_OK 0x02u

#define HEADING_INVALID 0xFFFFu

#define DEVICE_NAME "SmartHelmet"
#define SERVICE_UUID "7c1a0001-5e2b-4a6d-8f10-9b3c4d5e6f70"
#define CUE_CHARACTERISTIC_UUID "7c1a0002-5e2b-4a6d-8f10-9b3c4d5e6f70"
#define HELMET_STATE_CHARACTERISTIC_UUID "7c1a0003-5e2b-4a6d-8f10-9b3c4d5e6f70"
#define SENSOR_CHARACTERISTIC_UUID "7c1a0004-5e2b-4a6d-8f10-9b3c4d5e6f70"

#define CUE_STALE_MS 2000u

typedef struct {
    uint8_t direction;
    uint8_t intensity;
    uint16_t pulse_period_ms;
    uint16_t distance_m;
    uint8_t flags;
} Cue;

typedef struct {
    uint16_t heading_decidegrees;
    bool heading_valid;
    uint8_t buttons;
} HelmetState;

typedef struct {
    bool imu_ok;
    bool mic_ok;
    int16_t ax_mg;
    int16_t ay_mg;
    int16_t az_mg;
    int16_t gx_dps10;
    int16_t gy_dps10;
    int16_t gz_dps10;
    int16_t mic_peak;
} SensorSample;

int encode_cue(const Cue *cue, uint8_t out[CUE_PACKET_LEN]);
int decode_cue(const uint8_t *packet, size_t length, Cue *out);
int encode_helmet_state(const HelmetState *state, uint8_t out[HELMET_STATE_PACKET_LEN]);
int decode_helmet_state(const uint8_t *packet, size_t length, HelmetState *out);
int encode_sensor_sample(const SensorSample *sample, uint8_t out[SENSOR_PACKET_LEN]);
int decode_sensor_sample(const uint8_t *packet, size_t length, SensorSample *out);

#ifdef __cplusplus
}
#endif
