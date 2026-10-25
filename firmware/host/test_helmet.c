#include "actuators.h"
#include "blinker.h"
#include "brake.h"
#include "heading.h"
#include "mic.h"

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

static int feed_brake(BrakeState *state, float ax, float pitch_dps, int samples) {
    int braking = 0;
    for (int index = 0; index < samples; index += 1) {
        braking = brake_update(state, ax, 0.0f, 1.0f, pitch_dps, 20);
    }
    return braking;
}

static void test_imu_brake_uses_forward_deceleration(void) {
    BrakeState state;
    BrakeState tilted;
    BrakeState nod;

    memset(&state, 0, sizeof(state));
    memset(&tilted, 0, sizeof(tilted));
    memset(&nod, 0, sizeof(nod));

    expect(brake_update(NULL, 0.4f, 0.0f, 1.0f, 0.0f, 20) == 0, "missing brake state");
    expect(feed_brake(&state, 0.0f, 0.0f, 10) == 0, "level rest is not braking");
    expect(feed_brake(&state, 0.30f, 0.0f, 4) == 0, "80 ms is not yet a brake");
    expect(feed_brake(&state, 0.30f, 0.0f, 1) == 1, "100 ms of deceleration brakes");
    expect(feed_brake(&state, 0.30f, 0.0f, 100) == 1, "gravity stays put while braking");
    expect(feed_brake(&state, 0.0f, 0.0f, 9) == 1, "release waits 200 ms");
    expect(feed_brake(&state, 0.0f, 0.0f, 1) == 0, "calm axis releases the brake");

    memset(&state, 0, sizeof(state));
    expect(feed_brake(&state, 0.0f, 0.0f, 5) == 0, "prime before a bump");
    expect(feed_brake(&state, 1.0f, 0.0f, 1) == 0, "one sample is a bump");
    expect(feed_brake(&state, 0.0f, 0.0f, 1) == 0, "bump does not latch");

    expect(brake_update(&tilted, 0.34f, 0.0f, 0.94f, 0.0f, 20) == 0, "first tilted sample");
    expect(feed_brake(&tilted, 0.34f, 0.0f, 20) == 0, "a fixed tilt is not braking");

    expect(feed_brake(&nod, 0.0f, 0.0f, 5) == 0, "prime before a nod");
    expect(feed_brake(&nod, 0.50f, 90.0f, 15) == 0, "a nod is not braking");
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

    expect(talk_streaming(false, false, true) == true, "a press starts the helmet mic");
    expect(talk_streaming(true, true, false) == true, "letting go keeps the helmet mic on");
    expect(talk_streaming(true, false, true) == false, "the next press stops the helmet mic");
    expect(talk_streaming(false, true, false) == false, "letting go stays off");
}

int main(void) {
    test_left_and_right_copy_onto_one_strip();
    test_front_buzzes_without_lighting_a_strip();
    test_uturn_alternates_sides();
    test_pulse_period_and_stale_cue();
    test_quiet_and_dropped_cues_are_dark();
    test_blinker_command_copies_direction();
    test_imu_brake_uses_forward_deceleration();
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
