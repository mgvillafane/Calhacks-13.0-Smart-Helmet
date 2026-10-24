#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Board frame from heading.h: +X is forward, +Y is to the rider's right,
 * +Z is up. The accelerometer reads positive X during braking because the
 * proof mass keeps moving forward. Gravity is a slow baseline taken while
 * the brake is off, so a tilted mount does not look like braking.
 * A fast pitch rate is a nod, not a brake.
 * Return 1 while the rider is braking, otherwise 0.
 */

#define BRAKE_ON_G 0.20f
#define BRAKE_OFF_G 0.08f
#define BRAKE_ON_MS 100u
#define BRAKE_OFF_MS 200u
#define BRAKE_MAX_PITCH_DPS 35.0f
#define BRAKE_GRAVITY_TAU_MS 2000u

typedef struct {
    float gravity_x;
    float gravity_y;
    float gravity_z;
    uint32_t strong_ms;
    uint32_t calm_ms;
    bool braking;
    bool started;
} BrakeState;

int brake_update(BrakeState *state, float ax, float ay, float az, float pitch_dps, uint32_t dt_ms);

#ifdef __cplusplus
}
#endif
