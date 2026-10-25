import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { headingSource, rideEventKind, rideKind, vehicle } from "./schema";

export const start = mutation({
  args: {
    rideKey: v.string(),
    session: v.string(),
    kind: rideKind,
    provider: v.string(),
    vehicle,
    routeM: v.number(),
    steps: v.number(),
    helmetConnected: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rides")
      .withIndex("by_rideKey", (q) => q.eq("rideKey", args.rideKey))
      .unique();
    if (existing) return null;
    await ctx.db.insert("rides", {
      ...args,
      provider: args.provider.slice(0, 40),
      startedAt: Date.now(),
      arrived: false,
      riddenM: 0,
      cues: 0,
      reroutes: 0,
    });
    return null;
  },
});

export const event = mutation({
  args: {
    rideKey: v.string(),
    kind: rideEventKind,
    atMs: v.number(),
    direction: v.number(),
    distanceToManeuverM: v.number(),
    speedMps: v.number(),
    crossTrackM: v.number(),
    headingSource,
    helmetConnected: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("rideEvents", args);
    return null;
  },
});

export const finish = mutation({
  args: {
    rideKey: v.string(),
    reason: v.union(v.literal("ended"), v.literal("replaced")),
    arrived: v.boolean(),
    riddenM: v.number(),
    cues: v.number(),
    reroutes: v.number(),
  },
  handler: async (ctx, { rideKey, reason, ...totals }) => {
    const ride = await ctx.db
      .query("rides")
      .withIndex("by_rideKey", (q) => q.eq("rideKey", rideKey))
      .unique();
    if (!ride || ride.endedAt !== undefined) return null;
    await ctx.db.patch(ride._id, { ...totals, endReason: reason, endedAt: Date.now() });
    return null;
  },
});
