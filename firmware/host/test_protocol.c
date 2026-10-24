#include "protocol.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;

static void expect(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL %s\n", message);
        failures += 1;
    }
}

static void expect_bytes(const uint8_t *actual, const uint8_t *expected, size_t length, const char *message) {
    expect(memcmp(actual, expected, length) == 0, message);
}

static void test_left_cue_little_endian(void) {
    Cue cue = {DIRECTION_LEFT, 180, 800, 40, 0};
    uint8_t packet[CUE_PACKET_LEN];
    const uint8_t expected[] = {0x01, 0x01, 0xB4, 0x20, 0x03, 0x28, 0x00, 0x00};
    Cue decoded;

    expect(encode_cue(&cue, packet) == 0, "encode left cue");
    expect_bytes(packet, expected, CUE_PACKET_LEN, "left cue bytes");
    expect(decode_cue(packet, CUE_PACKET_LEN, &decoded) == 0, "decode left cue");
    expect(decoded.direction == DIRECTION_LEFT, "left direction");
    expect(decoded.intensity == 180, "left intensity");
    expect(decoded.pulse_period_ms == 800, "left period");
    expect(decoded.distance_m == 40, "left distance");
    expect(decoded.flags == 0, "left flags");
}

static void test_front_and_uturn_golden_packets(void) {
    Cue front = {DIRECTION_FRONT, 10, 500, 1000, FLAG_OFF_ROUTE};
    Cue uturn = {DIRECTION_UTURN, 255, 200, 65535, FLAG_ARRIVED | FLAG_OFF_ROUTE | FLAG_REROUTING};
    uint8_t packet[CUE_PACKET_LEN];
    const uint8_t front_expected[] = {0x01, 0x02, 0x0A, 0xF4, 0x01, 0xE8, 0x03, 0x02};
    const uint8_t uturn_expected[] = {0x01, 0x04, 0xFF, 0xC8, 0x00, 0xFF, 0xFF, 0x07};

    expect(encode_cue(&front, packet) == 0, "encode front");
    expect_bytes(packet, front_expected, CUE_PACKET_LEN, "front bytes");
    expect(encode_cue(&uturn, packet) == 0, "encode uturn");
    expect_bytes(packet, uturn_expected, CUE_PACKET_LEN, "uturn bytes");
}

static void test_cue_rejects(void) {
    Cue bad_direction = {5, 0, 0, 0, 0};
    Cue bad_flags = {DIRECTION_NONE, 0, 0, 0, 0x08};
    uint8_t packet[CUE_PACKET_LEN] = {0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
    uint8_t unknown_version[] = {0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
    Cue decoded;

    expect(encode_cue(&bad_direction, packet) == -1, "reject direction 5");
    expect(encode_cue(&bad_flags, packet) == -1, "reject unknown flag");
    expect(decode_cue(packet, 7, &decoded) == -1, "reject short cue");
    expect(decode_cue(unknown_version, CUE_PACKET_LEN, &decoded) == -1, "reject version 2");
}

static void test_helmet_state_golden_packets(void) {
    HelmetState heading = {900, true, 0};
    HelmetState invalid = {HEADING_INVALID, false, BUTTON_MODE | BUTTON_SOS};
    HelmetState north = {0, true, BUTTON_MODE};
    uint8_t packet[HELMET_STATE_PACKET_LEN];
    const uint8_t heading_expected[] = {0x84, 0x03, 0x01, 0x00};
    const uint8_t invalid_expected[] = {0xFF, 0xFF, 0x00, 0x03};
    const uint8_t north_expected[] = {0x00, 0x00, 0x01, 0x01};
    HelmetState decoded;

    expect(encode_helmet_state(&heading, packet) == 0, "encode 900 decidegrees");
    expect_bytes(packet, heading_expected, HELMET_STATE_PACKET_LEN, "900 bytes");
    expect(decode_helmet_state(packet, HELMET_STATE_PACKET_LEN, &decoded) == 0, "decode 900");
    expect(decoded.heading_decidegrees == 900 && decoded.heading_valid, "900 fields");

    expect(encode_helmet_state(&invalid, packet) == 0, "encode invalid heading");
    expect_bytes(packet, invalid_expected, HELMET_STATE_PACKET_LEN, "invalid bytes");
    expect(encode_helmet_state(&north, packet) == 0, "encode north");
    expect_bytes(packet, north_expected, HELMET_STATE_PACKET_LEN, "north bytes");
}

static void test_helmet_state_rejects(void) {
    HelmetState too_far = {3600, true, 0};
    HelmetState mismatched = {900, false, 0};
    HelmetState bad_button = {0, true, 0x04};
    uint8_t sentinel_marked_valid[] = {0xFF, 0xFF, 0x01, 0x00};
    uint8_t packet[HELMET_STATE_PACKET_LEN];
    HelmetState decoded;

    expect(encode_helmet_state(&too_far, packet) == -1, "reject 3600");
    expect(encode_helmet_state(&mismatched, packet) == -1, "reject mismatched validity");
    expect(encode_helmet_state(&bad_button, packet) == -1, "reject button bit");
    expect(decode_helmet_state(sentinel_marked_valid, HELMET_STATE_PACKET_LEN, &decoded) == -1,
           "reject valid sentinel");
}

int main(void) {
    test_left_cue_little_endian();
    test_front_and_uturn_golden_packets();
    test_cue_rejects();
    test_helmet_state_golden_packets();
    test_helmet_state_rejects();
    if (failures != 0) {
        fprintf(stderr, "%d firmware protocol check(s) failed\n", failures);
        return 1;
    }
    puts("firmware protocol checks passed");
    return 0;
}
