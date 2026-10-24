"""Routing fixtures and provider selection. No live map call."""

import unittest

from shared.nav.engine import CueEngine, Fix, Route
from shared.nav.geo import distance_m
from shared.protocol.codec import DIRECTION_LEFT, encode_cue
from shared.routing.providers import (
    MapboxProvider,
    OpenRouteServiceProvider,
    Place,
    mapbox_route_request,
    ors_route_request,
    places_from_mapbox,
    places_from_openrouteservice,
    route_from_mapbox,
    route_from_openrouteservice,
    select_provider,
)
from shared.routing.test_support import left_turn_points, mapbox_left_turn, ors_left_turn

ORIGIN = (37.1, -122.2)
DESTINATION = (37.5, -122.4)


class ProviderSelectionTest(unittest.TestCase):
    def test_mapbox_token_wins(self):
        provider = select_provider(mapbox_token="pk.test", ors_key="ors.test", http=None)
        self.assertIsInstance(provider, MapboxProvider)
        self.assertEqual(provider.name, "mapbox")

    def test_openrouteservice_is_the_fallback(self):
        provider = select_provider(mapbox_token=None, ors_key="ors.test", http=None)
        self.assertIsInstance(provider, OpenRouteServiceProvider)
        self.assertEqual(provider.name, "openrouteservice")

    def test_missing_credentials_raise(self):
        with self.assertRaises(ValueError):
            select_provider(mapbox_token=None, ors_key=None, http=None)


class RequestShapeTest(unittest.TestCase):
    def test_mapbox_cycling_request_uses_lng_lat_and_geojson(self):
        request = mapbox_route_request(ORIGIN, DESTINATION, "pk.test")
        self.assertEqual(request.method, "GET")
        self.assertIn("/directions/v5/mapbox/cycling/", request.url)
        self.assertIn("-122.2,37.1;-122.4,37.5", request.url)
        self.assertEqual(request.query["geometries"], "geojson")
        self.assertEqual(request.query["overview"], "full")
        self.assertEqual(request.query["steps"], "true")
        self.assertEqual(request.query["access_token"], "pk.test")
        self.assertEqual(request.body, {})

    def test_openrouteservice_cycling_request_posts_lng_lat_pairs(self):
        request = ors_route_request(ORIGIN, DESTINATION, "ors.test")
        self.assertEqual(request.method, "POST")
        self.assertIn("cycling-regular", request.url)
        self.assertEqual(request.body["coordinates"], [[-122.2, 37.1], [-122.4, 37.5]])
        self.assertEqual(request.headers["Authorization"], "ors.test")


class MapboxParseTest(unittest.TestCase):
    def test_left_turn_becomes_two_engine_steps(self):
        start, junction, end = left_turn_points()
        route = route_from_mapbox(mapbox_left_turn(modifier="slight left"))
        self.assertIsInstance(route, Route)
        self.assertEqual(len(route.steps), 2)
        self.assertEqual(route.steps[0].geometry[0], start)
        self.assertEqual(route.steps[0].geometry[-1], junction)
        self.assertEqual(route.steps[0].end_maneuver.kind, "turn")
        self.assertEqual(route.steps[0].end_maneuver.modifier, "left")
        self.assertEqual(route.steps[0].inbound_bearing_deg, 0)
        self.assertNotEqual(route.steps[0].end_maneuver.kind, "depart")
        self.assertEqual(route.steps[1].geometry[0], junction)
        self.assertEqual(route.steps[1].geometry[-1], end)
        self.assertEqual(route.steps[1].end_maneuver.kind, "arrive")
        self.assertEqual(route.steps[1].inbound_bearing_deg, 270)

    def test_uturn_and_sharp_right_collapse_onto_the_three_motors(self):
        uturn = route_from_mapbox(mapbox_left_turn(modifier="uturn"))
        sharp_right = route_from_mapbox(mapbox_left_turn(modifier="sharp right"))
        self.assertEqual(uturn.steps[0].end_maneuver.modifier, "uturn")
        self.assertEqual(sharp_right.steps[0].end_maneuver.modifier, "right")

    def test_short_arrive_marker_is_not_its_own_step(self):
        route = route_from_mapbox(mapbox_left_turn())
        self.assertEqual(len(route.steps), 2)
        self.assertGreater(distance_m(route.steps[1].geometry[0], route.steps[1].geometry[-1]), 5)

    def test_empty_payload_raises(self):
        with self.assertRaises(ValueError):
            route_from_mapbox({"routes": []})


class OpenRouteServiceParseTest(unittest.TestCase):
    def test_same_corner_matches_the_mapbox_engine_route(self):
        start, junction, end = left_turn_points()
        route = route_from_openrouteservice(ors_left_turn())
        self.assertEqual(len(route.steps), 2)
        self.assertEqual(route.steps[0].geometry[0], start)
        self.assertEqual(route.steps[0].geometry[-1], junction)
        self.assertEqual(route.steps[0].end_maneuver.kind, "turn")
        self.assertEqual(route.steps[0].end_maneuver.modifier, "left")
        self.assertAlmostEqual(route.steps[0].inbound_bearing_deg, 0, delta=0.5)
        self.assertEqual(route.steps[1].geometry[0], junction)
        self.assertEqual(route.steps[1].geometry[-1], end)
        self.assertEqual(route.steps[1].end_maneuver.kind, "arrive")
        self.assertAlmostEqual(route.steps[1].inbound_bearing_deg, 270, delta=0.5)

    def test_empty_payload_raises(self):
        with self.assertRaises(ValueError):
            route_from_openrouteservice({"features": []})


class PlaceParseTest(unittest.TestCase):
    def test_mapbox_place_swaps_center_to_lat_lng(self):
        places = places_from_mapbox(
            {"features": [{"place_name": "Sather Gate", "center": [-122.259, 37.870]}]}
        )
        self.assertEqual(places, [Place("Sather Gate", 37.870, -122.259)])

    def test_openrouteservice_place_uses_the_label(self):
        places = places_from_openrouteservice(
            {
                "features": [
                    {
                        "properties": {"label": "Sather Gate"},
                        "geometry": {"coordinates": [-122.259, 37.870]},
                    }
                ]
            }
        )
        self.assertEqual(places, [Place("Sather Gate", 37.870, -122.259)])

    def test_no_matches_is_an_empty_list(self):
        self.assertEqual(places_from_mapbox({"features": []}), [])
        self.assertEqual(places_from_openrouteservice({"features": []}), [])


class ProviderHttpTest(unittest.TestCase):
    def test_mapbox_provider_parses_the_fake_response_and_does_not_pick_the_direction(self):
        payload = mapbox_left_turn(modifier="slight left")
        seen = {}

        def http(request):
            seen["request"] = request
            return payload

        start, _junction, end = left_turn_points()
        route = MapboxProvider("pk.test", http).route(start, end)
        self.assertIn("/directions/v5/mapbox/cycling/", seen["request"].url)
        self.assertEqual(route.steps[0].end_maneuver.modifier, "left")

    def test_parsed_route_encodes_the_esp32_left_byte(self):
        start, junction, _end = left_turn_points()
        route = route_from_mapbox(mapbox_left_turn(modifier="slight left"))
        rider = Fix(start[0] + 0.8 * (junction[0] - start[0]), start[1], 10, 0, None)
        decision = CueEngine(route).update(rider)
        self.assertEqual(decision.cue.direction, DIRECTION_LEFT)
        self.assertEqual(encode_cue(decision.cue)[1], DIRECTION_LEFT)


if __name__ == "__main__":
    unittest.main()
