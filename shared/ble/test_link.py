"""Phone BLE session against a fake radio. No phone and no helmet."""

import unittest

from shared.ble.link import HEADING_FRESH_S, RESEND_S, Advertisement, HelmetLink
from shared.nav.engine import CueEngine, Fix
from shared.protocol.codec import (
    BUTTON_MODE,
    BUTTON_SOS,
    CUE_CHARACTERISTIC_UUID,
    DEVICE_NAME,
    DIRECTION_FRONT,
    DIRECTION_LEFT,
    DIRECTION_NONE,
    FLAG_ARRIVED,
    HELMET_STATE_CHARACTERISTIC_UUID,
    Cue,
    encode_cue,
    encode_helmet_state,
    HelmetState,
)
from shared.routing.providers import route_from_mapbox
from shared.routing.test_support import left_turn_points, mapbox_left_turn, move


class FakeRadio:
    """Scripted central-side radio. The link decides what to scan, write, and read."""

    def __init__(self):
        self.advertisements = []
        self.writes = []
        self.subscribed = []
        self.connected_address = None
        self._notes = []

    def push_notify(self, packet):
        self._notes.append(bytes(packet))

    def scan(self):
        return list(self.advertisements)

    def connect(self, address):
        self.connected_address = address

    def disconnect(self):
        self.connected_address = None

    def write_without_response(self, characteristic_uuid, payload):
        self.writes.append((characteristic_uuid, bytes(payload)))

    def subscribe(self, characteristic_uuid):
        self.subscribed.append(characteristic_uuid)

    def take_notifications(self, characteristic_uuid):
        if characteristic_uuid != HELMET_STATE_CHARACTERISTIC_UUID:
            return []
        notes = list(self._notes)
        self._notes = []
        return notes


def _helmet():
    return Advertisement(DEVICE_NAME, "bb:bb")


def _connected():
    radio = FakeRadio()
    radio.advertisements = [Advertisement("Headphones", "aa:aa"), _helmet()]
    link = HelmetLink(radio)
    link.connect(link.scan())
    return link, radio


class IdleLinkTest(unittest.TestCase):
    def test_starts_disconnected_with_no_heading(self):
        link = HelmetLink(FakeRadio())
        self.assertFalse(link.connected)
        self.assertIsNone(link.heading_deg)
        self.assertIsNone(link.heading_age_s)
        self.assertEqual(link.buttons, 0)


class ScanTest(unittest.TestCase):
    def test_scan_returns_only_smarthelmet(self):
        radio = FakeRadio()
        radio.advertisements = [
            Advertisement("Headphones", "aa:aa"),
            Advertisement("smarthelmet", "cc:cc"),
            _helmet(),
        ]
        found = HelmetLink(radio).scan()
        self.assertEqual(found, _helmet())

    def test_scan_returns_none_when_the_helmet_is_absent(self):
        radio = FakeRadio()
        radio.advertisements = [Advertisement("Headphones", "aa:aa")]
        self.assertIsNone(HelmetLink(radio).scan())


class ConnectTest(unittest.TestCase):
    def test_connect_subscribes_to_helmet_state_and_writes_nothing(self):
        link, radio = _connected()
        self.assertTrue(link.connected)
        self.assertEqual(radio.connected_address, "bb:bb")
        self.assertEqual(radio.subscribed, [HELMET_STATE_CHARACTERISTIC_UUID])
        self.assertEqual(radio.writes, [])

    def test_connect_rejects_any_other_name(self):
        link = HelmetLink(FakeRadio())
        with self.assertRaises(ValueError):
            link.connect(Advertisement("Headphones", "aa:aa"))

    def test_send_and_poll_before_connect_raise(self):
        link = HelmetLink(FakeRadio())
        cue = Cue(DIRECTION_LEFT, 160, 500, 20, 0)
        with self.assertRaises(ValueError):
            link.send(cue, 0)
        with self.assertRaises(ValueError):
            link.poll(0)

    def test_disconnect_clears_heading_and_allows_reconnect(self):
        link, radio = _connected()
        radio.push_notify(bytes.fromhex("84030100"))
        link.poll(0)
        link.disconnect()
        self.assertFalse(link.connected)
        self.assertIsNone(radio.connected_address)
        self.assertIsNone(link.heading_deg)
        self.assertIsNone(link.heading_age_s)
        with self.assertRaises(ValueError):
            link.send(Cue(DIRECTION_LEFT, 160, 500, 20, 0), 1)
        link.connect(_helmet())
        self.assertTrue(link.connected)
        self.assertEqual(radio.subscribed, [HELMET_STATE_CHARACTERISTIC_UUID, HELMET_STATE_CHARACTERISTIC_UUID])


class CueWriteTest(unittest.TestCase):
    def test_left_decision_is_written_unchanged(self):
        start, _junction, _end = left_turn_points()
        route = route_from_mapbox(mapbox_left_turn())
        rider = move(*start, 80, 0)
        decision = CueEngine(route).update(Fix(*rider, 10, 0, None))
        link, radio = _connected()
        link.send(decision.cue, 0)
        characteristic, payload = radio.writes[0]
        self.assertEqual(characteristic, CUE_CHARACTERISTIC_UUID)
        self.assertEqual(payload, encode_cue(decision.cue))
        self.assertEqual(payload[1], DIRECTION_LEFT)
        self.assertEqual(len(payload), 8)

    def test_a_changed_cue_writes_immediately(self):
        link, radio = _connected()
        left = Cue(DIRECTION_LEFT, 160, 500, 20, 0)
        front = Cue(DIRECTION_FRONT, 160, 200, 5, FLAG_ARRIVED)
        link.send(left, 0)
        link.send(front, 0.2)
        self.assertEqual([payload for _uuid, payload in radio.writes], [encode_cue(left), encode_cue(front)])

    def test_an_active_cue_repeats_at_one_second(self):
        link, radio = _connected()
        cue = Cue(DIRECTION_LEFT, 160, 500, 20, 0)
        link.send(cue, 0)
        link.send(cue, RESEND_S - 0.001)
        self.assertEqual(len(radio.writes), 1)
        link.send(cue, RESEND_S)
        self.assertEqual(len(radio.writes), 2)
        self.assertEqual(radio.writes[1][1], encode_cue(cue))

    def test_a_quiet_cue_is_written_once_and_not_repeated(self):
        link, radio = _connected()
        quiet = Cue(DIRECTION_NONE, 0, 0, 40, 0)
        link.send(quiet, 0)
        link.send(quiet, RESEND_S + 2)
        self.assertEqual(radio.writes, [(CUE_CHARACTERISTIC_UUID, encode_cue(quiet))])


class HeadingTest(unittest.TestCase):
    def test_notify_converts_decidegrees_and_reports_buttons(self):
        link, radio = _connected()
        radio.push_notify(bytes.fromhex("84030101"))
        link.poll(5)
        self.assertEqual(link.heading_deg, 90.0)
        self.assertEqual(link.heading_age_s, 0)
        self.assertEqual(link.buttons, BUTTON_MODE)

    def test_heading_older_than_one_second_is_dropped(self):
        link, radio = _connected()
        radio.push_notify(bytes.fromhex("84030100"))
        link.poll(0)
        link.poll(HEADING_FRESH_S)
        self.assertEqual(link.heading_deg, 90.0)
        self.assertEqual(link.heading_age_s, HEADING_FRESH_S)
        link.poll(HEADING_FRESH_S + 0.01)
        self.assertIsNone(link.heading_deg)
        self.assertIsNone(link.heading_age_s)

    def test_a_new_notify_resets_age_and_heading(self):
        link, radio = _connected()
        radio.push_notify(bytes.fromhex("84030100"))
        link.poll(0)
        radio.push_notify(encode_helmet_state(HelmetState(1800, True, BUTTON_SOS)))
        link.poll(0.8)
        self.assertEqual(link.heading_deg, 180.0)
        self.assertEqual(link.heading_age_s, 0)
        self.assertEqual(link.buttons, BUTTON_SOS)

    def test_invalid_heading_clears_the_facing_direction(self):
        link, radio = _connected()
        radio.push_notify(bytes.fromhex("84030100"))
        link.poll(0)
        radio.push_notify(bytes.fromhex("ffff0000"))
        link.poll(0.2)
        self.assertIsNone(link.heading_deg)
        self.assertIsNone(link.heading_age_s)
        self.assertEqual(link.buttons, 0)

    def test_a_malformed_notify_keeps_the_previous_heading(self):
        link, radio = _connected()
        radio.push_notify(bytes.fromhex("84030100"))
        link.poll(0)
        radio.push_notify(bytes.fromhex("00000200"))
        link.poll(0.2)
        self.assertEqual(link.heading_deg, 90.0)
        self.assertAlmostEqual(link.heading_age_s, 0.2)


if __name__ == "__main__":
    unittest.main()
