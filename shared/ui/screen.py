"""Screen state for the navigation map.

The React Native map binds to ScreenState. It does not choose a turn.
Motors, the banner, and the puck heading all come from the cue decision.
"""

from dataclasses import dataclass, field

from shared.nav.engine import lookahead_m
from shared.nav.geo import distance_m, project_onto
from shared.protocol.codec import (
    DIRECTION_FRONT,
    DIRECTION_LEFT,
    DIRECTION_NONE,
    DIRECTION_RIGHT,
    DIRECTION_UTURN,
    FLAG_OFF_ROUTE,
)

_INSTRUCTIONS = {
    "left": "Turn left",
    "right": "Turn right",
    "straight": "Continue straight",
    "uturn": "Make a U-turn",
}

_HEADING_LABELS = {
    "gps": "GPS course",
    "helmet": "Helmet IMU",
    "none": "No heading",
}


@dataclass(frozen=True)
class Motors:
    left: bool = False
    front: bool = False
    right: bool = False


@dataclass(frozen=True)
class ScreenState:
    phase: str = "idle"
    destination_name: str = ""
    provider_name: str = ""
    instruction: str = ""
    meters_to_junction: int = 0
    motors: Motors = field(default_factory=Motors)
    traveled: tuple = ()
    remaining: tuple = ()
    puck: tuple = None
    puck_heading_deg: float = None
    heading_label: str = ""
    decision_marker: tuple = None
    lookahead_m: float = None
    ble_connected: bool = False
    heading_age_s: float = None
    banner: str = None
    cue_direction: int = 0


class NavSession:
    def __init__(self):
        self._state = ScreenState()
        self._route = None
        self._provider = ""
        self._destination = ""
        self._phase = "idle"

    def screen(self):
        return self._state

    def preview(self, route, provider_name, destination_name):
        if not route.steps:
            raise ValueError("route has no usable steps")
        self._route = route
        self._provider = provider_name
        self._destination = destination_name
        self._phase = "preview"
        self._state = self._quiet_state()
        return self._state

    def start(self):
        if self._route is None or self._phase == "idle":
            raise ValueError("preview a route before starting")
        self._phase = "navigating"
        self._state = self._quiet_state()
        return self._state

    def update(self, fix, decision, ble_connected, heading_age_s=None):
        if self._route is None or self._phase not in ("navigating", "arrived"):
            raise ValueError("navigation has not started")
        step = self._route.steps[decision.step_index]
        point = (fix.lat, fix.lng)
        projection = project_onto(point, step.geometry)
        traveled, remaining = _split_route(self._route, decision.step_index, projection.along_m, projection.snap)
        direction = decision.cue.direction
        if decision.reroute:
            banner = "Rerouting"
        elif decision.cue.flags & FLAG_OFF_ROUTE:
            banner = "Off route"
        else:
            banner = None
        self._phase = "arrived" if decision.arrived else "navigating"
        self._state = ScreenState(
            phase=self._phase,
            destination_name=self._destination,
            provider_name=self._provider,
            instruction=_instruction(step.end_maneuver),
            meters_to_junction=int(round(decision.distance_to_maneuver_m)),
            motors=_motors(direction),
            traveled=traveled,
            remaining=remaining,
            puck=point,
            puck_heading_deg=decision.heading_deg,
            heading_label=_HEADING_LABELS[decision.heading_source],
            decision_marker=step.geometry[-1],
            lookahead_m=lookahead_m(fix.speed_m_s),
            ble_connected=ble_connected,
            heading_age_s=heading_age_s if decision.heading_source == "helmet" else None,
            banner=banner,
            cue_direction=direction,
        )
        return self._state

    def _quiet_state(self):
        step = self._route.steps[0]
        return ScreenState(
            phase=self._phase,
            destination_name=self._destination,
            provider_name=self._provider,
            instruction=_instruction(step.end_maneuver),
            meters_to_junction=int(round(_path_length(step.geometry))),
            motors=Motors(),
            traveled=(),
            remaining=_join(step.geometry for step in self._route.steps),
            decision_marker=step.geometry[-1],
            cue_direction=DIRECTION_NONE,
        )


def _instruction(maneuver):
    if maneuver.kind == "arrive":
        return "Arrive"
    if maneuver.kind == "depart":
        return "Depart"
    return _INSTRUCTIONS[maneuver.modifier]


def _motors(direction):
    return Motors(
        left=direction in (DIRECTION_LEFT, DIRECTION_UTURN),
        front=direction == DIRECTION_FRONT,
        right=direction in (DIRECTION_RIGHT, DIRECTION_UTURN),
    )


def _split_route(route, step_index, along_m, snap):
    traveled = []
    for earlier in route.steps[:step_index]:
        _extend(traveled, earlier.geometry)
    prefix, suffix = _split_step(route.steps[step_index].geometry, along_m, snap)
    _extend(traveled, prefix)
    remaining = [snap]
    _extend(remaining, suffix)
    for later in route.steps[step_index + 1 :]:
        _extend(remaining, later.geometry)
    return tuple(traveled), tuple(remaining)


def _split_step(geometry, along_m, snap):
    if along_m <= 0.05:
        return [snap], [point for point in geometry if point != snap]
    prefix = [geometry[0]]
    walked = 0.0
    for index, (start, end) in enumerate(zip(geometry, geometry[1:]), start=1):
        length = distance_m(start, end)
        if walked + length <= along_m + 0.05:
            walked += length
            if end != prefix[-1]:
                prefix.append(end)
            continue
        if snap != prefix[-1]:
            prefix.append(snap)
        suffix = [point for point in geometry[index:] if point != snap]
        return prefix, suffix
    if snap != prefix[-1]:
        prefix.append(snap)
    return prefix, []


def _join(geometries):
    points = []
    for geometry in geometries:
        _extend(points, geometry)
    return tuple(points)


def _extend(points, extra):
    for point in extra:
        if not points or point != points[-1]:
            points.append(point)


def _path_length(geometry):
    return sum(distance_m(start, end) for start, end in zip(geometry, geometry[1:]))
