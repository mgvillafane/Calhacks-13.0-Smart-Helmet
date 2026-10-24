"""Navigation decisions that become ESP32 cue packets.

No helmet and no map network are required. Geometry uses a spherical earth
with a radius of 6,371,000 m.
"""

import math
import unittest

from shared.nav.engine import (
    BEYOND_JUNCTION_M,
    CUE_INTENSITY,
    EARTH_RADIUS_M,
    FRONT_BUCKET_DEG,
    GPS_COURSE_MIN_SPEED_M_S,
    LOOKAHEAD_MAX_M,
    LOOKAHEAD_MIN_M,
    LOOKAHEAD_SECONDS,
    OFF_ROUTE_FIXES,
    OFF_ROUTE_M,
    PROVIDER_TRUST_DEG,
    PULSE_FAR_MS,
    PULSE_NEAR_MS,
    UTURN_BUCKET_DEG,
    CueEngine,
    Fix,
    Maneuver,
    Route,
    Step,
    direction_for_angle,
    lookahead_m,
    modifier_angle_deg,
    provider_trusted,
)
from shared.nav.geo import bearing_deg, distance_m, point_along, project_onto, wrap_signed_deg
from shared.protocol.codec import (
    DIRECTION_FRONT,
    DIRECTION_LEFT,
    DIRECTION_NONE,
    DIRECTION_RIGHT,
    DIRECTION_UTURN,
    FLAG_ARRIVED,
    FLAG_OFF_ROUTE,
    FLAG_REROUTING,
    encode_cue,
)

METERS_PER_DEGREE_LAT = EARTH_RADIUS_M * math.pi / 180


def move(lat, lng, north_m, east_m):
    lat_per_m = 1 / METERS_PER_DEGREE_LAT
    lng_per_m = 1 / (METERS_PER_DEGREE_LAT * math.cos(math.radians(lat)))
    return (lat + north_m * lat_per_m, lng + east_m * lng_per_m)


def step(points, kind, modifier, inbound=0.0):
    return Step(tuple(points), Maneuver(kind, modifier), inbound)


def engine_on(*steps):
    return CueEngine(Route(tuple(steps)))


class ConstantTest(unittest.TestCase):
    def test_thresholds_match_the_helmet_plan(self):
        self.assertEqual(EARTH_RADIUS_M, 6371000)
        self.assertEqual(OFF_ROUTE_M, 30)
        self.assertEqual(OFF_ROUTE_FIXES, 3)
        self.assertEqual(LOOKAHEAD_SECONDS, 5)
        self.assertEqual(LOOKAHEAD_MIN_M, 25)
        self.assertEqual(LOOKAHEAD_MAX_M, 80)
        self.assertEqual(GPS_COURSE_MIN_SPEED_M_S, 2)
        self.assertEqual(PROVIDER_TRUST_DEG, 45)
        self.assertEqual(FRONT_BUCKET_DEG, 30)
        self.assertEqual(UTURN_BUCKET_DEG, 150)
        self.assertEqual(BEYOND_JUNCTION_M, 15)
        self.assertEqual(CUE_INTENSITY, 160)
        self.assertEqual(PULSE_FAR_MS, 800)
        self.assertEqual(PULSE_NEAR_MS, 200)


class GeoTest(unittest.TestCase):
    def test_one_degree_of_latitude_is_the_meridian_arc(self):
        self.assertAlmostEqual(distance_m((0.0, 0.0), (1.0, 0.0)), METERS_PER_DEGREE_LAT, delta=0.01)

    def test_cardinal_bearings(self):
        self.assertAlmostEqual(bearing_deg((0.0, 0.0), (1.0, 0.0)), 0, delta=0.01)
        self.assertAlmostEqual(bearing_deg((0.0, 0.0), (0.0, 1.0)), 90, delta=0.01)
        self.assertAlmostEqual(bearing_deg((1.0, 0.0), (0.0, 0.0)), 180, delta=0.01)

    def test_wrap_signed_degrees_keeps_180_and_folds_past_it(self):
        self.assertAlmostEqual(wrap_signed_deg(180), 180, delta=0.001)
        self.assertAlmostEqual(wrap_signed_deg(-180), -180, delta=0.001)
        self.assertAlmostEqual(wrap_signed_deg(190), -170, delta=0.001)
        self.assertAlmostEqual(wrap_signed_deg(-190), 170, delta=0.001)
        self.assertAlmostEqual(wrap_signed_deg(360), 0, delta=0.001)

    def test_projection_reports_along_remaining_and_cross_track(self):
        start = (37.0, -122.0)
        end = move(*start, 100, 0)
        rider = move(*start, 40, 10)
        projection = project_onto(rider, (start, end))
        self.assertAlmostEqual(projection.along_m, 40, delta=0.5)
        self.assertAlmostEqual(projection.remaining_m, 60, delta=0.5)
        self.assertAlmostEqual(projection.cross_track_m, 10, delta=0.5)

    def test_point_along_walks_a_northbound_segment(self):
        start = (37.0, -122.0)
        end = move(*start, 100, 0)
        point = point_along((start, end), 25)
        self.assertAlmostEqual(distance_m(start, point), 25, delta=0.5)


class LookaheadAndBucketTest(unittest.TestCase):
    def test_lookahead_is_five_seconds_clamped_between_25_and_80(self):
        self.assertEqual(lookahead_m(0), 25)
        self.assertEqual(lookahead_m(2), 25)
        self.assertEqual(lookahead_m(10), 50)
        self.assertEqual(lookahead_m(16), 80)
        self.assertEqual(lookahead_m(30), 80)

    def test_direction_buckets(self):
        for angle in (0, 30, -30):
            self.assertEqual(direction_for_angle(angle), DIRECTION_FRONT, angle)
        self.assertEqual(direction_for_angle(31), DIRECTION_RIGHT)
        self.assertEqual(direction_for_angle(-31), DIRECTION_LEFT)
        self.assertEqual(direction_for_angle(149), DIRECTION_RIGHT)
        for angle in (150, -150, 180, -180):
            self.assertEqual(direction_for_angle(angle), DIRECTION_UTURN, angle)

    def test_provider_modifiers_and_trust(self):
        self.assertEqual(modifier_angle_deg("left"), -90)
        self.assertEqual(modifier_angle_deg("right"), 90)
        self.assertEqual(modifier_angle_deg("straight"), 0)
        self.assertEqual(modifier_angle_deg("uturn"), 180)
        self.assertTrue(provider_trusted(45, 0))
        self.assertFalse(provider_trusted(46, 0))


class CueDecisionTest(unittest.TestCase):
    def setUp(self):
        self.start = (37.0, -122.0)

    def _north_step(self, length_m, kind, modifier, inbound=0.0):
        return step((self.start, move(*self.start, length_m, 0)), kind, modifier, inbound)

    def test_quiet_before_the_lookahead_window(self):
        navigation = engine_on(self._north_step(200, "turn", "left"))
        decision = navigation.update(Fix(*self.start, 2, 0, None))
        self.assertEqual(decision.cue.direction, DIRECTION_NONE)
        self.assertEqual(decision.cue.intensity, 0)
        self.assertEqual(decision.cue.pulse_period_ms, 0)
        self.assertFalse(decision.reroute)

    def test_same_corner_opens_when_speed_brings_the_window_over_it(self):
        navigation = engine_on(self._north_step(30, "turn", "left"))
        quiet = navigation.update(Fix(*self.start, 2, 0, None))
        active = CueEngine(Route((self._north_step(30, "turn", "left"),))).update(
            Fix(*self.start, 10, 0, None)
        )
        self.assertEqual(quiet.cue.direction, DIRECTION_NONE)
        self.assertEqual(active.cue.direction, DIRECTION_LEFT)
        self.assertEqual(active.heading_source, "gps")

    def test_trusted_provider_left_encodes_the_esp32_left_byte(self):
        rider = move(*self.start, 60, 0)
        decision = engine_on(self._north_step(100, "turn", "left")).update(Fix(*rider, 10, 0, 90))
        self.assertEqual(decision.cue.direction, DIRECTION_LEFT)
        self.assertEqual(decision.cue.intensity, CUE_INTENSITY)
        self.assertEqual(decision.cue.flags, 0)
        self.assertAlmostEqual(decision.distance_to_maneuver_m, 40, delta=0.5)
        self.assertEqual(decision.cue.distance_m, round(decision.distance_to_maneuver_m))
        expected_period = PULSE_NEAR_MS + (PULSE_FAR_MS - PULSE_NEAR_MS) * (
            decision.distance_to_maneuver_m / lookahead_m(10)
        )
        self.assertAlmostEqual(decision.cue.pulse_period_ms, expected_period, delta=1)
        self.assertEqual(encode_cue(decision.cue)[1], DIRECTION_LEFT)
        self.assertEqual(decision.heading_source, "gps")
        self.assertEqual(decision.heading_deg, 0)

    def test_stopped_rider_uses_helmet_heading_and_ignores_gps_course(self):
        rider = move(*self.start, 80, 0)
        decision = engine_on(self._north_step(100, "turn", "right")).update(Fix(*rider, 0.5, 0, 10))
        self.assertEqual(decision.heading_source, "helmet")
        self.assertEqual(decision.heading_deg, 10)
        self.assertEqual(decision.cue.direction, DIRECTION_RIGHT)

    def test_missing_heading_does_not_buzz_a_turn(self):
        rider = move(*self.start, 80, 0)
        decision = engine_on(self._north_step(100, "turn", "left")).update(Fix(*rider, 0.5, 0, None))
        self.assertEqual(decision.heading_source, "none")
        self.assertIsNone(decision.heading_deg)
        self.assertEqual(decision.cue.direction, DIRECTION_NONE)

    def test_misaligned_rider_follows_the_road_past_the_junction(self):
        junction = move(*self.start, 100, 0)
        straight_on = move(*junction, 80, 0)
        route_step = step((self.start, junction), "turn", "right", inbound=0)
        next_step = step((junction, straight_on), "arrive", "straight", inbound=0)
        rider = move(*self.start, 90, 0)
        decision = engine_on(route_step, next_step).update(Fix(*rider, 10, 46, None))
        self.assertEqual(decision.cue.direction, DIRECTION_LEFT)

    def test_aligned_provider_turn_wins_over_the_straight_geometry(self):
        junction = move(*self.start, 100, 0)
        straight_on = move(*junction, 80, 0)
        route_step = step((self.start, junction), "turn", "right", inbound=0)
        next_step = step((junction, straight_on), "arrive", "straight", inbound=0)
        rider = move(*self.start, 90, 0)
        decision = engine_on(route_step, next_step).update(Fix(*rider, 10, 45, None))
        self.assertEqual(decision.cue.direction, DIRECTION_RIGHT)

    def test_straight_maneuver_is_a_front_pulse_only_inside_the_window(self):
        far = engine_on(self._north_step(200, "continue", "straight")).update(Fix(*self.start, 10, 0, None))
        near = engine_on(self._north_step(40, "continue", "straight")).update(
            Fix(*move(*self.start, 20, 0), 10, 0, None)
        )
        self.assertEqual(far.cue.direction, DIRECTION_NONE)
        self.assertEqual(near.cue.direction, DIRECTION_FRONT)
        self.assertEqual(near.cue.flags, 0)

    def test_depart_never_buzzes(self):
        decision = engine_on(self._north_step(20, "depart", "straight")).update(Fix(*self.start, 10, 0, None))
        self.assertEqual(decision.cue.direction, DIRECTION_NONE)

    def test_arrive_is_one_short_front_cue_and_then_navigation_ends(self):
        navigation = engine_on(self._north_step(30, "arrive", "straight"))
        rider = move(*self.start, 20, 0)
        first = navigation.update(Fix(*rider, 10, 0, None))
        second = navigation.update(Fix(*rider, 10, 0, None))
        self.assertEqual(first.cue.direction, DIRECTION_FRONT)
        self.assertEqual(first.cue.flags, FLAG_ARRIVED)
        self.assertEqual(first.cue.pulse_period_ms, PULSE_NEAR_MS)
        self.assertTrue(first.arrived)
        self.assertEqual(second.cue.direction, DIRECTION_NONE)
        self.assertTrue(second.arrived)

    def test_passing_the_junction_advances_and_drops_the_old_cue(self):
        junction = move(*self.start, 30, 0)
        end = move(*junction, 0, -200)
        navigation = engine_on(
            step((self.start, junction), "turn", "left"),
            step((junction, end), "arrive", "straight", inbound=270),
        )
        rider = move(*junction, 0, -5)
        decision = navigation.update(Fix(*rider, 10, 270, None))
        self.assertEqual(decision.step_index, 1)
        self.assertEqual(decision.cue.direction, DIRECTION_NONE)
        self.assertGreater(decision.distance_to_maneuver_m, lookahead_m(10))

    def test_first_off_route_fix_clears_the_cue_and_the_third_requests_reroute(self):
        navigation = engine_on(self._north_step(40, "turn", "left"))
        on_route = navigation.update(Fix(*self.start, 10, 0, None))
        self.assertEqual(on_route.cue.direction, DIRECTION_LEFT)
        off_rider = Fix(*move(*self.start, 0, 40), 10, 0, None)
        first = navigation.update(off_rider)
        second = navigation.update(off_rider)
        third = navigation.update(off_rider)
        self.assertEqual(first.cue.direction, DIRECTION_NONE)
        self.assertEqual(first.cue.flags & FLAG_OFF_ROUTE, FLAG_OFF_ROUTE)
        self.assertFalse(first.reroute)
        self.assertFalse(second.reroute)
        self.assertTrue(third.reroute)
        self.assertEqual(third.cue.flags & FLAG_REROUTING, FLAG_REROUTING)
        self.assertGreater(third.cross_track_m, OFF_ROUTE_M)

    def test_replace_route_clears_the_reroute_latch(self):
        navigation = engine_on(self._north_step(40, "turn", "left"))
        off_rider = Fix(*move(*self.start, 0, 40), 10, 0, None)
        for _ in range(3):
            navigation.update(off_rider)
        fresh = Route((self._north_step(200, "turn", "left"),))
        navigation.replace_route(fresh)
        decision = navigation.update(Fix(*self.start, 10, 0, None))
        self.assertFalse(decision.reroute)
        self.assertEqual(decision.cue.direction, DIRECTION_NONE)
        self.assertEqual(decision.step_index, 0)

    def test_simulate_walks_the_polyline_without_a_gps_fix(self):
        decision = engine_on(self._north_step(100, "turn", "left")).simulate(60, 10)
        self.assertEqual(decision.cue.direction, DIRECTION_LEFT)
        self.assertAlmostEqual(decision.distance_to_maneuver_m, 40, delta=0.5)
        self.assertEqual(decision.heading_source, "gps")


if __name__ == "__main__":
    unittest.main()
