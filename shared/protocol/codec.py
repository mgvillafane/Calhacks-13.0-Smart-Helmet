"""BLE packet types shared by the phone and the ESP32-S3 peripheral.

The phone writes an 8-byte cue. The ESP32 notifies a 4-byte helmet state.
Both directions are little-endian. shared/protocol/test_codec.py is the
contract the firmware codec must match.
"""

from dataclasses import dataclass

PROTOCOL_VERSION = 1

CUE_PACKET_LEN = 8
HELMET_STATE_PACKET_LEN = 4

DIRECTION_NONE = 0
DIRECTION_LEFT = 1
DIRECTION_FRONT = 2
DIRECTION_RIGHT = 3
DIRECTION_UTURN = 4

FLAG_ARRIVED = 1 << 0
FLAG_OFF_ROUTE = 1 << 1
FLAG_REROUTING = 1 << 2

BUTTON_MODE = 1 << 0
BUTTON_SOS = 1 << 1

HEADING_INVALID = 0xFFFF

DEVICE_NAME = "SmartHelmet"
SERVICE_UUID = "7c1a0001-5e2b-4a6d-8f10-9b3c4d5e6f70"
CUE_CHARACTERISTIC_UUID = "7c1a0002-5e2b-4a6d-8f10-9b3c4d5e6f70"
HELMET_STATE_CHARACTERISTIC_UUID = "7c1a0003-5e2b-4a6d-8f10-9b3c4d5e6f70"

_CUE_FLAG_MASK = FLAG_ARRIVED | FLAG_OFF_ROUTE | FLAG_REROUTING
_BUTTON_MASK = BUTTON_MODE | BUTTON_SOS


@dataclass(frozen=True)
class Cue:
    direction: int
    intensity: int
    pulse_period_ms: int
    distance_m: int
    flags: int


@dataclass(frozen=True)
class HelmetState:
    heading_decidegrees: int
    heading_valid: bool
    buttons: int


def _uint(name, value, high):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > high:
        raise ValueError("%s out of range" % name)


def encode_cue(cue):
    if not isinstance(cue, Cue):
        raise ValueError("expected Cue")
    _uint("direction", cue.direction, DIRECTION_UTURN)
    _uint("intensity", cue.intensity, 255)
    _uint("pulse_period_ms", cue.pulse_period_ms, 65535)
    _uint("distance_m", cue.distance_m, 65535)
    _uint("flags", cue.flags, _CUE_FLAG_MASK)
    return bytes(
        (
            PROTOCOL_VERSION,
            cue.direction,
            cue.intensity,
            cue.pulse_period_ms & 0xFF,
            (cue.pulse_period_ms >> 8) & 0xFF,
            cue.distance_m & 0xFF,
            (cue.distance_m >> 8) & 0xFF,
            cue.flags,
        )
    )


def decode_cue(packet):
    if isinstance(packet, str) or len(packet) != CUE_PACKET_LEN:
        raise ValueError("cue packet must be 8 bytes")
    data = bytes(packet)
    version = data[0]
    direction = data[1]
    intensity = data[2]
    pulse_period_ms = data[3] | (data[4] << 8)
    distance_m = data[5] | (data[6] << 8)
    flags = data[7]
    if version != PROTOCOL_VERSION:
        raise ValueError("unsupported cue version")
    if direction > DIRECTION_UTURN:
        raise ValueError("unknown direction")
    if flags & ~_CUE_FLAG_MASK:
        raise ValueError("unknown cue flags")
    return Cue(direction, intensity, pulse_period_ms, distance_m, flags)


def encode_helmet_state(state):
    if not isinstance(state, HelmetState):
        raise ValueError("expected HelmetState")
    if not isinstance(state.heading_valid, bool):
        raise ValueError("heading_valid must be true or false")
    _uint("heading_decidegrees", state.heading_decidegrees, 0xFFFF)
    _uint("buttons", state.buttons, _BUTTON_MASK)
    if state.heading_valid:
        if state.heading_decidegrees > 3599:
            raise ValueError("valid heading must be 0..3599 decidegrees")
    elif state.heading_decidegrees != HEADING_INVALID:
        raise ValueError("invalid heading must use the 0xFFFF sentinel")
    valid_byte = 1 if state.heading_valid else 0
    heading = state.heading_decidegrees
    return bytes((heading & 0xFF, (heading >> 8) & 0xFF, valid_byte, state.buttons))


def decode_helmet_state(packet):
    if isinstance(packet, str) or len(packet) != HELMET_STATE_PACKET_LEN:
        raise ValueError("helmet state packet must be 4 bytes")
    data = bytes(packet)
    heading = data[0] | (data[1] << 8)
    valid_byte = data[2]
    buttons = data[3]
    if valid_byte not in (0, 1):
        raise ValueError("heading validity must be 0 or 1")
    if buttons & ~_BUTTON_MASK:
        raise ValueError("unknown button bits")
    heading_valid = valid_byte == 1
    if heading_valid:
        if heading > 3599:
            raise ValueError("valid heading must be 0..3599 decidegrees")
    elif heading != HEADING_INVALID:
        raise ValueError("invalid heading must use the 0xFFFF sentinel")
    return HelmetState(heading, heading_valid, buttons)
