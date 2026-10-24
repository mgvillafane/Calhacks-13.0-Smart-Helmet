"""Recorded corners for routing tests. Coordinates are (lat, lng)."""

import math

from shared.nav.engine import EARTH_RADIUS_M

METERS_PER_DEGREE_LAT = EARTH_RADIUS_M * math.pi / 180.0


def move(lat, lng, north_m, east_m):
    lat_per_m = 1.0 / METERS_PER_DEGREE_LAT
    lng_per_m = 1.0 / (METERS_PER_DEGREE_LAT * math.cos(math.radians(lat)))
    return (lat + north_m * lat_per_m, lng + east_m * lng_per_m)


def left_turn_points():
    start = (37.0, -122.0)
    junction = move(*start, 100, 0)
    end = move(*junction, 0, -80)
    return start, junction, end


def _line(points):
    return {"type": "LineString", "coordinates": [[point[1], point[0]] for point in points]}


def _mapbox_step(kind, modifier, points, bearing_before, bearing_after):
    return {
        "maneuver": {
            "type": kind,
            "modifier": modifier,
            "bearing_before": bearing_before,
            "bearing_after": bearing_after,
            "location": [points[0][1], points[0][0]],
        },
        "geometry": _line(points),
        "name": "Test St",
    }


def mapbox_left_turn(modifier="left"):
    """Depart north, turn onto a west leg, then a zero-length arrive marker.

    The depart step's bearing_before is 180 so a parser that keeps the current
    maneuver, instead of the next one, cannot accidentally look correct.
    """
    start, junction, end = left_turn_points()
    return {
        "routes": [
            {
                "legs": [
                    {
                        "steps": [
                            _mapbox_step("depart", "straight", (start, junction), 180, 0),
                            _mapbox_step("turn", modifier, (junction, end), 0, 270),
                            _mapbox_step("arrive", "straight", (end, end), 270, 270),
                        ]
                    }
                ]
            }
        ]
    }


def ors_left_turn():
    start, junction, end = left_turn_points()
    return {
        "features": [
            {
                "geometry": _line((start, junction, end)),
                "properties": {
                    "segments": [
                        {
                            "steps": [
                                {"type": 11, "instruction": "Head north", "way_points": [0, 1]},
                                {"type": 0, "instruction": "Turn left", "way_points": [1, 2]},
                                {"type": 10, "instruction": "Arrive", "way_points": [2, 2]},
                            ]
                        }
                    ]
                },
            }
        ]
    }
