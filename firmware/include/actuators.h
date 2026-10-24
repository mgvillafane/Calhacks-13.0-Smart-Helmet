#pragma once

#include "protocol.h"

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Three WS2812 pixels per strip. Color is GRB, matching the diode wire order.
 * Amber is a copy of the motor that is on. Front cues leave both strips off.
 */

#define LED_PIXELS 3
#define LED_AMBER_G 64
#define LED_AMBER_R 180
#define LED_AMBER_B 0

typedef struct {
    uint8_t g;
    uint8_t r;
    uint8_t b;
} Rgb;

typedef struct {
    uint8_t motor_left;
    uint8_t motor_front;
    uint8_t motor_right;
    Rgb led_left[LED_PIXELS];
    Rgb led_right[LED_PIXELS];
} ActuatorFrame;

/* Pulse rule matches the sketch. age_ms is the time since the cue was written.
 * Period 0 is treated as 1 ms. Even periods are on, odd periods are off.
 * A cue older than CUE_STALE_MS, a direction of none, intensity 0, or
 * fresh == false silences motors and both strips. U-turn alternates left
 * then right. Return 0 on success, -1 on reject.
 */
int actuator_frame(const Cue *cue, uint32_t age_ms, bool fresh, ActuatorFrame *out);

#ifdef __cplusplus
}
#endif
