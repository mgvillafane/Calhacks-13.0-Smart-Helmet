#pragma once

#include "protocol.h"

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* One IMU sample in the helmet board frame.
 * +Z is up when the board is level. +X is north and +Y is east when the
 * rider faces north. Acceleration is in g. The magnetic field may use any
 * unit. Gyro is radians per second and is not used by this step.
 *
 * Level heading is atan2(east, north) after tilt compensation:
 *   roll = atan2(ay, az)
 *   pitch = atan2(-ax, sqrt(ay^2 + az^2))
 *   north = mx * cos(pitch) + mz * sin(pitch)
 *   east = mx * sin(roll) * sin(pitch) + my * cos(roll) - mz * sin(roll) * cos(pitch)
 * Decidegrees are round(degrees * 10), wrapped to 0..3599.
 * Return -1 when accel or mag is unusable, including a near-zero field.
 */

typedef struct {
    float ax;
    float ay;
    float az;
    float mx;
    float my;
    float mz;
    float gx;
    float gy;
    float gz;
    bool accel_ok;
    bool mag_ok;
} ImuSample;

int heading_decidegrees(const ImuSample *sample, uint16_t *decidegrees);

/* heading_status 0 publishes decidegrees. Any other status publishes the
 * invalid sentinel. Buttons are copied either way.
 */
void helmet_state_from_heading(int heading_status, uint16_t decidegrees, uint8_t buttons, HelmetState *out);

#ifdef __cplusplus
}
#endif
