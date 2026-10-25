"""Contract tests for the phone-to-helmet cue and the helmet-state notify.

Packets are little-endian. These cases are the source of truth for the
Python oracle, the phone codec, and the ESP32 codec.
"""

import unittest

from shared.protocol.codec import (
    BUTTON_MODE,
    BUTTON_SOS,
    BUTTON_TALK,
    AUDIO_CHARACTERISTIC_UUID,
    AUDIO_MAX_SAMPLES,
    AUDIO_SAMPLE_RATE,
    AudioPacket,
    decode_audio_packet,
    encode_audio_packet,
    ulaw_decode,
    ulaw_encode,
    CUE_CHARACTERISTIC_UUID,
    CUE_PACKET_LEN,
    DEVICE_NAME,
    DIRECTION_FRONT,
    DIRECTION_LEFT,
    DIRECTION_NONE,
    DIRECTION_RIGHT,
    DIRECTION_UTURN,
    FLAG_ARRIVED,
    FLAG_IMU_OK,
    FLAG_MIC_OK,
    FLAG_OFF_ROUTE,
    FLAG_REROUTING,
    HEADING_INVALID,
    HELMET_STATE_CHARACTERISTIC_UUID,
    HELMET_STATE_PACKET_LEN,
    PROTOCOL_VERSION,
    SENSOR_CHARACTERISTIC_UUID,
    SENSOR_PACKET_LEN,
    SERVICE_UUID,
    Cue,
    HelmetState,
    SensorSample,
    decode_cue,
    decode_helmet_state,
    decode_sensor_sample,
    encode_cue,
    encode_helmet_state,
    encode_sensor_sample,
)


def _cue(**overrides):
    fields = dict(
        direction=DIRECTION_NONE,
        intensity=0,
        pulse_period_ms=0,
        distance_m=0,
        flags=0,
    )
    fields.update(overrides)
    return Cue(**fields)


class IdentityTest(unittest.TestCase):
    def test_advertised_name_and_uuids(self):
        self.assertEqual(DEVICE_NAME, "SmartHelmet")
        self.assertEqual(SERVICE_UUID, "7c1a0001-5e2b-4a6d-8f10-9b3c4d5e6f70")
        self.assertEqual(CUE_CHARACTERISTIC_UUID, "7c1a0002-5e2b-4a6d-8f10-9b3c4d5e6f70")
        self.assertEqual(
            HELMET_STATE_CHARACTERISTIC_UUID,
            "7c1a0003-5e2b-4a6d-8f10-9b3c4d5e6f70",
        )
        self.assertEqual(SENSOR_CHARACTERISTIC_UUID, "7c1a0004-5e2b-4a6d-8f10-9b3c4d5e6f70")

    def test_packet_lengths_and_version(self):
        self.assertEqual(PROTOCOL_VERSION, 1)
        self.assertEqual(CUE_PACKET_LEN, 8)
        self.assertEqual(HELMET_STATE_PACKET_LEN, 4)
        self.assertEqual(SENSOR_PACKET_LEN, 20)

    def test_direction_and_flag_values(self):
        self.assertEqual(
            [DIRECTION_NONE, DIRECTION_LEFT, DIRECTION_FRONT, DIRECTION_RIGHT, DIRECTION_UTURN],
            [0, 1, 2, 3, 4],
        )
        self.assertEqual(FLAG_ARRIVED, 0x01)
        self.assertEqual(FLAG_OFF_ROUTE, 0x02)
        self.assertEqual(FLAG_REROUTING, 0x04)
        self.assertEqual(BUTTON_MODE, 0x01)
        self.assertEqual(BUTTON_SOS, 0x02)
        self.assertEqual(HEADING_INVALID, 0xFFFF)
        self.assertEqual(FLAG_IMU_OK, 0x01)
        self.assertEqual(FLAG_MIC_OK, 0x02)


class CueEncodeTest(unittest.TestCase):
    def test_quiet_cue_is_eight_zero_payload_bytes_after_version(self):
        packet = encode_cue(_cue())
        self.assertEqual(packet, bytes([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))

    def test_left_cue_packs_period_and_distance_little_endian(self):
        # pulse 800 ms = 0x0320, distance 40 m = 0x0028, intensity 180 = 0xB4
        packet = encode_cue(
            _cue(
                direction=DIRECTION_LEFT,
                intensity=180,
                pulse_period_ms=800,
                distance_m=40,
            )
        )
        self.assertEqual(packet, bytes([0x01, 0x01, 0xB4, 0x20, 0x03, 0x28, 0x00, 0x00]))

    def test_front_cue_with_off_route_flag(self):
        # pulse 500 = 0x01F4, distance 1000 = 0x03E8, flag off-route = 0x02
        packet = encode_cue(
            _cue(
                direction=DIRECTION_FRONT,
                intensity=10,
                pulse_period_ms=500,
                distance_m=1000,
                flags=FLAG_OFF_ROUTE,
            )
        )
        self.assertEqual(packet, bytes([0x01, 0x02, 0x0A, 0xF4, 0x01, 0xE8, 0x03, 0x02]))

    def test_right_cue_with_arrived_flag(self):
        packet = encode_cue(
            _cue(
                direction=DIRECTION_RIGHT,
                intensity=1,
                pulse_period_ms=1,
                distance_m=1,
                flags=FLAG_ARRIVED,
            )
        )
        self.assertEqual(packet, bytes([0x01, 0x03, 0x01, 0x01, 0x00, 0x01, 0x00, 0x01]))

    def test_uturn_uses_full_uint16_range_and_all_flags(self):
        # pulse 200 = 0x00C8, distance 65535 = 0xFFFF, flags = arrived|off-route|rerouting
        packet = encode_cue(
            _cue(
                direction=DIRECTION_UTURN,
                intensity=255,
                pulse_period_ms=200,
                distance_m=65535,
                flags=FLAG_ARRIVED | FLAG_OFF_ROUTE | FLAG_REROUTING,
            )
        )
        self.assertEqual(packet, bytes([0x01, 0x04, 0xFF, 0xC8, 0x00, 0xFF, 0xFF, 0x07]))

    def test_rerouting_flag_is_bit_2(self):
        packet = encode_cue(_cue(flags=FLAG_REROUTING))
        self.assertEqual(packet[7], 0x04)


class CueDecodeTest(unittest.TestCase):
    def test_round_trip_every_direction_and_flag_combination(self):
        for direction in range(5):
            for flags in range(8):
                original = _cue(
                    direction=direction,
                    intensity=direction * 40,
                    pulse_period_ms=200 + direction,
                    distance_m=1000 + flags,
                    flags=flags,
                )
                self.assertEqual(decode_cue(encode_cue(original)), original)

    def test_decode_known_left_packet(self):
        cue = decode_cue(bytes([0x01, 0x01, 0xB4, 0x20, 0x03, 0x28, 0x00, 0x00]))
        self.assertEqual(
            cue,
            _cue(
                direction=DIRECTION_LEFT,
                intensity=180,
                pulse_period_ms=800,
                distance_m=40,
            ),
        )

    def test_rejects_truncated_and_oversized_packets(self):
        good = bytes([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        for packet in (b"", good[:7], good + b"\x00"):
            with self.assertRaises(ValueError):
                decode_cue(packet)

    def test_rejects_unknown_version_direction_and_flag_bits(self):
        for packet in (
            bytes([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
            bytes([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
            bytes([0x01, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
            bytes([0x01, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
            bytes([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08]),
        ):
            with self.assertRaises(ValueError):
                decode_cue(packet)


class CueEncodeRejectTest(unittest.TestCase):
    def test_rejects_direction_outside_0_to_4(self):
        for direction in (-1, 5, 255):
            with self.assertRaises(ValueError):
                encode_cue(_cue(direction=direction))

    def test_rejects_intensity_outside_byte_range(self):
        for intensity in (-1, 256):
            with self.assertRaises(ValueError):
                encode_cue(_cue(intensity=intensity))

    def test_rejects_period_and_distance_outside_uint16(self):
        for value in (-1, 65536):
            with self.assertRaises(ValueError):
                encode_cue(_cue(pulse_period_ms=value))
            with self.assertRaises(ValueError):
                encode_cue(_cue(distance_m=value))

    def test_rejects_unknown_flag_bits(self):
        with self.assertRaises(ValueError):
            encode_cue(_cue(flags=0x08))
        with self.assertRaises(ValueError):
            encode_cue(_cue(flags=-1))


class HelmetStateEncodeTest(unittest.TestCase):
    def test_heading_90_degrees_is_900_decidegrees_little_endian(self):
        # 900 = 0x0384
        packet = encode_helmet_state(
            HelmetState(heading_decidegrees=900, heading_valid=True, buttons=0)
        )
        self.assertEqual(packet, bytes([0x84, 0x03, 0x01, 0x00]))

    def test_north_with_mode_button(self):
        packet = encode_helmet_state(
            HelmetState(heading_decidegrees=0, heading_valid=True, buttons=BUTTON_MODE)
        )
        self.assertEqual(packet, bytes([0x00, 0x00, 0x01, 0x01]))

    def test_max_valid_heading_with_sos_button(self):
        # 3599 = 0x0E0F
        packet = encode_helmet_state(
            HelmetState(heading_decidegrees=3599, heading_valid=True, buttons=BUTTON_SOS)
        )
        self.assertEqual(packet, bytes([0x0F, 0x0E, 0x01, 0x02]))

    def test_invalid_heading_uses_sentinel_and_both_buttons(self):
        packet = encode_helmet_state(
            HelmetState(
                heading_decidegrees=HEADING_INVALID,
                heading_valid=False,
                buttons=BUTTON_MODE | BUTTON_SOS,
            )
        )
        self.assertEqual(packet, bytes([0xFF, 0xFF, 0x00, 0x03]))


class HelmetStateDecodeTest(unittest.TestCase):
    def test_round_trip_valid_headings_and_buttons(self):
        for heading in (0, 1, 900, 1800, 3599):
            for buttons in range(4):
                original = HelmetState(
                    heading_decidegrees=heading,
                    heading_valid=True,
                    buttons=buttons,
                )
                self.assertEqual(decode_helmet_state(encode_helmet_state(original)), original)

    def test_round_trip_invalid_heading(self):
        original = HelmetState(
            heading_decidegrees=HEADING_INVALID,
            heading_valid=False,
            buttons=0,
        )
        self.assertEqual(decode_helmet_state(encode_helmet_state(original)), original)

    def test_decode_known_invalid_packet(self):
        state = decode_helmet_state(bytes([0xFF, 0xFF, 0x00, 0x00]))
        self.assertEqual(
            state,
            HelmetState(heading_decidegrees=HEADING_INVALID, heading_valid=False, buttons=0),
        )

    def test_rejects_bad_lengths(self):
        good = bytes([0x00, 0x00, 0x01, 0x00])
        for packet in (b"", good[:3], good + b"\x00"):
            with self.assertRaises(ValueError):
                decode_helmet_state(packet)

    def test_rejects_inconsistent_or_out_of_range_heading(self):
        for packet in (
            bytes([0x10, 0x0E, 0x01, 0x00]),  # 3600 decidegrees
            bytes([0xFF, 0xFF, 0x01, 0x00]),  # sentinel marked valid
            bytes([0x00, 0x00, 0x00, 0x00]),  # zero heading marked invalid
            bytes([0x84, 0x03, 0x02, 0x00]),  # validity byte neither 0 nor 1
            bytes([0x00, 0x00, 0x01, 0x08]),  # unknown button bit
        ):
            with self.assertRaises(ValueError):
                decode_helmet_state(packet)


class HelmetStateEncodeRejectTest(unittest.TestCase):
    def test_rejects_heading_past_3599_unless_invalid_sentinel(self):
        for heading in (-1, 3600, 0xFFFE):
            with self.assertRaises(ValueError):
                encode_helmet_state(
                    HelmetState(heading_decidegrees=heading, heading_valid=True, buttons=0)
                )

    def test_rejects_mismatched_validity(self):
        with self.assertRaises(ValueError):
            encode_helmet_state(
                HelmetState(heading_decidegrees=HEADING_INVALID, heading_valid=True, buttons=0)
            )
        with self.assertRaises(ValueError):
            encode_helmet_state(
                HelmetState(heading_decidegrees=900, heading_valid=False, buttons=0)
            )

    def test_rejects_unknown_button_bits(self):
        with self.assertRaises(ValueError):
            encode_helmet_state(
                HelmetState(heading_decidegrees=0, heading_valid=True, buttons=0x08)
            )

    def test_talk_switch_is_button_bit_2(self):
        packet = encode_helmet_state(HelmetState(heading_decidegrees=0, heading_valid=True, buttons=BUTTON_TALK))
        self.assertEqual(packet, bytes([0x00, 0x00, 0x01, 0x04]))
        self.assertEqual(decode_helmet_state(packet).buttons, BUTTON_TALK)


class SensorSampleEncodeTest(unittest.TestCase):
    def test_known_sample_is_twenty_little_endian_bytes(self):
        packet = encode_sensor_sample(
            SensorSample(
                imu_ok=True,
                mic_ok=True,
                ax_mg=1000,
                ay_mg=-250,
                az_mg=980,
                gx_dps10=15,
                gy_dps10=0,
                gz_dps10=-20,
                mic_peak=12000,
            )
        )
        self.assertEqual(
            packet,
            bytes(
                [
                    0x01,
                    0x03,
                    0xE8,
                    0x03,
                    0x06,
                    0xFF,
                    0xD4,
                    0x03,
                    0x0F,
                    0x00,
                    0x00,
                    0x00,
                    0xEC,
                    0xFF,
                    0xE0,
                    0x2E,
                    0x00,
                    0x00,
                    0x00,
                    0x00,
                ]
            ),
        )

    def test_missing_sensors_clear_the_ok_bits(self):
        packet = encode_sensor_sample(
            SensorSample(False, False, 0, 0, 0, 0, 0, 0, 0)
        )
        self.assertEqual(packet[0], 0x01)
        self.assertEqual(packet[1], 0x00)
        self.assertEqual(len(packet), SENSOR_PACKET_LEN)


class SensorSampleDecodeTest(unittest.TestCase):
    def test_round_trip(self):
        original = SensorSample(True, True, 1000, -250, 980, 15, 0, -20, 12000)
        self.assertEqual(decode_sensor_sample(encode_sensor_sample(original)), original)

    def test_rejects_bad_length_version_and_flags(self):
        good = encode_sensor_sample(SensorSample(True, False, 1, 0, 0, 0, 0, 0, 0))
        for packet in (b"", good[:19], good + b"\x00", bytes([0x02]) + good[1:], bytes([0x01, 0x04]) + good[2:]):
            with self.assertRaises(ValueError):
                decode_sensor_sample(packet)


class AudioTest(unittest.TestCase):
    def test_ulaw_golden_values(self):
        self.assertEqual(
            [ulaw_encode(sample) for sample in (0, 1000, -1000, 32767, -32768)],
            [0xFF, 0xCE, 0x4E, 0x80, 0x00],
        )
        self.assertEqual(
            [ulaw_decode(byte) for byte in (0xFF, 0xCE, 0x4E, 0x80, 0x00)],
            [0, 988, -988, 32124, -32124],
        )

    def test_ulaw_round_trip_stays_within_its_step(self):
        for sample in range(-32124, 32125, 97):
            decoded = ulaw_decode(ulaw_encode(sample))
            self.assertLessEqual(abs(decoded - sample), max(16, abs(sample) // 16))

    def test_known_packet_is_version_sequence_then_ulaw(self):
        packet = encode_audio_packet(5, [0, 1000, -1000])
        self.assertEqual(packet, bytes([0x01, 0x05, 0xFF, 0xCE, 0x4E]))
        self.assertEqual(decode_audio_packet(packet), AudioPacket(5, (0, 988, -988)))

    def test_full_packet_fits_a_247_byte_mtu(self):
        packet = encode_audio_packet(255, [0] * AUDIO_MAX_SAMPLES)
        self.assertEqual(len(packet), 242)
        self.assertLessEqual(len(packet), 247 - 3)
        self.assertEqual(AUDIO_SAMPLE_RATE, 16000)
        self.assertEqual(AUDIO_CHARACTERISTIC_UUID, "7c1a0005-5e2b-4a6d-8f10-9b3c4d5e6f70")

    def test_rejects_bad_packets(self):
        for packet in (b"", bytes([0x01, 0x00]), bytes([0x02, 0x00, 0xFF]), bytes([0x01, 0x00]) + bytes(241)):
            with self.assertRaises(ValueError):
                decode_audio_packet(packet)
        for sequence, samples in ((0, []), (256, [0]), (0, [0] * 241), (0, [40000])):
            with self.assertRaises(ValueError):
                encode_audio_packet(sequence, samples)


if __name__ == "__main__":
    unittest.main()
