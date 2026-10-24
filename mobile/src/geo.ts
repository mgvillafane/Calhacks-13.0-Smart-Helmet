export const EARTH_RADIUS_M = 6371000;
export const METERS_PER_DEGREE_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

export type LatLng = readonly [number, number];

export type Projection = {
  alongM: number;
  remainingM: number;
  crossTrackM: number;
  snap: LatLng;
};

export function distanceM(origin: LatLng, destination: LatLng): number {
  const lat1 = (origin[0] * Math.PI) / 180;
  const lng1 = (origin[1] * Math.PI) / 180;
  const lat2 = (destination[0] * Math.PI) / 180;
  const lng2 = (destination[1] * Math.PI) / 180;
  const dlat = lat2 - lat1;
  const dlng = lng2 - lng1;
  const chord = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(chord)));
}

export function bearingDeg(origin: LatLng, destination: LatLng): number {
  const lat1 = (origin[0] * Math.PI) / 180;
  const lng1 = (origin[1] * Math.PI) / 180;
  const lat2 = (destination[0] * Math.PI) / 180;
  const lng2 = (destination[1] * Math.PI) / 180;
  const dlng = lng2 - lng1;
  const east = Math.sin(dlng) * Math.cos(lat2);
  const north = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlng);
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

export function wrapSignedDeg(angleDeg: number): number {
  const wrapped = ((angleDeg + 180) % 360) - 180;
  if (wrapped === -180 && angleDeg > 0) return 180;
  return wrapped;
}

export function move(lat: number, lng: number, northM: number, eastM: number): LatLng {
  const latPerM = 1 / METERS_PER_DEGREE_LAT;
  const lngPerM = 1 / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return [lat + northM * latPerM, lng + eastM * lngPerM];
}

function xy(origin: LatLng, point: LatLng): [number, number] {
  const north = (point[0] - origin[0]) * METERS_PER_DEGREE_LAT;
  const east = (point[1] - origin[1]) * METERS_PER_DEGREE_LAT * Math.cos((origin[0] * Math.PI) / 180);
  return [east, north];
}

function segmentLengths(polyline: readonly LatLng[]) {
  const origin = polyline[0];
  const segments = [];
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const [ax, ay] = xy(origin, start);
    const [bx, by] = xy(origin, end);
    segments.push({ start, end, ax, ay, dx: bx - ax, dy: by - ay, length: Math.hypot(bx - ax, by - ay) });
  }
  return segments;
}

export function projectOnto(point: LatLng, polyline: readonly LatLng[]): Projection {
  const origin = polyline[0];
  const [px, py] = xy(origin, point);
  let bestCross: number | null = null;
  let bestAlong = 0;
  let bestSnap = polyline[0];
  let traveled = 0;
  let total = 0;
  for (const segment of segmentLengths(polyline)) {
    let t = 0;
    let cross = 0;
    if (segment.length === 0) {
      cross = Math.hypot(px - segment.ax, py - segment.ay);
    } else {
      t = Math.max(0, Math.min(1, ((px - segment.ax) * segment.dx + (py - segment.ay) * segment.dy) / (segment.length * segment.length)));
      cross = Math.hypot(px - (segment.ax + t * segment.dx), py - (segment.ay + t * segment.dy));
    }
    const along = traveled + t * segment.length;
    const snap: LatLng = [
      segment.start[0] + (segment.end[0] - segment.start[0]) * t,
      segment.start[1] + (segment.end[1] - segment.start[1]) * t,
    ];
    if (bestCross === null || cross < bestCross) {
      bestCross = cross;
      bestAlong = along;
      bestSnap = snap;
    }
    traveled += segment.length;
    total += segment.length;
  }
  return { alongM: bestAlong, remainingM: total - bestAlong, crossTrackM: bestCross ?? 0, snap: bestSnap };
}

export function pointAlong(polyline: readonly LatLng[], distance: number): LatLng {
  if (distance <= 0) return polyline[0];
  let remaining = distance;
  for (const segment of segmentLengths(polyline)) {
    if (segment.length === 0) continue;
    if (remaining <= segment.length) {
      const t = remaining / segment.length;
      return [
        segment.start[0] + (segment.end[0] - segment.start[0]) * t,
        segment.start[1] + (segment.end[1] - segment.start[1]) * t,
      ];
    }
    remaining -= segment.length;
  }
  return polyline[polyline.length - 1];
}
