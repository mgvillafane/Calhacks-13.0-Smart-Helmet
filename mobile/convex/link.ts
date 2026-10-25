import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { linkEventKind } from "./schema";

export const record = mutation({
  args: {
    session: v.string(),
    kind: linkEventKind,
    scanMs: v.number(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("linkEvents", { ...args, message: args.message?.slice(0, 200) });
    return null;
  },
});
