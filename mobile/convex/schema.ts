import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// No coordinates or place names are stored. Rides are keyed by a per-launch
// session so there is no account or install id.

export const rideKind = v.union(v.literal("route"), v.literal("demo"), v.literal("here"));
export const vehicle = v.union(v.literal("bicycle"), v.literal("scooter"));
export const rideEventKind = v.union(v.literal("cue"), v.literal("reroute"), v.literal("arrived"));
export const headingSource = v.union(v.literal("gps"), v.literal("helmet"), v.literal("none"));
export const linkEventKind = v.union(v.literal("connected"), v.literal("not_found"), v.literal("failed"));
export const helmetEventKind = v.union(v.literal("boot"), v.literal("health"), v.literal("brake"));

export default defineSchema({
  rides: defineTable({
    rideKey: v.string(),
    session: v.string(),
    kind: rideKind,
    provider: v.string(),
    vehicle,
    routeM: v.number(),
    steps: v.number(),
    helmetConnected: v.boolean(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    endReason: v.optional(v.union(v.literal("ended"), v.literal("replaced"))),
    arrived: v.boolean(),
    riddenM: v.number(),
    cues: v.number(),
    reroutes: v.number(),
  })
    .index("by_rideKey", ["rideKey"])
    .index("by_session", ["session"]),

  // One row per engine decision change: a new cue direction, a reroute, or arrival.
  rideEvents: defineTable({
    rideKey: v.string(),
    kind: rideEventKind,
    atMs: v.number(),
    direction: v.number(),
    distanceToManeuverM: v.number(),
    speedMps: v.number(),
    crossTrackM: v.number(),
    headingSource,
    helmetConnected: v.boolean(),
  }).index("by_rideKey", ["rideKey"]),

  linkEvents: defineTable({
    session: v.string(),
    kind: linkEventKind,
    scanMs: v.number(),
    message: v.optional(v.string()),
  }).index("by_session", ["session"]),

  // Sent by the ESP32 over Wi-Fi when firmware/include/secrets.h is present.
  helmetEvents: defineTable({
    device: v.string(),
    kind: helmetEventKind,
    fw: v.string(),
    uptimeS: v.number(),
    resetReason: v.optional(v.string()),
    freeHeap: v.optional(v.number()),
    minFreeHeap: v.optional(v.number()),
    rssi: v.optional(v.number()),
    bleConnected: v.optional(v.boolean()),
    imuOk: v.optional(v.boolean()),
    micOk: v.optional(v.boolean()),
    cues: v.optional(v.number()),
    staleStops: v.optional(v.number()),
    brakes: v.optional(v.number()),
    brakeMs: v.optional(v.number()),
    peakG: v.optional(v.number()),
  })
    .index("by_device", ["device"])
    .index("by_kind", ["kind"]),
});
