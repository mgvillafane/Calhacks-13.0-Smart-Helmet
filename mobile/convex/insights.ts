import { v } from "convex/values";
import { query } from "./_generated/server";

const RECENT = 200;

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100) / 100;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function lowest(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

function tally(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

// Product health over the most recent rides, connects, and helmet reports.
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const rides = await ctx.db.query("rides").order("desc").take(RECENT);
    const finished = rides.filter((ride) => ride.endedAt !== undefined);
    const links = await ctx.db.query("linkEvents").order("desc").take(RECENT);
    const connected = links.filter((link) => link.kind === "connected");
    const boots = await ctx.db
      .query("helmetEvents")
      .withIndex("by_kind", (q) => q.eq("kind", "boot"))
      .order("desc")
      .take(RECENT);
    const health = await ctx.db
      .query("helmetEvents")
      .withIndex("by_kind", (q) => q.eq("kind", "health"))
      .order("desc")
      .take(RECENT);
    const brakes = await ctx.db
      .query("helmetEvents")
      .withIndex("by_kind", (q) => q.eq("kind", "brake"))
      .order("desc")
      .take(RECENT);

    return {
      rides: {
        count: rides.length,
        finished: finished.length,
        arrivalRate: rate(finished.filter((ride) => ride.arrived).length, finished.length),
        withHelmetRate: rate(rides.filter((ride) => ride.helmetConnected).length, rides.length),
        averageRiddenM: average(finished.map((ride) => ride.riddenM)),
        averageCues: average(finished.map((ride) => ride.cues)),
        rerouteRate: rate(finished.filter((ride) => ride.reroutes > 0).length, finished.length),
        byKind: tally(rides.map((ride) => ride.kind)),
        byProvider: tally(rides.map((ride) => ride.provider)),
      },
      link: {
        attempts: links.length,
        successRate: rate(connected.length, links.length),
        medianConnectMs: median(connected.map((link) => link.scanMs)),
        failures: tally(links.filter((link) => link.kind !== "connected").map((link) => link.message ?? link.kind)),
      },
      helmet: {
        boots: boots.length,
        resetReasons: tally(boots.map((boot) => boot.resetReason ?? "unknown")),
        staleStops: health.reduce((sum, report) => sum + (report.staleStops ?? 0), 0),
        lowestFreeHeap: lowest(health.flatMap((report) => (report.minFreeHeap === undefined ? [] : [report.minFreeHeap]))),
        brakeCount: brakes.length,
        medianBrakeMs: median(brakes.map((brake) => brake.brakeMs ?? 0)),
        medianBrakePeakG: median(brakes.map((brake) => brake.peakG ?? 0)),
      },
    };
  },
});

export const rideTimeline = query({
  args: { rideKey: v.string() },
  handler: async (ctx, { rideKey }) => {
    const ride = await ctx.db
      .query("rides")
      .withIndex("by_rideKey", (q) => q.eq("rideKey", rideKey))
      .unique();
    const events = await ctx.db
      .query("rideEvents")
      .withIndex("by_rideKey", (q) => q.eq("rideKey", rideKey))
      .take(500);
    return { ride, events };
  },
});
