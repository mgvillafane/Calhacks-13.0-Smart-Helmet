#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Mount-independent motion estimate, not signed vehicle deceleration.
 * Keep still for the first 500 ms to learn gravity and gyro bias. Gyroscope
 * updates track gravity as the helmet rotates. Integrate horizontal linear
 * acceleration over a short rolling window; its vector magnitude has no
 * preferred sensor axis. Speeding up can trigger this too: distinguishing
 * braking requires a forward/velocity reference (for example phone GPS).
 * Acceleration is in g; all three gyro inputs are in degrees per second.
 */
#define BRAKE_ON_G 0.08f
#define BRAKE_OFF_G 0.035f
#define BRAKE_ON_MS 80u
#define BRAKE_OFF_MS 250u
#define BRAKE_WINDOW_MS 300u
#define BRAKE_CALIBRATION_MS 500u
#define BRAKE_MAX_ROTATION_DPS 35.0f
#define BRAKE_GRAVITY_TAU_MS 2000u
#define BRAKE_MAX_SAMPLE_MS 100u
#define BRAKE_SAMPLE_CAP_G 0.35f
#define BRAKE_WINDOW_SAMPLES 64u
#define BRAKE_G_M_S2 9.80665f

typedef struct {
    float x;
    float y;
    float z;
    uint32_t dt_ms;
} BrakeWindowSample;

typedef struct {
    float gravity_x;
    float gravity_y;
    float gravity_z;
    float gyro_bias_x;
    float gyro_bias_y;
    float gyro_bias_z;
    float sum_x;
    float sum_y;
    float sum_z;
    float linear_g;
    float average_g;
    float delta_v_mps;
    float rotation_dps;
    uint32_t calibration_ms;
    uint32_t window_ms;
    uint32_t strong_ms;
    uint32_t calm_ms;
    uint16_t first;
    uint16_t count;
    bool braking;
    bool started;
    bool ready;
    bool rotation_blocked;
    BrakeWindowSample window[BRAKE_WINDOW_SAMPLES];
} BrakeState;

void brake_reset(BrakeState *state);
int brake_update(BrakeState *state, float ax, float ay, float az,
                 float gx_dps, float gy_dps, float gz_dps, uint32_t dt_ms);

#ifdef __cplusplus
}
#endif
