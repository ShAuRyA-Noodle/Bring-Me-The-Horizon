// Explanation records with per-user ownership scoping.
import { query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const create = internalMutation({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
    messageId: v.optional(v.string()),
    skill: v.string(),
    config: v.string(),
    narration: v.optional(v.string()),
    step: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("explanations", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const patchAudio = internalMutation({
  args: {
    explanationId: v.id("explanations"),
    audioStorageId: v.id("_storage"),
    audioTimings: v.string(),
  },
  handler: async (ctx, { explanationId, audioStorageId, audioTimings }) => {
    await ctx.db.patch(explanationId, { audioStorageId, audioTimings });
  },
});

export const markDone = internalMutation({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
    totalFrames: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("explanations", {
      threadId: args.threadId,
      userId: args.userId,
      skill: "_done",
      config: JSON.stringify({ totalFrames: args.totalFrames }),
      createdAt: Date.now(),
    });
  },
});

export const getByThread = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const explanations = await ctx.db
      .query("explanations")
      .withIndex("by_user_thread", (q) =>
        q.eq("userId", userId).eq("threadId", args.threadId)
      )
      .collect();

    return Promise.all(
      explanations.map(async (exp) => {
        if (exp.audioStorageId) {
          const audioUrl = await ctx.storage.getUrl(exp.audioStorageId);
          return { ...exp, audioUrl: audioUrl ?? exp.audioUrl };
        }
        return exp;
      })
    );
  },
});

// Internal counter used by the director agent's hard frame cap.
export const countNonDoneForThread = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const rows = await ctx.db
      .query("explanations")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect();
    return rows.filter((r) => r.skill !== "_done" && r.skill !== "intro").length;
  },
});

export const getByMessage = query({
  args: { messageId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const rows = await ctx.db
      .query("explanations")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();

    for (const r of rows) {
      if (r.userId !== userId) throw new Error("Forbidden");
    }

    return Promise.all(
      rows.map(async (exp) => {
        if (exp.audioStorageId) {
          const audioUrl = await ctx.storage.getUrl(exp.audioStorageId);
          return { ...exp, audioUrl: audioUrl ?? exp.audioUrl };
        }
        return exp;
      })
    );
  },
});
