"""Route progress and vibration decisions.

The ESP32 only receives a Cue. This module decides that cue from a route
and a location fix. The phone sends the encoded bytes. The helmet does not
choose the direction.
"""

import math
from dataclasses import dataclass

from shared.nav.geo import EARTH_RADIUS_M, bearing_deg, point_along, project_onto, wrap_signed_deg
from shared.protocol.codec import (
    DIRECTION_FRONT,
    DIRECTION_LEFT,
    DIRECTION_NONE,
    DIRECTION_RIGHT,
    DIRECTION_UTURN,
    FLAG_ARRIVED,
    FLAG_OFF_ROUTE,
    FLAG_REROUTING,
    Cue,
)

OFF_ROUTE_M = 30
OFF_ROUTE_FIXES = 3
LOOKAHEAD_SECONDS = 5
LOOKAHEAD_MIN_M = 25
LOOKAHEAD_MAX_M = 80
GPS_COURSE_MIN_SPEED_M_S = 2
PROVIDER_TRUST_DEG = 45
FRONT_BUCKET_DEG = 30
UTURN_BUCKET_DEG = 150
BEYOND_JUNCTION_M = 15
CUE_INTENSITY = 160
PULSE_FAR_MS = 800
PULSE_NEAR_MS = 200


@dataclass(frozen=True)
class Maneuver:
    kind: str
    modifier: str


@dataclass(frozen=True)
class Step:
    geometry: tuple
    end_maneuver: Maneuver
    inbound_bearing_deg: float


@dataclass(frozen=True)
class Route:
    steps: tuple


@dataclass(frozen=True)
class Fix:
    lat: float
    lng: float
    speed_m_s: float
    gps_course_deg: float
    helmet_heading_deg: float


@dataclass(frozen=True)
class Decision:
    cue: Cue
    step_index: int
    distance_to_maneuver_m: float
    cross_track_m: float
    heading_deg: float
    heading_source: str
    reroute: bool
    arrived: bool


class CueEngine:
    def __init__(self, route):
        self.route = route
        self._reset_progress()

    def _reset_progress(self):
        self._step_index = 0
        self._off_route_count = 0
        self._arrived = False

    def replace_route(self, route):
        self.route = route
        self._reset_progress()

    def simulate(self, distance_m, speed_m_s):
        polyline = _route_polyline(self.route)
        point = point_along(polyline, distance_m)
        earlier = point_along(polyline, max(0.0, distance_m - 1.0))
        if distance_m <= 0:
            course = bearing_deg(polyline[0], polyline[min(1, len(polyline) - 1)])
        else:
            course = bearing_deg(earlier, point)
        return self.update(Fix(point[0], point[1], speed_m_s, course, None))

    def update(self, fix):
        if self._arrived:
            _step, projection = self._locate(fix)
            return self._decision(fix, projection, _quiet(projection.remaining_m, 0), True, False)

        step, projection = self._locate(fix)
        heading, source = _select_heading(fix)
        if projection.cross_track_m > OFF_ROUTE_M:
            self._off_route_count += 1
            reroute = self._off_route_count >= OFF_ROUTE_FIXES
            flags = FLAG_OFF_ROUTE | (FLAG_REROUTING if reroute else 0)
            return self._decision(fix, projection, _quiet(projection.remaining_m, flags), False, reroute)

        self._off_route_count = 0
        maneuver = step.end_maneuver
        window = lookahead_m(fix.speed_m_s)
        if maneuver.kind == "depart" or projection.remaining_m >= window:
            return self._decision(fix, projection, _quiet(projection.remaining_m, 0), False, False)
        if maneuver.kind == "arrive":
            self._arrived = True
            cue = Cue(DIRECTION_FRONT, CUE_INTENSITY, PULSE_NEAR_MS, _meters(projection.remaining_m), FLAG_ARRIVED)
            return self._decision(fix, projection, cue, True, False)
        if heading is None:
            return self._decision(fix, projection, _quiet(projection.remaining_m, 0), False, False)

        angle = self._turn_angle(step, projection, heading)
        period = PULSE_NEAR_MS + (PULSE_FAR_MS - PULSE_NEAR_MS) * (projection.remaining_m / window)
        cue = Cue(direction_for_angle(angle), CUE_INTENSITY, int(round(period)), _meters(projection.remaining_m), 0)
        return self._decision(fix, projection, cue, False, False)

    def _decision(self, fix, projection, cue, arrived, reroute):
        heading, source = _select_heading(fix)
        return Decision(
            cue,
            self._step_index,
            projection.remaining_m,
            projection.cross_track_m,
            heading,
            source,
            reroute,
            arrived,
        )

    def _locate(self, fix):
        point = (fix.lat, fix.lng)
        while True:
            step = self.route.steps[self._step_index]
            projection = project_onto(point, step.geometry)
            has_next = self._step_index + 1 < len(self.route.steps)
            if projection.remaining_m <= 1 and has_next:
                self._step_index += 1
                continue
            return step, projection

    def _turn_angle(self, step, projection, heading):
        modifier = step.end_maneuver.modifier
        if modifier in ("left", "right", "straight", "uturn") and provider_trusted(heading, step.inbound_bearing_deg):
            return modifier_angle_deg(modifier)
        target = self._point_beyond_junction(step)
        return wrap_signed_deg(bearing_deg(projection.snap, target) - heading)

    def _point_beyond_junction(self, step):
        if self._step_index + 1 < len(self.route.steps):
            return point_along(self.route.steps[self._step_index + 1].geometry, BEYOND_JUNCTION_M)
        geometry = step.geometry
        end_bearing = bearing_deg(geometry[-2], geometry[-1])
        return _offset(geometry[-1], end_bearing, BEYOND_JUNCTION_M)


def lookahead_m(speed_m_s):
    raw = speed_m_s * LOOKAHEAD_SECONDS
    if raw < LOOKAHEAD_MIN_M:
        return LOOKAHEAD_MIN_M
    if raw > LOOKAHEAD_MAX_M:
        return LOOKAHEAD_MAX_M
    return raw


def direction_for_angle(angle_deg):
    magnitude = abs(angle_deg)
    if magnitude <= FRONT_BUCKET_DEG:
        return DIRECTION_FRONT
    if magnitude >= UTURN_BUCKET_DEG:
        return DIRECTION_UTURN
    if angle_deg < 0:
        return DIRECTION_LEFT
    return DIRECTION_RIGHT


def modifier_angle_deg(modifier):
    return {"left": -90, "right": 90, "straight": 0, "uturn": 180}[modifier]


def provider_trusted(heading_deg, inbound_bearing_deg):
    return abs(wrap_signed_deg(heading_deg - inbound_bearing_deg)) <= PROVIDER_TRUST_DEG


def _select_heading(fix):
    if fix.speed_m_s >= GPS_COURSE_MIN_SPEED_M_S:
        return fix.gps_course_deg, "gps"
    if fix.helmet_heading_deg is not None:
        return fix.helmet_heading_deg, "helmet"
    return None, "none"


def _meters(distance):
    return int(round(max(0.0, distance)))


def _quiet(remaining_m, flags):
    return Cue(DIRECTION_NONE, 0, 0, _meters(remaining_m), flags)


def _route_polyline(route):
    points = []
    for route_step in route.steps:
        if not points:
            points.extend(route_step.geometry)
        else:
            points.extend(route_step.geometry[1:])
    return tuple(points)


def _offset(origin, bearing, meters):
    north = math.cos(math.radians(bearing)) * meters
    east = math.sin(math.radians(bearing)) * meters
    lat = origin[0] + north / (EARTH_RADIUS_M * math.pi / 180)
    lng = origin[1] + east / ((EARTH_RADIUS_M * math.pi / 180) * math.cos(math.radians(origin[0])))
    return (lat, lng)
