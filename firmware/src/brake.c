#include "brake.h"

#include <math.h>
#include <stddef.h>
#include <string.h>

static float length3(float x, float y, float z) {
    return sqrtf(x * x + y * y + z * z);
}

void brake_reset(BrakeState *state) {
    if (state != NULL) {
        memset(state, 0, sizeof(*state));
    }
}

static void normalize_gravity(BrakeState *state) {
    float length = length3(state->gravity_x, state->gravity_y, state->gravity_z);
    if (length > 0.01f) {
        state->gravity_x /= length;
        state->gravity_y /= length;
        state->gravity_z /= length;
    }
}

static void clear_window(BrakeState *state) {
    state->sum_x = state->sum_y = state->sum_z = 0.0f;
    state->window_ms = 0;
    state->first = state->count = 0;
    state->average_g = state->delta_v_mps = 0.0f;
}

static void add_sample(BrakeState *state, float x, float y, float z, uint32_t dt_ms) {
    /* The firmware samples at 50 Hz. Reset if a different caller fills the
       ring before reaching the time window rather than retain stale data. */
    if (state->count == BRAKE_WINDOW_SAMPLES) {
        clear_window(state);
    }
    uint16_t next = (uint16_t)((state->first + state->count) % BRAKE_WINDOW_SAMPLES);
    state->window[next] = (BrakeWindowSample){x, y, z, dt_ms};
    state->count += 1;
    state->window_ms += dt_ms;
    state->sum_x += x * (float)dt_ms;
    state->sum_y += y * (float)dt_ms;
    state->sum_z += z * (float)dt_ms;

    while (state->window_ms > BRAKE_WINDOW_MS && state->count > 0) {
        BrakeWindowSample *old = &state->window[state->first];
        uint32_t excess = state->window_ms - BRAKE_WINDOW_MS;
        uint32_t remove = old->dt_ms < excess ? old->dt_ms : excess;
        state->sum_x -= old->x * (float)remove;
        state->sum_y -= old->y * (float)remove;
        state->sum_z -= old->z * (float)remove;
        state->window_ms -= remove;
        old->dt_ms -= remove;
        if (old->dt_ms == 0) {
            state->first = (uint16_t)((state->first + 1u) % BRAKE_WINDOW_SAMPLES);
            state->count -= 1;
        }
    }
    float impulse = length3(state->sum_x, state->sum_y, state->sum_z);
    state->average_g = impulse / (float)BRAKE_WINDOW_MS;
    state->delta_v_mps = impulse * (BRAKE_G_M_S2 / 1000.0f);
}

int brake_update(BrakeState *state, float ax, float ay, float az,
                 float gx_dps, float gy_dps, float gz_dps, uint32_t dt_ms) {
    if (state == NULL) {
        return 0;
    }
    if (!isfinite(ax) || !isfinite(ay) || !isfinite(az) ||
        !isfinite(gx_dps) || !isfinite(gy_dps) || !isfinite(gz_dps) ||
        dt_ms > BRAKE_MAX_SAMPLE_MS) {
        brake_reset(state);
        return 0;
    }
    if (dt_ms == 0) {
        return state->braking ? 1 : 0;
    }
    float magnitude = length3(ax, ay, az);
    if (magnitude < 0.1f || magnitude > 8.0f) {
        brake_reset(state);
        return 0;
    }

    if (!state->ready) {
        float rotation = length3(gx_dps, gy_dps, gz_dps);
        if (rotation > 8.0f || fabsf(magnitude - 1.0f) > 0.08f) {
            brake_reset(state);
            return 0;
        }
        float weight = (float)dt_ms / (float)(state->calibration_ms + dt_ms);
        state->gravity_x += weight * (ax - state->gravity_x);
        state->gravity_y += weight * (ay - state->gravity_y);
        state->gravity_z += weight * (az - state->gravity_z);
        state->gyro_bias_x += gx_dps * (float)dt_ms;
        state->gyro_bias_y += gy_dps * (float)dt_ms;
        state->gyro_bias_z += gz_dps * (float)dt_ms;
        state->calibration_ms += dt_ms;
        state->started = true;
        if (state->calibration_ms >= BRAKE_CALIBRATION_MS) {
            state->gyro_bias_x /= (float)state->calibration_ms;
            state->gyro_bias_y /= (float)state->calibration_ms;
            state->gyro_bias_z /= (float)state->calibration_ms;
            normalize_gravity(state);
            state->ready = true;
        }
        return 0;
    }

    float gx = gx_dps - state->gyro_bias_x;
    float gy = gy_dps - state->gyro_bias_y;
    float gz = gz_dps - state->gyro_bias_z;
    state->rotation_dps = length3(gx, gy, gz);
    state->rotation_blocked = state->rotation_dps > BRAKE_MAX_ROTATION_DPS;

    /* A fixed world gravity vector rotates oppositely to the sensor frame.
       Gyro tracking prevents a changing helmet tilt from looking like a stop. */
    const float radians = 0.017453292519943295f;
    float dt = (float)dt_ms / 1000.0f;
    float x = state->gravity_x;
    float y = state->gravity_y;
    float z = state->gravity_z;
    state->gravity_x += (gz * y - gy * z) * radians * dt;
    state->gravity_y += (gx * z - gz * x) * radians * dt;
    state->gravity_z += (gy * x - gx * y) * radians * dt;
    normalize_gravity(state);

    /* Project into the plane perpendicular to gravity. This discards vertical
       bumps without assuming which sensor axis points along the bicycle. */
    float vertical = ax * state->gravity_x + ay * state->gravity_y + az * state->gravity_z;
    float hx = ax - vertical * state->gravity_x;
    float hy = ay - vertical * state->gravity_y;
    float hz = az - vertical * state->gravity_z;
    state->linear_g = length3(hx, hy, hz);

    if (!state->braking && (state->linear_g < BRAKE_OFF_G || state->rotation_blocked)) {
        float alpha = (float)dt_ms / (float)(BRAKE_GRAVITY_TAU_MS + dt_ms);
        state->gravity_x += alpha * (ax / magnitude - state->gravity_x);
        state->gravity_y += alpha * (ay / magnitude - state->gravity_y);
        state->gravity_z += alpha * (az / magnitude - state->gravity_z);
        normalize_gravity(state);
    }

    if (state->rotation_blocked) {
        clear_window(state);
    } else {
        /* Bound an individual impulse before integration so a pothole cannot
           dominate the rolling estimate. Opposite vibrations cancel as vectors. */
        float scale = state->linear_g > BRAKE_SAMPLE_CAP_G ? BRAKE_SAMPLE_CAP_G / state->linear_g : 1.0f;
        add_sample(state, hx * scale, hy * scale, hz * scale, dt_ms);
    }

    bool strong = state->window_ms >= BRAKE_WINDOW_MS &&
                  state->average_g >= BRAKE_ON_G &&
                  state->linear_g >= BRAKE_ON_G && !state->rotation_blocked;
    bool calm = state->average_g <= BRAKE_OFF_G || state->linear_g <= BRAKE_OFF_G || state->rotation_blocked;
    if (strong) {
        state->calm_ms = 0;
        if (state->strong_ms < BRAKE_ON_MS) {
            state->strong_ms += dt_ms;
        }
        if (state->strong_ms >= BRAKE_ON_MS) {
            state->braking = true;
        }
    } else {
        state->strong_ms = 0;
        if (calm) {
            if (state->calm_ms < BRAKE_OFF_MS) {
                state->calm_ms += dt_ms;
            }
            if (state->calm_ms >= BRAKE_OFF_MS) {
                state->braking = false;
            }
        } else {
            state->calm_ms = 0;
        }
    }
    return state->braking ? 1 : 0;
}
