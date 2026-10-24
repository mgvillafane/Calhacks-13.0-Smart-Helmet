import { Maneuver, Route, Step } from "./engine";
import { bearingDeg, distanceM, LatLng } from "./geo";

export const MAPBOX_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/cycling/";
export const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/cycling-regular/geojson";
export const OSM_BIKE_URL = "https://routing.openstreetmap.de/routed-bike/route/v1/bike/";
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const ROUTING_USER_AGENT = "SmartHelmet/1.0 (Cal Hacks 13.0 cycling navigator)";
const SHORT_ARRIVE_M = 5;

const ORS_MANEUVERS: Record<number, [string, string]> = {
  0: ["turn", "left"],
  1: ["turn", "right"],
  2: ["turn", "left"],
  3: ["turn", "right"],
  4: ["turn", "left"],
  5: ["turn", "right"],
  6: ["continue", "straight"],
  7: ["continue", "straight"],
  8: ["continue", "straight"],
  9: ["turn", "uturn"],
  10: ["arrive", "straight"],
  11: ["depart", "straight"],
  12: ["turn", "left"],
  13: ["turn", "right"],
};

export type HttpRequest = {
  method: string;
  url: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

type RawStep = { geometry: LatLng[]; kind: string; modifier: string; bearingBefore: number | null };
type Payload = { code?: string; message?: string; routes?: { legs?: { steps?: MapboxStep[] }[] }[]; features?: OrsFeature[] };
type MapboxStep = { maneuver?: { type?: string; modifier?: string; bearing_before?: number }; geometry?: { coordinates?: number[][] } };
type OrsFeature = { geometry?: { coordinates?: number[][] }; properties?: { segments?: { steps?: { type?: number; way_points: number[] }[] }[] } };

export function mapboxRouteRequest(origin: LatLng, destination: LatLng, token: string): HttpRequest {
  return {
    method: "GET",
    url: MAPBOX_DIRECTIONS_URL + `${lngLat(origin)};${lngLat(destination)}`,
    query: { geometries: "geojson", overview: "full", steps: "true", access_token: token },
    body: {},
    headers: {},
  };
}

export function osmBikeRouteRequest(origin: LatLng, destination: LatLng): HttpRequest {
  return {
    method: "GET",
    url: OSM_BIKE_URL + `${lngLat(origin)};${lngLat(destination)}`,
    query: { geometries: "geojson", overview: "full", steps: "true", generate_hints: "false" },
    body: {},
    headers: { "User-Agent": ROUTING_USER_AGENT },
  };
}

export function destinationPoint(text: string): LatLng | null {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

export async function geocodePlace(query: string): Promise<{ point: LatLng; name: string }> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Enter a place or latitude, longitude.");
  const direct = destinationPoint(trimmed);
  if (direct) return { point: direct, name: trimmed };
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const response = await fetch(url.toString(), { headers: { Accept: "application/json", "User-Agent": ROUTING_USER_AGENT } });
  if (!response.ok) throw new Error(`place search failed (${response.status})`);
  const places = (await response.json()) as { lat?: string; lon?: string; display_name?: string }[];
  const place = places[0];
  const lat = Number(place?.lat);
  const lng = Number(place?.lon);
  if (!place || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`No place found for ${trimmed}.`);
  return { point: [lat, lng], name: place.display_name || trimmed };
}

export function orsRouteRequest(origin: LatLng, destination: LatLng, apiKey: string): HttpRequest {
  return {
    method: "POST",
    url: ORS_DIRECTIONS_URL,
    query: {},
    body: { coordinates: [[origin[1], origin[0]], [destination[1], destination[0]]] },
    headers: { Authorization: apiKey },
  };
}

export async function fetchHttp(request: HttpRequest): Promise<Payload> {
  const url = new URL(request.url);
  for (const [key, value] of Object.entries(request.query)) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), {
    method: request.method,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...request.headers },
    body: request.method === "POST" ? JSON.stringify(request.body) : undefined,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string };
      detail = body.message ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `routing request failed (${response.status})`);
  }
  return response.json() as Promise<Payload>;
}

export async function routeBetween(origin: LatLng, destination: LatLng, mapboxToken = ""): Promise<{ route: Route; provider: string }> {
  if (mapboxToken) {
    try {
      return { route: routeFromMapbox(await fetchHttp(mapboxRouteRequest(origin, destination, mapboxToken))), provider: "mapbox" };
    } catch {
      // A Mapbox token is optional. The OpenStreetMap bike route still works.
    }
  }
  return { route: routeFromOsrm(await fetchHttp(osmBikeRouteRequest(origin, destination))), provider: "openstreetmap" };
}

export function routeFromOsrm(payload: Payload): Route {
  if (payload.code && payload.code !== "Ok") throw new Error(payload.message || "No bike route");
  return routeFromMapbox(payload);
}

export function routeFromMapbox(payload: Payload): Route {
  const routes = payload.routes ?? [];
  if (routes.length === 0) throw new Error("Mapbox response has no routes");
  const steps = routes[0].legs?.[0]?.steps;
  if (!steps?.length) throw new Error("Mapbox route has no steps");
  return assemble(steps.map((step) => {
    const maneuver = step.maneuver ?? {};
    const coordinates = step.geometry?.coordinates;
    if (!coordinates?.length) throw new Error("Mapbox step has no geometry");
    return {
      geometry: latLngPoints(coordinates),
      kind: mapboxKind(maneuver.type ?? "", maneuver.modifier),
      modifier: normalizeModifier(maneuver.modifier),
      bearingBefore: maneuver.bearing_before ?? null,
    };
  }));
}

export function routeFromOpenRouteService(payload: Payload): Route {
  const feature = payload.features?.[0];
  if (!feature) throw new Error("OpenRouteService response has no features");
  const coordinates = feature.geometry?.coordinates ?? [];
  const steps = feature.properties?.segments?.[0]?.steps;
  if (!steps?.length) throw new Error("OpenRouteService route has no steps");
  return assemble(steps.map((step) => {
    const [start, end] = step.way_points;
    const points = latLngPoints(coordinates.slice(start, end + 1));
    if (points.length === 0) throw new Error("OpenRouteService step has no geometry");
    const [kind, modifier] = orsManeuver(step.type);
    return { geometry: points, kind, modifier, bearingBefore: null };
  }));
}

function assemble(rawSteps: RawStep[]): Route {
  const built: Step[] = rawSteps.map((current, index) => {
    const following = rawSteps[index + 1];
    const source = following ?? current;
    const maneuver: Maneuver = { kind: source.kind, modifier: source.modifier };
    const inbound = source.bearingBefore ?? approachBearing(current.geometry);
    return { geometry: current.geometry, endManeuver: maneuver, inboundBearingDeg: inbound };
  });
  if (built.length >= 2 && built[built.length - 1].endManeuver.kind === "arrive" && pathLength(built[built.length - 1].geometry) < SHORT_ARRIVE_M) {
    built.pop();
  }
  if (built.length === 0) throw new Error("route has no usable steps");
  return { steps: built };
}

function mapboxKind(maneuverType: string, modifier?: string): string {
  if (maneuverType === "depart" || maneuverType === "arrive") return maneuverType;
  if (["turn", "end of road", "fork", "roundabout", "rotary", "roundabout turn"].includes(maneuverType)) return "turn";
  if (["left", "right", "uturn"].includes(normalizeModifier(modifier))) return "turn";
  return "continue";
}

function normalizeModifier(modifier?: string): string {
  const text = (modifier ?? "").toLowerCase().replace(/_/g, " ");
  if (text.includes("uturn") || text.includes("u-turn")) return "uturn";
  if (text.includes("left")) return "left";
  if (text.includes("right")) return "right";
  return "straight";
}

function orsManeuver(stepType: number | undefined): [string, string] {
  if (stepType === undefined || !(stepType in ORS_MANEUVERS)) throw new Error("unknown OpenRouteService step type");
  return ORS_MANEUVERS[stepType];
}

function latLngPoints(coordinates: number[][]): LatLng[] {
  return coordinates.map((pair) => [pair[1], pair[0]] as LatLng);
}

function approachBearing(points: LatLng[]): number {
  if (points.length < 2 || (points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1])) return 0;
  return bearingDeg(points[0], points[points.length - 1]);
}

function pathLength(points: LatLng[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) total += distanceM(points[index], points[index + 1]);
  return total;
}

function lngLat(point: LatLng): string {
  return `${point[1]},${point[0]}`;
}
