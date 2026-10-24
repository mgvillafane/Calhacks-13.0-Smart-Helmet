#include "brake.h"

#include <stddef.h>

int brake_update(BrakeState *state, float ax, float ay, float az, float pitch_dps, uint32_t dt_ms) {
    float alpha;
    float forward_g;
    float pitch = pitch_dps < 0.0f ? -pitch_dps : pitch_dps;

    if (state == NULL) {
        return 0;
    }
    if (!state->started) {
        state->gravity_x = ax;
        state->gravity_y = ay;
        state->gravity_z = az;
        state->started = true;
        return 0;
    }
    if (dt_ms > 50u) {
        dt_ms = 50u;
    }
    if (!state->braking && dt_ms > 0u) {
        alpha = (float)dt_ms / (float)(BRAKE_GRAVITY_TAU_MS + dt_ms);
        state->gravity_x += alpha * (ax - state->gravity_x);
        state->gravity_y += alpha * (ay - state->gravity_y);
        state->gravity_z += alpha * (az - state->gravity_z);
    }

    forward_g = ax - state->gravity_x;
    if (pitch <= BRAKE_MAX_PITCH_DPS && forward_g >= BRAKE_ON_G) {
        state->strong_ms += dt_ms;
        state->calm_ms = 0;
        if (state->strong_ms >= BRAKE_ON_MS) {
            state->braking = true;
        }
    } else if (forward_g <= BRAKE_OFF_G) {
        state->calm_ms += dt_ms;
        state->strong_ms = 0;
        if (state->calm_ms >= BRAKE_OFF_MS) {
            state->braking = false;
        }
    } else {
        state->strong_ms = 0;
    }
    return state->braking ? 1 : 0;
}
