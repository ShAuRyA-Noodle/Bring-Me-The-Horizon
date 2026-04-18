// Threads ownership table: maps agent thread IDs to owning users.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const createThreadRecord = internalMutation({
  args: {
    agentThreadId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, { agentThreadId, userId }) => {
    return await ctx.db.insert("threads", {
      agentThreadId,
      userId,
      createdAt: Date.now(),
    });
  },
});

export const getOwnerByAgentThread = internalQuery({
  args: { agentThreadId: v.string() },
  handler: async (ctx, { agentThreadId }) => {
    const row = await ctx.db
      .query("threads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", agentThreadId))
      .unique();
    return row ? row.userId : null;
  },
});
