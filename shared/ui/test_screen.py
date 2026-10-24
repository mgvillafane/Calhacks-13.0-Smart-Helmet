"""Map screen state. No phone UI and no helmet."""

import unittest

from shared.nav.engine import CueEngine, Fix
from shared.nav.geo import distance_m
from shared.protocol.codec import DIRECTION_FRONT, DIRECTION_LEFT, DIRECTION_NONE, DIRECTION_UTURN, encode_cue
from shared.routing.providers import route_from_mapbox
from shared.routing.test_support import left_turn_points, mapbox_left_turn, move
from shared.ui.screen import NavSession


def _session(modifier="left", destination="Sather Gate"):
    route = route_from_mapbox(mapbox_left_turn(modifier=modifier))
    session = NavSession()
    session.preview(route, "mapbox", destination)
    session.start()
    return session, route


class IdleScreenTest(unittest.TestCase):
    def test_idle_has_no_route_and_no_motors(self):
        state = NavSession().screen()
        self.assertEqual(state.phase, "idle")
        self.assertEqual(state.traveled, ())
        self.assertEqual(state.remaining, ())
        self.assertFalse(state.motors.left or state.motors.front or state.motors.right)
        self.assertIsNone(state.banner)
        self.assertFalse(state.ble_connected)
        self.assertEqual(state.cue_direction, DIRECTION_NONE)


class PreviewTest(unittest.TestCase):
    def test_preview_shows_the_whole_route_and_stays_quiet(self):
        start, junction, end = left_turn_points()
        route = route_from_mapbox(mapbox_left_turn())
        state = NavSession().preview(route, "mapbox", "Sather Gate")
        self.assertEqual(state.phase, "preview")
        self.assertEqual(state.destination_name, "Sather Gate")
        self.assertEqual(state.provider_name, "mapbox")
        self.assertEqual(state.traveled, ())
        self.assertEqual(state.remaining[0], start)
        self.assertEqual(state.remaining[-1], end)
        self.assertEqual(state.decision_marker, junction)
        self.assertEqual(state.instruction, "Turn left")
        self.assertFalse(state.motors.left or state.motors.front or state.motors.right)
        self.assertIsNone(state.banner)
        self.assertFalse(state.ble_connected)

    def test_start_before_preview_raises(self):
        with self.assertRaises(ValueError):
            NavSession().start()

    def test_start_enters_navigation_without_a_buzz(self):
        route = route_from_mapbox(mapbox_left_turn())
        session = NavSession()
        session.preview(route, "mapbox", "Sather Gate")
        state = session.start()
        self.assertEqual(state.phase, "navigating")
        self.assertEqual(state.instruction, "Turn left")
        self.assertEqual(state.cue_direction, DIRECTION_NONE)
        self.assertFalse(state.motors.left)


class NavigatingScreenTest(unittest.TestCase):
    def test_left_cue_lights_only_the_left_motor_and_splits_the_polyline(self):
        start, junction, end = left_turn_points()
        session, route = _session()
        rider = move(*start, 60, 0)
        fix = Fix(*rider, 10, 0, None)
        decision = CueEngine(route).update(fix)
        state = session.update(fix, decision, ble_connected=True, heading_age_s=4)
        self.assertEqual(state.phase, "navigating")
        self.assertEqual(state.cue_direction, DIRECTION_LEFT)
        self.assertEqual(encode_cue(decision.cue)[1], DIRECTION_LEFT)
        self.assertTrue(state.motors.left)
        self.assertFalse(state.motors.front)
        self.assertFalse(state.motors.right)
        self.assertEqual(state.instruction, "Turn left")
        self.assertAlmostEqual(state.meters_to_junction, 40, delta=1)
        self.assertEqual(state.decision_marker, junction)
        self.assertEqual(state.lookahead_m, 50)
        self.assertEqual(state.puck, rider)
        self.assertEqual(state.puck_heading_deg, 0)
        self.assertEqual(state.heading_label, "GPS course")
        self.assertIsNone(state.heading_age_s)
        self.assertTrue(state.ble_connected)
        self.assertIsNone(state.banner)
        self.assertEqual(state.traveled[0], start)
        self.assertAlmostEqual(distance_m(state.traveled[0], state.traveled[-1]), 60, delta=1)
        self.assertEqual(state.remaining[-1], end)
        self.assertAlmostEqual(distance_m(state.remaining[0], junction), 40, delta=1)

    def test_far_from_the_corner_the_instruction_stays_and_the_motors_stay_off(self):
        start, _junction, _end = left_turn_points()
        session, route = _session()
        fix = Fix(*start, 2, 0, None)
        decision = CueEngine(route).update(fix)
        state = session.update(fix, decision, ble_connected=False)
        self.assertEqual(decision.cue.direction, DIRECTION_NONE)
        self.assertEqual(state.instruction, "Turn left")
        self.assertGreater(state.meters_to_junction, 50)
        self.assertFalse(state.motors.left or state.motors.front or state.motors.right)
        self.assertFalse(state.ble_connected)

    def test_stopped_rider_labels_helmet_heading_and_shows_its_age(self):
        start, _junction, _end = left_turn_points()
        session, route = _session()
        rider = move(*start, 80, 0)
        fix = Fix(*rider, 0.5, 90, 10)
        decision = CueEngine(route).update(fix)
        state = session.update(fix, decision, ble_connected=True, heading_age_s=3)
        self.assertEqual(state.heading_label, "Helmet IMU")
        self.assertEqual(state.puck_heading_deg, 10)
        self.assertEqual(state.heading_age_s, 3)
        self.assertTrue(state.motors.left)

    def test_uturn_lights_both_side_motors(self):
        start, _junction, _end = left_turn_points()
        session, route = _session(modifier="uturn")
        rider = move(*start, 80, 0)
        fix = Fix(*rider, 10, 0, None)
        decision = CueEngine(route).update(fix)
        state = session.update(fix, decision, ble_connected=True)
        self.assertEqual(state.cue_direction, DIRECTION_UTURN)
        self.assertEqual(state.instruction, "Make a U-turn")
        self.assertTrue(state.motors.left)
        self.assertTrue(state.motors.right)
        self.assertFalse(state.motors.front)

    def test_off_route_then_reroute_banners_stay_on_the_navigating_screen(self):
        start, _junction, _end = left_turn_points()
        session, route = _session()
        engine = CueEngine(route)
        engine.update(Fix(*start, 10, 0, None))
        off = Fix(*move(*start, 0, 40), 10, 0, None)
        first = session.update(off, engine.update(off), ble_connected=True)
        engine_again = CueEngine(route)
        engine_again.update(Fix(*start, 10, 0, None))
        engine_again.update(off)
        second_decision = engine_again.update(off)
        third_decision = engine_again.update(off)
        third = session.update(off, third_decision, ble_connected=True)
        self.assertEqual(first.banner, "Off route")
        self.assertEqual(first.phase, "navigating")
        self.assertFalse(first.motors.left)
        self.assertEqual(second_decision.reroute, False)
        self.assertEqual(third.banner, "Rerouting")
        self.assertEqual(third.phase, "navigating")
        self.assertFalse(third.motors.left or third.motors.front or third.motors.right)

    def test_arrival_lights_the_front_motor_once(self):
        _start, junction, _end = left_turn_points()
        session, route = _session()
        engine = CueEngine(route)
        rider = move(*junction, 0, -70)
        fix = Fix(*rider, 10, 270, None)
        first_decision = engine.update(fix)
        first = session.update(fix, first_decision, ble_connected=True)
        second = session.update(fix, engine.update(fix), ble_connected=True)
        self.assertEqual(first.phase, "arrived")
        self.assertEqual(first.instruction, "Arrive")
        self.assertEqual(first.cue_direction, DIRECTION_FRONT)
        self.assertTrue(first.motors.front)
        self.assertFalse(first.motors.left or first.motors.right)
        self.assertEqual(second.phase, "arrived")
        self.assertEqual(second.cue_direction, DIRECTION_NONE)
        self.assertFalse(second.motors.front)


if __name__ == "__main__":
    unittest.main()
