#include "actuators.h"
#include "blinker.h"
#include "brake.h"
#include "heading.h"
#include "mic.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

static int failures = 0;

static void expect(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL %s\n", message);
        failures += 1;
    }
}

static int pixels_off(const Rgb pixels[LED_PIXELS]) {
    for (int index = 0; index < LED_PIXELS; index += 1) {
        if (pixels[index].g != 0 || pixels[index].r != 0 || pixels[index].b != 0) {
            return 0;
        }
    }
    return 1;
}

static int pixels_amber(const Rgb pixels[LED_PIXELS]) {
    for (int index = 0; index < LED_PIXELS; index += 1) {
        if (pixels[index].g != LED_AMBER_G || pixels[index].r != LED_AMBER_R || pixels[index].b != LED_AMBER_B) {
            return 0;
        }
    }
    return 1;
}

static Cue cue_of(uint8_t direction, uint8_t intensity, uint16_t period_ms) {
    Cue cue = {direction, intensity, period_ms, 20, 0};
    return cue;
}

static void expect_motors(const ActuatorFrame *frame, uint8_t left, uint8_t front, uint8_t right, const char *message) {
    expect(frame->motor_left == left && frame->motor_front == front && frame->motor_right == right, message);
}

static void test_left_and_right_copy_onto_one_strip(void) {
    Cue left = cue_of(DIRECTION_LEFT, 160, 800);
    Cue right = cue_of(DIRECTION_RIGHT, 90, 800);
    ActuatorFrame frame;

    expect(actuator_frame(&left, 0, true, &frame) == 0, "left frame");
    expect_motors(&frame, 160, 0, 0, "left motor");
    expect(pixels_amber(frame.led_left) && pixels_off(frame.led_right), "left strip only");

    expect(actuator_frame(&right, 0, true, &frame) == 0, "right frame");
    expect_motors(&frame, 0, 0, 90, "right motor");
    expect(pixels_off(frame.led_left) && pixels_amber(frame.led_right), "right strip only");
}

static void test_front_buzzes_without_lighting_a_strip(void) {
    Cue front = cue_of(DIRECTION_FRONT, 160, 200);
    ActuatorFrame frame;

    expect(actuator_frame(&front, 0, true, &frame) == 0, "front frame");
    expect_motors(&frame, 0, 160, 0, "front motor");
    expect(pixels_off(frame.led_left) && pixels_off(frame.led_right), "front leaves strips off");
}

static void test_uturn_alternates_sides(void) {
    Cue uturn = cue_of(DIRECTION_UTURN, 200, 400);
    ActuatorFrame on_phase;
    ActuatorFrame off_phase;

    expect(actuator_frame(&uturn, 0, true, &on_phase) == 0, "uturn on");
    expect(actuator_frame(&uturn, 400, true, &off_phase) == 0, "uturn off");
    expect_motors(&on_phase, 200, 0, 0, "uturn first side is left");
    expect(pixels_amber(on_phase.led_left) && pixels_off(on_phase.led_right), "uturn left strip");
    expect_motors(&off_phase, 0, 0, 200, "uturn second side is right");
    expect(pixels_off(off_phase.led_left) && pixels_amber(off_phase.led_right), "uturn right strip");
}

static void test_pulse_period_and_stale_cue(void) {
    Cue left = cue_of(DIRECTION_LEFT, 160, 800);
    Cue zero_period = cue_of(DIRECTION_LEFT, 160, 0);
    ActuatorFrame frame;

    expect(actuator_frame(&left, 799, true, &frame) == 0, "still in the on phase");
    expect_motors(&frame, 160, 0, 0, "799 ms is on");
    expect(actuator_frame(&left, 800, true, &frame) == 0, "first off phase");
    expect_motors(&frame, 0, 0, 0, "800 ms is off");
    expect(pixels_off(frame.led_left) && pixels_off(frame.led_right), "off phase strips");
    expect(actuator_frame(&left, 1600, true, &frame) == 0, "second on phase");
    expect_motors(&frame, 160, 0, 0, "1600 ms is on");

    expect(actuator_frame(&left, CUE_STALE_MS, true, &frame) == 0, "age at the limit");
    expect_motors(&frame, 160, 0, 0, "2000 ms still plays");
    expect(actuator_frame(&left, CUE_STALE_MS + 1, true, &frame) == 0, "age past the limit");
    expect_motors(&frame, 0, 0, 0, "2001 ms stops the motors");
    expect(pixels_off(frame.led_left) && pixels_off(frame.led_right), "stale cue turns strips off");

    expect(actuator_frame(&zero_period, 0, true, &frame) == 0, "zero period");
    expect_motors(&frame, 160, 0, 0, "zero period is on at age 0");
    expect(actuator_frame(&zero_period, 1, true, &frame) == 0, "zero period next ms");
    expect_motors(&frame, 0, 0, 0, "zero period is off at age 1");
}

static void test_quiet_and_dropped_cues_are_dark(void) {
    Cue none = cue_of(DIRECTION_NONE, 160, 800);
    Cue dim = cue_of(DIRECTION_LEFT, 0, 800);
    Cue left = cue_of(DIRECTION_LEFT, 160, 800);
    ActuatorFrame frame;

    expect(actuator_frame(&none, 0, true, &frame) == 0, "none frame");
    expect_motors(&frame, 0, 0, 0, "none is silent");
    expect(pixels_off(frame.led_left) && pixels_off(frame.led_right), "none strips");
    expect(actuator_frame(&dim, 0, true, &frame) == 0, "zero intensity");
    expect_motors(&frame, 0, 0, 0, "zero intensity is silent");
    expect(actuator_frame(&left, 0, false, &frame) == 0, "dropped link");
    expect_motors(&frame, 0, 0, 0, "disconnect silences motors");
    expect(pixels_off(frame.led_left) && pixels_off(frame.led_right), "disconnect turns strips off");
    expect(actuator_frame(NULL, 0, true, &frame) == -1, "reject a missing cue");
}

static ImuSample level_sample(float mx, float my) {
    ImuSample sample;
    memset(&sample, 0, sizeof(sample));
    sample.az = 1.0f;
    sample.mx = mx;
    sample.my = my;
    sample.accel_ok = true;
    sample.mag_ok = true;
    return sample;
}

static void test_blinker_command_copies_direction(void) {
    Cue left = cue_of(DIRECTION_LEFT, 160, 800);
    Cue right = cue_of(DIRECTION_RIGHT, 160, 800);
    Cue uturn = cue_of(DIRECTION_UTURN, 160, 800);
    Cue front = cue_of(DIRECTION_FRONT, 160, 200);
    Cue none = cue_of(DIRECTION_NONE, 160, 800);
    Cue dim = cue_of(DIRECTION_LEFT, 0, 800);

    expect(blinker_command(&left, 0, true) == BLINKER_LEFT, "left cue commands left");
    expect(blinker_command(&right, 0, true) == BLINKER_RIGHT, "right cue commands right");
    expect(blinker_command(&uturn, 0, true) == BLINKER_UTURN, "u-turn keeps its own command");
    expect(blinker_command(&front, 0, true) == BLINKER_OFF, "front leaves the blinkers off");
    expect(blinker_command(&none, 0, true) == BLINKER_OFF, "none is off");
    expect(blinker_command(&dim, 0, true) == BLINKER_OFF, "zero intensity is off");
    expect(blinker_command(&left, CUE_STALE_MS + 1, true) == BLINKER_OFF, "stale cue is off");
    expect(blinker_command(&left, 0, false) == BLINKER_OFF, "dropped link is off");
    expect(blinker_command(NULL, 0, true) == BLINKER_OFF, "missing cue is off");
}

static int feed_brake(BrakeState *state, float ax, float ay, float az,
                      float gx, float gy, float gz, int samples) {
    int braking = 0;
    for (int index = 0; index < samples; index += 1) {
        braking = brake_update(state, ax, ay, az, gx, gy, gz, 20);
    }
    return braking;
}

static void prime_brake(BrakeState *state, float x, float y, float z) {
    brake_reset(state);
    expect(feed_brake(state, x, y, z, 0, 0, 0, 50) == 0, "stationary calibration stays quiet");
    expect(state->ready, "stationary calibration completes");
}

static void test_imu_brake_is_independent_of_mount_and_sign(void) {
    const float mounts[][3] = {
        {0, 0, 1}, {0, 0, -1}, {1, 0, 0}, {-1, 0, 0},
        {0, 1, 0}, {0, -1, 0}, {0.577350269f, 0.577350269f, 0.577350269f}
    };
    for (unsigned mount = 0; mount < sizeof(mounts) / sizeof(mounts[0]); mount += 1) {
        float x = mounts[mount][0], y = mounts[mount][1], z = mounts[mount][2];
        /* Cross gravity with a non-parallel vector to get horizontal motion. */
        float dx = fabsf(z) < 0.9f ? y : 0;
        float dy = fabsf(z) < 0.9f ? -x : z;
        float dz = fabsf(z) < 0.9f ? 0 : -y;
        float length = sqrtf(dx * dx + dy * dy + dz * dz);
        for (int sign = -1; sign <= 1; sign += 2) {
            BrakeState state;
            prime_brake(&state, x, y, z);
            float scale = (float)sign * 0.12f / length;
            expect(feed_brake(&state, x + dx * scale, y + dy * scale, z + dz * scale,
                              0, 0, 0, 7) == 0, "short motion does not trigger");
            expect(feed_brake(&state, x + dx * scale, y + dy * scale, z + dz * scale,
                              0, 0, 0, 25) == 1, "gentler motion triggers in every mounting and sign");
            expect(fabsf(state.average_g - 0.12f) < 0.001f, "rolling average preserves motion magnitude");
            expect(fabsf(state.delta_v_mps - 0.12f * BRAKE_G_M_S2 * 0.3f) < 0.001f,
                   "short-window delta-v has metres per second units");
            expect(feed_brake(&state, x + dx * scale, y + dy * scale, z + dz * scale,
                              0, 0, 0, 100) == 1, "sustained motion is not absorbed into gravity");
            expect(feed_brake(&state, x, y, z, 0, 0, 0, 12) == 1, "release waits at least 250 ms");
            expect(feed_brake(&state, x, y, z, 0, 0, 0, 1) == 0, "quiet samples release the brake");
        }
    }
}

static void test_imu_brake_rejects_bumps_vibration_and_rotation(void) {
    BrakeState state;
    prime_brake(&state, 0, 0, 1);
    expect(feed_brake(&state, 3, 0, 1, 0, 0, 0, 1) == 0, "single horizontal impact stays quiet");
    expect(feed_brake(&state, 0, 0, 1, 0, 0, 0, 40) == 0, "impact does not trigger later in the window");
    expect(feed_brake(&state, 0, 0, 1.8f, 0, 0, 0, 50) == 0, "vertical bumps are excluded");
    for (int index = 0; index < 200; index += 1) {
        expect(feed_brake(&state, index % 2 ? -0.3f : 0.3f, 0, 1, 0, 0, 0, 1) == 0,
               "opposite vibration cancels instead of accumulating speed");
    }
    for (int axis = 0; axis < 3; axis += 1) {
        prime_brake(&state, 0, 0, 1);
        expect(feed_brake(&state, 0.3f, 0, 1,
                          axis == 0 ? 90 : 0, axis == 1 ? 90 : 0, axis == 2 ? 90 : 0, 25) == 0,
               "fast rotation is rejected on every gyro axis");
        expect(state.rotation_blocked, "rotation rejection is exposed for plotting");
    }
    /* Slow, real changes of tilt must not be mistaken for translation. */
    prime_brake(&state, 0, 0, 1);
    for (int index = 1; index <= 500; index += 1) {
        float angle = (float)index * 20.0f * 0.02f * 0.01745329252f;
        expect(feed_brake(&state, -sinf(angle), 0, cosf(angle), 0, 20, 0, 1) == 0,
               "gyro gravity tracking rejects slow head tilts");
    }
}

static void test_imu_brake_handles_timing_and_sensor_failure(void) {
    BrakeState state;
    expect(brake_update(NULL, 0, 0, 1, 0, 0, 0, 20) == 0, "missing state is quiet");
    prime_brake(&state, 0, 0, 1);
    for (int index = 0; index < 30; index += 1) {
        brake_update(&state, 0, -0.1f, 1, 0, 0, 0, index % 2 ? 27 : 13);
    }
    expect(state.braking, "uneven sample intervals still detect mild motion");
    expect(state.window_ms == BRAKE_WINDOW_MS, "rolling window trims partial old samples");
    expect(fabsf(state.average_g - 0.1f) < 0.001f, "time weighting is independent of sample spacing");
    expect(brake_update(&state, 0, -0.1f, 1, 0, 0, 0, 500) == 0, "a sampling gap releases stale brakes");
    expect(!state.ready, "a gap requires recalibration");
    prime_brake(&state, 0, 0, 1);
    feed_brake(&state, 0.12f, 0, 1, 0, 0, 0, 30);
    expect(state.braking, "prime a brake before sensor failure");
    expect(brake_update(&state, NAN, 0, 1, 0, 0, 0, 20) == 0, "invalid IMU values release the brake");
    expect(!state.ready && state.average_g == 0, "invalid readings do not poison later metrics");
    prime_brake(&state, 0, 0, 1);
    expect(feed_brake(&state, 0.12f, 0, 1, 0, 0, 0, 30) == 1, "detection recovers after recalibration");
    feed_brake(&state, 0, 0, 1, 0, 0, 0, 6);
    feed_brake(&state, 0.05f, 0, 1, 0, 0, 0, 20);
    expect(feed_brake(&state, 0, 0, 1, 0, 0, 0, 7) == 1, "release timer counts consecutive calm samples");
}

static void test_level_heading_cardinals(void) {
    uint16_t decidegrees = 1;
    ImuSample north = level_sample(1.0f, 0.0f);
    ImuSample east = level_sample(0.0f, 1.0f);
    ImuSample south = level_sample(-1.0f, 0.0f);
    ImuSample west = level_sample(0.0f, -1.0f);
    ImuSample northeast = level_sample(1.0f, 1.0f);

    expect(heading_decidegrees(&north, &decidegrees) == 0 && decidegrees == 0, "north is 0");
    expect(heading_decidegrees(&east, &decidegrees) == 0 && decidegrees == 900, "east is 900");
    expect(heading_decidegrees(&south, &decidegrees) == 0 && decidegrees == 1800, "south is 1800");
    expect(heading_decidegrees(&west, &decidegrees) == 0 && decidegrees == 2700, "west is 2700");
    expect(heading_decidegrees(&northeast, &decidegrees) == 0 && decidegrees == 450, "northeast is 450");
}

static int near(uint16_t actual, uint16_t expected) {
    int delta = (int)actual - (int)expected;
    if (delta < 0) {
        delta = -delta;
    }
    if (delta > 1800) {
        delta = 3600 - delta;
    }
    return delta <= 1;
}

static void test_tilt_keeps_north(void) {
    uint16_t decidegrees = 99;
    ImuSample pitched;
    ImuSample rolled;

    memset(&pitched, 0, sizeof(pitched));
    pitched.ax = 0.5f;
    pitched.az = 0.86602540378f;
    pitched.mx = 0.86602540378f;
    pitched.mz = -0.5f;
    pitched.accel_ok = true;
    pitched.mag_ok = true;

    memset(&rolled, 0, sizeof(rolled));
    rolled.ay = 0.34202014332f;
    rolled.az = 0.93969262078f;
    rolled.mx = 1.0f;
    rolled.accel_ok = true;
    rolled.mag_ok = true;

    expect(heading_decidegrees(&pitched, &decidegrees) == 0 && near(decidegrees, 0), "30 degree pitch stays north");
    expect(heading_decidegrees(&rolled, &decidegrees) == 0 && near(decidegrees, 0), "20 degree roll stays north");
}

static void test_unusable_imu_publishes_the_invalid_sentinel(void) {
    uint16_t decidegrees = 0;
    ImuSample failed = level_sample(1.0f, 0.0f);
    ImuSample zero = level_sample(0.0f, 0.0f);
    ImuSample vertical = level_sample(0.0f, 0.0f);
    HelmetState state;
    uint8_t packet[HELMET_STATE_PACKET_LEN];
    const uint8_t invalid_sos[] = {0xFF, 0xFF, 0x00, BUTTON_SOS};
    const uint8_t north_packet[] = {0x00, 0x00, 0x01, 0x00};

    failed.mag_ok = false;
    vertical.mz = 1.0f;
    ImuSample north = level_sample(1.0f, 0.0f);

    expect(heading_decidegrees(&failed, &decidegrees) == -1, "failed mag");
    expect(heading_decidegrees(&zero, &decidegrees) == -1, "zero field");
    expect(heading_decidegrees(&vertical, &decidegrees) == -1, "vertical field");

    helmet_state_from_heading(-1, 0, BUTTON_SOS, &state);
    expect(encode_helmet_state(&state, packet) == 0, "encode invalid");
    expect(memcmp(packet, invalid_sos, HELMET_STATE_PACKET_LEN) == 0, "invalid heading keeps SOS");

    expect(heading_decidegrees(&north, &decidegrees) == 0, "north status");
    helmet_state_from_heading(0, decidegrees, BUTTON_PRESSED, &state);
    expect(state.buttons == BUTTON_PRESSED, "a held talk switch stays in the notify");
    helmet_state_from_heading(0, decidegrees, 0, &state);
    expect(encode_helmet_state(&state, packet) == 0, "encode north");
    expect(memcmp(packet, north_packet, HELMET_STATE_PACKET_LEN) == 0, "north notify bytes");
}

static void test_mic_removes_dc_and_scales_speech(void) {
    MicFilter filter = {0};
    MicFilter loud = {0};
    int16_t out = 0;

    expect(mic_pcm16(&filter, 0x10000000) == 0, "first slot sets the DC baseline");
    for (int index = 0; index < 4000; index += 1) {
        out = mic_pcm16(&filter, 0x10000000);
    }
    expect(out == 0, "a steady offset settles to silence");
    out = mic_pcm16(&filter, 0x10000000 + (1000 << 8 << MIC_SHIFT));
    expect(out >= 999 && out <= 1000, "a step passes at the documented gain");

    mic_pcm16(&loud, 0);
    expect(mic_pcm16(&loud, 0x7FFFFF00) == 32767, "positive overload clips");
    expect(mic_pcm16(&loud, (int32_t)0x80000000) == -32768, "negative overload clips");
    expect(mic_pcm16(NULL, 0x10000000) == 0, "missing filter is silent");

    expect(talk_streaming(true) == true, "holding the switch streams the helmet mic");
    expect(talk_streaming(false) == false, "letting go stops the helmet mic");
    expect(mic_louder_slot(0, 5000) == 5000, "right slot is used when left is silent");
    expect(mic_louder_slot(-8000, 100) == -8000, "left slot wins when it is louder");
}

int main(void) {
    test_left_and_right_copy_onto_one_strip();
    test_front_buzzes_without_lighting_a_strip();
    test_uturn_alternates_sides();
    test_pulse_period_and_stale_cue();
    test_quiet_and_dropped_cues_are_dark();
    test_blinker_command_copies_direction();
    test_imu_brake_is_independent_of_mount_and_sign();
    test_imu_brake_rejects_bumps_vibration_and_rotation();
    test_imu_brake_handles_timing_and_sensor_failure();
    test_level_heading_cardinals();
    test_tilt_keeps_north();
    test_unusable_imu_publishes_the_invalid_sentinel();
    test_mic_removes_dc_and_scales_speech();
    if (failures != 0) {
        fprintf(stderr, "%d helmet actuator check(s) failed\n", failures);
        return 1;
    }
    puts("helmet actuator checks passed");
    return 0;
}
