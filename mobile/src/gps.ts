export type GpsReading = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedMps: number;
  courseDeg: number | null;
};

export type GpsPermission = "unknown" | "granted" | "denied" | "off";

export function readingFromCoords(coords: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
}): GpsReading {
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracyM: coords.accuracy == null || coords.accuracy < 0 ? null : coords.accuracy,
    speedMps: coords.speed == null || coords.speed < 0 ? 0 : coords.speed,
    courseDeg: coords.heading == null || coords.heading < 0 ? null : coords.heading,
  };
}

export function gpsStatus(reading: GpsReading | null, permission: GpsPermission): string {
  if (permission === "off") return "Phone location is off. Turn on Location in Android settings.";
  if (permission === "denied") return "Location permission was denied. Allow location for Smart Helmet.";
  if (!reading) return "Waiting for a GPS fix…";
  const accuracy = reading.accuracyM == null ? "unknown accuracy" : `${Math.round(reading.accuracyM)} m accuracy`;
  const course = reading.courseDeg == null ? "no course" : `${Math.round(reading.courseDeg)}°`;
  return `GPS ${reading.lat.toFixed(5)}, ${reading.lng.toFixed(5)} · ${accuracy} · ${reading.speedMps.toFixed(1)} m/s · ${course}`;
}
