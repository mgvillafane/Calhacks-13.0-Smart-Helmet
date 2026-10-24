"""BLE packet types shared by the phone and the ESP32-S3 peripheral.

The phone writes an 8-byte cue. The ESP32 notifies a 4-byte helmet state
and a 20-byte sensor sample. Both directions are little-endian.
shared/protocol/test_codec.py is the contract the firmware codec must match.
"""

from dataclasses import dataclass

PROTOCOL_VERSION = 1

CUE_PACKET_LEN = 8
HELMET_STATE_PACKET_LEN = 4
SENSOR_PACKET_LEN = 20

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

FLAG_IMU_OK = 1 << 0
FLAG_MIC_OK = 1 << 1

HEADING_INVALID = 0xFFFF

DEVICE_NAME = "SmartHelmet"
SERVICE_UUID = "7c1a0001-5e2b-4a6d-8f10-9b3c4d5e6f70"
CUE_CHARACTERISTIC_UUID = "7c1a0002-5e2b-4a6d-8f10-9b3c4d5e6f70"
HELMET_STATE_CHARACTERISTIC_UUID = "7c1a0003-5e2b-4a6d-8f10-9b3c4d5e6f70"
SENSOR_CHARACTERISTIC_UUID = "7c1a0004-5e2b-4a6d-8f10-9b3c4d5e6f70"

_CUE_FLAG_MASK = FLAG_ARRIVED | FLAG_OFF_ROUTE | FLAG_REROUTING
_BUTTON_MASK = BUTTON_MODE | BUTTON_SOS
_SENSOR_FLAG_MASK = FLAG_IMU_OK | FLAG_MIC_OK


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


@dataclass(frozen=True)
class SensorSample:
    imu_ok: bool
    mic_ok: bool
    ax_mg: int
    ay_mg: int
    az_mg: int
    gx_dps10: int
    gy_dps10: int
    gz_dps10: int
    mic_peak: int


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


def _int16(name, value):
    if isinstance(value, bool) or not isinstance(value, int) or value < -32768 or value > 32767:
        raise ValueError("%s out of range" % name)


def _pack_i16(value):
    raw = value & 0xFFFF
    return raw & 0xFF, (raw >> 8) & 0xFF


def _unpack_i16(lo, hi):
    value = lo | (hi << 8)
    if value >= 32768:
        value -= 65536
    return value


def encode_sensor_sample(sample):
    if not isinstance(sample, SensorSample):
        raise ValueError("expected SensorSample")
    if not isinstance(sample.imu_ok, bool) or not isinstance(sample.mic_ok, bool):
        raise ValueError("imu_ok and mic_ok must be true or false")
    _int16("ax_mg", sample.ax_mg)
    _int16("ay_mg", sample.ay_mg)
    _int16("az_mg", sample.az_mg)
    _int16("gx_dps10", sample.gx_dps10)
    _int16("gy_dps10", sample.gy_dps10)
    _int16("gz_dps10", sample.gz_dps10)
    _int16("mic_peak", sample.mic_peak)
    flags = (FLAG_IMU_OK if sample.imu_ok else 0) | (FLAG_MIC_OK if sample.mic_ok else 0)
    ax = _pack_i16(sample.ax_mg)
    ay = _pack_i16(sample.ay_mg)
    az = _pack_i16(sample.az_mg)
    gx = _pack_i16(sample.gx_dps10)
    gy = _pack_i16(sample.gy_dps10)
    gz = _pack_i16(sample.gz_dps10)
    mic = _pack_i16(sample.mic_peak)
    return bytes(
        (
            PROTOCOL_VERSION,
            flags,
            ax[0],
            ax[1],
            ay[0],
            ay[1],
            az[0],
            az[1],
            gx[0],
            gx[1],
            gy[0],
            gy[1],
            gz[0],
            gz[1],
            mic[0],
            mic[1],
            0,
            0,
            0,
            0,
        )
    )


def decode_sensor_sample(packet):
    if isinstance(packet, str) or len(packet) != SENSOR_PACKET_LEN:
        raise ValueError("sensor packet must be 20 bytes")
    data = bytes(packet)
    if data[0] != PROTOCOL_VERSION:
        raise ValueError("unsupported sensor version")
    flags = data[1]
    if flags & ~_SENSOR_FLAG_MASK:
        raise ValueError("unknown sensor flags")
    return SensorSample(
        imu_ok=bool(flags & FLAG_IMU_OK),
        mic_ok=bool(flags & FLAG_MIC_OK),
        ax_mg=_unpack_i16(data[2], data[3]),
        ay_mg=_unpack_i16(data[4], data[5]),
        az_mg=_unpack_i16(data[6], data[7]),
        gx_dps10=_unpack_i16(data[8], data[9]),
        gy_dps10=_unpack_i16(data[10], data[11]),
        gz_dps10=_unpack_i16(data[12], data[13]),
        mic_peak=_unpack_i16(data[14], data[15]),
    )
