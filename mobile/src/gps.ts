import { GPS_COURSE_MIN_SPEED_M_S } from "./engine";
import { move } from "./geo";

export const GPS_INTERVAL_MS = 1000;
// Caps the lead so a phone clock that disagrees with GPS time cannot fling the rider down the road.
export const GPS_LEAD_MAX_S = 1.5;

export type GpsReading = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedMps: number;
  courseDeg: number | null;
  atMs: number | null;
};

export type GpsPermission = "unknown" | "granted" | "denied" | "off";

export function readingFromCoords(
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
  },
  atMs: number | null = null,
): GpsReading {
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracyM: coords.accuracy == null || coords.accuracy < 0 ? null : coords.accuracy,
    speedMps: coords.speed == null || coords.speed < 0 ? 0 : coords.speed,
    courseDeg: coords.heading == null || coords.heading < 0 ? null : coords.heading,
    atMs,
  };
}

// A fix is already old when it arrives and stands in until the next one, so the
// rider is ahead of it by its age plus about half the fix interval.
export function leadSeconds(atMs: number | null, nowMs: number): number {
  const ageS = atMs == null ? 0 : Math.max(0, (nowMs - atMs) / 1000);
  return Math.min(GPS_LEAD_MAX_S, ageS + GPS_INTERVAL_MS / 2000);
}

export function predictReading(reading: GpsReading, leadS: number): GpsReading {
  if (reading.courseDeg == null || reading.speedMps < GPS_COURSE_MIN_SPEED_M_S || leadS <= 0) return reading;
  const aheadM = reading.speedMps * leadS;
  const course = (reading.courseDeg * Math.PI) / 180;
  const [lat, lng] = move(reading.lat, reading.lng, Math.cos(course) * aheadM, Math.sin(course) * aheadM);
  return { ...reading, lat, lng };
}

export function gpsStatus(reading: GpsReading | null, permission: GpsPermission): string {
  if (permission === "off") return "Phone location is off. Turn on Location in Android settings.";
  if (permission === "denied") return "Location permission was denied. Allow location for Smart Helmet.";
  if (!reading) return "Waiting for a GPS fix…";
  const accuracy = reading.accuracyM == null ? "unknown accuracy" : `${Math.round(reading.accuracyM)} m accuracy`;
  const course = reading.courseDeg == null ? "no course" : `${Math.round(reading.courseDeg)}°`;
  return `GPS ${reading.lat.toFixed(5)}, ${reading.lng.toFixed(5)} · ${accuracy} · ${reading.speedMps.toFixed(1)} m/s · ${course}`;
}
