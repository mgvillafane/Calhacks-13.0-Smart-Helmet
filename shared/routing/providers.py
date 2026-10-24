"""Map routing adapters.

Parsers turn a recorded directions payload into the Route the cue engine
already understands. Providers call an injected HTTP function. The cue
engine still chooses the vibration direction.
"""

from dataclasses import dataclass
from urllib.parse import quote

from shared.nav.engine import Maneuver, Route, Step
from shared.nav.geo import bearing_deg, distance_m

MAPBOX_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/cycling/"
MAPBOX_GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places/"
ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/cycling-regular/geojson"
ORS_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"
SHORT_ARRIVE_M = 5

_ORS_MANEUVERS = {
    0: ("turn", "left"),
    1: ("turn", "right"),
    2: ("turn", "left"),
    3: ("turn", "right"),
    4: ("turn", "left"),
    5: ("turn", "right"),
    6: ("continue", "straight"),
    7: ("continue", "straight"),
    8: ("continue", "straight"),
    9: ("turn", "uturn"),
    10: ("arrive", "straight"),
    11: ("depart", "straight"),
    12: ("turn", "left"),
    13: ("turn", "right"),
}


@dataclass(frozen=True)
class Place:
    name: str
    lat: float
    lng: float


@dataclass(frozen=True)
class HttpRequest:
    method: str
    url: str
    query: dict
    body: dict
    headers: dict


@dataclass(frozen=True)
class _RawStep:
    geometry: tuple
    kind: str
    modifier: str
    bearing_before: float


class MapboxProvider:
    name = "mapbox"

    def __init__(self, token, http):
        self.token = token
        self.http = http

    def route(self, origin, destination):
        request = mapbox_route_request(origin, destination, self.token)
        return route_from_mapbox(self.http(request))

    def search(self, query, bias=None):
        query_params = {"access_token": self.token, "limit": "5"}
        if bias is not None:
            query_params["proximity"] = _lng_lat(bias)
        request = HttpRequest("GET", MAPBOX_GEOCODE_URL + quote(query) + ".json", query_params, {}, {})
        return places_from_mapbox(self.http(request))


class OpenRouteServiceProvider:
    name = "openrouteservice"

    def __init__(self, api_key, http):
        self.api_key = api_key
        self.http = http

    def route(self, origin, destination):
        request = ors_route_request(origin, destination, self.api_key)
        return route_from_openrouteservice(self.http(request))

    def search(self, query, bias=None):
        query_params = {"text": query, "size": "5"}
        if bias is not None:
            query_params["focus.point.lon"] = bias[1]
            query_params["focus.point.lat"] = bias[0]
        request = HttpRequest("GET", ORS_GEOCODE_URL, query_params, {}, {"Authorization": self.api_key})
        return places_from_openrouteservice(self.http(request))


def select_provider(mapbox_token=None, ors_key=None, http=None):
    if mapbox_token:
        return MapboxProvider(mapbox_token, http)
    if ors_key:
        return OpenRouteServiceProvider(ors_key, http)
    raise ValueError("a Mapbox token or OpenRouteService key is required")


def mapbox_route_request(origin, destination, token):
    path = _lng_lat(origin) + ";" + _lng_lat(destination)
    return HttpRequest(
        "GET",
        MAPBOX_DIRECTIONS_URL + path,
        {"geometries": "geojson", "overview": "full", "steps": "true", "access_token": token},
        {},
        {},
    )


def ors_route_request(origin, destination, api_key):
    return HttpRequest(
        "POST",
        ORS_DIRECTIONS_URL,
        {},
        {"coordinates": [[origin[1], origin[0]], [destination[1], destination[0]]]},
        {"Authorization": api_key},
    )


def route_from_mapbox(payload):
    routes = payload.get("routes") or []
    if not routes:
        raise ValueError("Mapbox response has no routes")
    legs = routes[0].get("legs") or []
    if not legs or not legs[0].get("steps"):
        raise ValueError("Mapbox route has no steps")
    raw_steps = []
    for step in legs[0]["steps"]:
        maneuver = step.get("maneuver") or {}
        coordinates = (step.get("geometry") or {}).get("coordinates")
        if not coordinates:
            raise ValueError("Mapbox step has no geometry")
        raw_steps.append(
            _RawStep(
                _lat_lng_points(coordinates),
                _mapbox_kind(maneuver.get("type") or "", maneuver.get("modifier")),
                _normalize_modifier(maneuver.get("modifier")),
                maneuver.get("bearing_before"),
            )
        )
    return _assemble(raw_steps)


def route_from_openrouteservice(payload):
    features = payload.get("features") or []
    if not features:
        raise ValueError("OpenRouteService response has no features")
    feature = features[0]
    coordinates = (feature.get("geometry") or {}).get("coordinates") or []
    segments = (feature.get("properties") or {}).get("segments") or []
    if not segments or not segments[0].get("steps"):
        raise ValueError("OpenRouteService route has no steps")
    raw_steps = []
    for step in segments[0]["steps"]:
        start, end = step["way_points"]
        points = _lat_lng_points(coordinates[start : end + 1])
        if not points:
            raise ValueError("OpenRouteService step has no geometry")
        kind, modifier = _ors_maneuver(step.get("type"))
        raw_steps.append(_RawStep(points, kind, modifier, None))
    return _assemble(raw_steps)


def places_from_mapbox(payload):
    places = []
    for feature in payload.get("features") or []:
        lng, lat = feature["center"]
        places.append(Place(feature["place_name"], lat, lng))
    return places


def places_from_openrouteservice(payload):
    places = []
    for feature in payload.get("features") or []:
        lng, lat = feature["geometry"]["coordinates"]
        places.append(Place(feature["properties"]["label"], lat, lng))
    return places


def _assemble(raw_steps):
    built = []
    for index, current in enumerate(raw_steps):
        if index + 1 < len(raw_steps):
            following = raw_steps[index + 1]
            maneuver = Maneuver(following.kind, following.modifier)
            inbound = following.bearing_before
            if inbound is None:
                inbound = _approach_bearing(current.geometry)
        else:
            maneuver = Maneuver(current.kind, current.modifier)
            inbound = current.bearing_before
            if inbound is None:
                inbound = _approach_bearing(current.geometry)
        built.append(Step(current.geometry, maneuver, inbound))
    if len(built) >= 2 and built[-1].end_maneuver.kind == "arrive" and _path_length(built[-1].geometry) < SHORT_ARRIVE_M:
        built.pop()
    if not built:
        raise ValueError("route has no usable steps")
    return Route(tuple(built))


def _mapbox_kind(maneuver_type, modifier):
    if maneuver_type in ("depart", "arrive"):
        return maneuver_type
    if maneuver_type in ("turn", "end of road", "fork", "roundabout", "rotary", "roundabout turn"):
        return "turn"
    if _normalize_modifier(modifier) in ("left", "right", "uturn"):
        return "turn"
    return "continue"


def _normalize_modifier(modifier):
    text = (modifier or "").lower().replace("_", " ")
    if "uturn" in text or "u-turn" in text:
        return "uturn"
    if "left" in text:
        return "left"
    if "right" in text:
        return "right"
    return "straight"


def _ors_maneuver(step_type):
    try:
        return _ORS_MANEUVERS[int(step_type)]
    except (KeyError, TypeError, ValueError):
        raise ValueError("unknown OpenRouteService step type")


def _lat_lng_points(coordinates):
    return tuple((pair[1], pair[0]) for pair in coordinates)


def _approach_bearing(points):
    if len(points) < 2 or points[0] == points[-1]:
        return 0
    return bearing_deg(points[0], points[-1])


def _path_length(points):
    if len(points) < 2:
        return 0.0
    return sum(distance_m(start, end) for start, end in zip(points, points[1:]))


def _lng_lat(point):
    return "%s,%s" % (point[1], point[0])
