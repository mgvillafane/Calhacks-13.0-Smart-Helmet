import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { helmetEventKind } from "./schema";

export const report = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("helmetEvents", {
      ...args,
      device: args.device.slice(0, 32),
      fw: args.fw.slice(0, 40),
      resetReason: args.resetReason?.slice(0, 20),
    });
    return null;
  },
});
