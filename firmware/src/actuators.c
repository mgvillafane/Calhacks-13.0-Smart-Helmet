#include "actuators.h"

#include <string.h>

static void fill_pixels(Rgb pixels[LED_PIXELS], int on) {
    uint8_t green = on ? LED_AMBER_G : 0;
    uint8_t red = on ? LED_AMBER_R : 0;
    uint8_t blue = on ? LED_AMBER_B : 0;
    for (int index = 0; index < LED_PIXELS; index += 1) {
        pixels[index].g = green;
        pixels[index].r = red;
        pixels[index].b = blue;
    }
}

int actuator_frame(const Cue *cue, uint32_t age_ms, bool fresh, ActuatorFrame *out) {
    uint32_t period;
    int pulse_on;

    if (cue == NULL || out == NULL) {
        return -1;
    }
    memset(out, 0, sizeof(*out));
    if (!fresh || age_ms > CUE_STALE_MS || cue->direction == DIRECTION_NONE || cue->intensity == 0) {
        return 0;
    }
    if (cue->direction > DIRECTION_UTURN) {
        return -1;
    }

    period = cue->pulse_period_ms == 0 ? 1u : cue->pulse_period_ms;
    pulse_on = ((age_ms / period) % 2u) == 0u;
    if (cue->direction == DIRECTION_LEFT && pulse_on) {
        out->motor_left = cue->intensity;
        fill_pixels(out->led_left, 1);
    } else if (cue->direction == DIRECTION_FRONT && pulse_on) {
        out->motor_front = cue->intensity;
    } else if (cue->direction == DIRECTION_RIGHT && pulse_on) {
        out->motor_right = cue->intensity;
        fill_pixels(out->led_right, 1);
    } else if (cue->direction == DIRECTION_UTURN) {
        if (pulse_on) {
            out->motor_left = cue->intensity;
            fill_pixels(out->led_left, 1);
        } else {
            out->motor_right = cue->intensity;
            fill_pixels(out->led_right, 1);
        }
    }
    return 0;
}
