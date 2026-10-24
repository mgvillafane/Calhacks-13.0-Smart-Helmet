"""Distance, bearing, and route projection on a 6,371,000 m sphere."""

import math
from dataclasses import dataclass

EARTH_RADIUS_M = 6371000
METERS_PER_DEGREE_LAT = EARTH_RADIUS_M * math.pi / 180


@dataclass(frozen=True)
class Projection:
    along_m: float
    remaining_m: float
    cross_track_m: float
    snap: tuple


def distance_m(origin, destination):
    lat1, lng1 = math.radians(origin[0]), math.radians(origin[1])
    lat2, lng2 = math.radians(destination[0]), math.radians(destination[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    chord = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(chord)))


def bearing_deg(origin, destination):
    lat1, lng1 = math.radians(origin[0]), math.radians(origin[1])
    lat2, lng2 = math.radians(destination[0]), math.radians(destination[1])
    dlng = lng2 - lng1
    east = math.sin(dlng) * math.cos(lat2)
    north = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return (math.degrees(math.atan2(east, north)) + 360.0) % 360.0


def wrap_signed_deg(angle_deg):
    wrapped = (angle_deg + 180.0) % 360.0 - 180.0
    if wrapped == -180.0 and angle_deg > 0:
        return 180.0
    return wrapped


def _xy(origin, point):
    north = (point[0] - origin[0]) * METERS_PER_DEGREE_LAT
    east = (point[1] - origin[1]) * METERS_PER_DEGREE_LAT * math.cos(math.radians(origin[0]))
    return east, north


def _segment_lengths(polyline):
    origin = polyline[0]
    segments = []
    for start, end in zip(polyline, polyline[1:]):
        ax, ay = _xy(origin, start)
        bx, by = _xy(origin, end)
        segments.append((start, end, ax, ay, bx - ax, by - ay, math.hypot(bx - ax, by - ay)))
    return segments


def project_onto(point, polyline):
    origin = polyline[0]
    px, py = _xy(origin, point)
    best_cross = None
    best_along = 0.0
    best_snap = polyline[0]
    traveled = 0.0
    total = 0.0
    for start, end, ax, ay, dx, dy, length in _segment_lengths(polyline):
        if length == 0:
            t = 0.0
            cross = math.hypot(px - ax, py - ay)
        else:
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (length * length)))
            cross = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        along = traveled + t * length
        snap = (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)
        if best_cross is None or cross < best_cross:
            best_cross = cross
            best_along = along
            best_snap = snap
        traveled += length
        total += length
    return Projection(best_along, total - best_along, best_cross or 0.0, best_snap)


def point_along(polyline, distance):
    if distance <= 0:
        return polyline[0]
    for start, end, _ax, _ay, _dx, _dy, length in _segment_lengths(polyline):
        if length == 0:
            continue
        if distance <= length:
            t = distance / length
            return (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)
        distance -= length
    return polyline[-1]
