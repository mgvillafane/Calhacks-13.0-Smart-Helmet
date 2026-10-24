"""Phone-side BLE session. The ESP32-S3 is the peripheral.

The radio object stands in for the phone Bluetooth stack. This session finds
SmartHelmet, writes the encoded cue, and reads heading notifies. It does not
choose a direction.
"""

from dataclasses import dataclass

from shared.protocol.codec import (
    CUE_CHARACTERISTIC_UUID,
    DEVICE_NAME,
    DIRECTION_NONE,
    HELMET_STATE_CHARACTERISTIC_UUID,
    decode_helmet_state,
    encode_cue,
)

RESEND_S = 1.0
HEADING_FRESH_S = 1.0


@dataclass(frozen=True)
class Advertisement:
    name: str
    address: str


class HelmetLink:
    def __init__(self, radio):
        self.radio = radio
        self.connected = False
        self.heading_deg = None
        self.heading_age_s = None
        self.buttons = 0
        self._heading_at_s = None
        self._last_payload = None
        self._last_sent_s = None

    def scan(self):
        for advertisement in self.radio.scan():
            if advertisement.name == DEVICE_NAME:
                return advertisement
        return None

    def connect(self, advertisement):
        if advertisement.name != DEVICE_NAME:
            raise ValueError("expected %s" % DEVICE_NAME)
        self.radio.connect(advertisement.address)
        self.radio.subscribe(HELMET_STATE_CHARACTERISTIC_UUID)
        self.connected = True

    def disconnect(self):
        self.radio.disconnect()
        self.connected = False
        self.heading_deg = None
        self.heading_age_s = None
        self._heading_at_s = None
        self.buttons = 0
        self._last_payload = None
        self._last_sent_s = None

    def send(self, cue, now_s):
        self._require_connected()
        payload = encode_cue(cue)
        repeat = (
            cue.direction != DIRECTION_NONE
            and self._last_sent_s is not None
            and now_s - self._last_sent_s >= RESEND_S
        )
        if payload != self._last_payload or repeat:
            self.radio.write_without_response(CUE_CHARACTERISTIC_UUID, payload)
            self._last_payload = payload
            self._last_sent_s = now_s

    def poll(self, now_s):
        self._require_connected()
        for packet in self.radio.take_notifications(HELMET_STATE_CHARACTERISTIC_UUID):
            try:
                state = decode_helmet_state(packet)
            except ValueError:
                continue
            self.buttons = state.buttons
            if state.heading_valid:
                self.heading_deg = state.heading_decidegrees / 10.0
                self._heading_at_s = now_s
            else:
                self.heading_deg = None
                self.heading_age_s = None
                self._heading_at_s = None
        self._expire_heading(now_s)

    def _require_connected(self):
        if not self.connected:
            raise ValueError("helmet is not connected")

    def _expire_heading(self, now_s):
        if self._heading_at_s is None:
            return
        age = now_s - self._heading_at_s
        if age > HEADING_FRESH_S:
            self.heading_deg = None
            self.heading_age_s = None
            self._heading_at_s = None
            return
        self.heading_age_s = age
