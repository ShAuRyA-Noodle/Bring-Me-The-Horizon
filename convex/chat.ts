// Chat actions: auth-gated, per-user rate limited, ownership-checked.
import { v } from "convex/values";
import { action, query, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { createThread, listUIMessages, syncStreams } from "@convex-dev/agent";
import { vStreamArgs } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { components, internal } from "./_generated/api";
import { directorAgent } from "./agent";
import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { getAuthUserId } from "@convex-dev/auth/server";
import { rateLimiter } from "./rateLimiter";
import type { Id } from "./_generated/dataModel";

export const createNewThread = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const threadId = await createThread(ctx, components.agent, {
      userId: userId.toString(),
    });

    await ctx.runMutation(internal.threads.createThreadRecord, {
      agentThreadId: threadId,
      userId,
    });

    return threadId;
  },
});

async function assertThreadOwner(
  ctx: ActionCtx,
  threadId: string,
  userId: Id<"users">
) {
  const owner: Id<"users"> | null = await ctx.runQuery(
    internal.threads.getOwnerByAgentThread,
    { agentThreadId: threadId }
  );
  if (!owner) throw new Error("Forbidden");
  if (owner !== userId) throw new Error("Forbidden");
}

export const sendMessage = action({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, { threadId, prompt }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    await rateLimiter.limit(ctx, "sendQuestion", { key: userId, throws: true });
    await assertThreadOwner(ctx, threadId, userId);

    const result = await directorAgent.generateText(
      ctx,
      { threadId },
      { prompt }
    );
    return result.text;
  },
});

export const generateIntro = internalAction({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
    prompt: v.string(),
  },
  handler: async (ctx, { threadId, userId, prompt }) => {
    const { text } = await generateText({
      model: groq("llama-3.3-70b-versatile"),
      system:
        "You are a friendly learning assistant. Given the user's question, generate a warm 2-4 sentence introduction that acknowledges their question and gives a simple, accessible overview of the topic. Keep it under 60 words. Do not use markdown.",
      prompt,
    });

    const explanationId = await ctx.runMutation(internal.explanations.create, {
      threadId,
      userId,
      skill: "intro",
      step: 0,
      config: "{}",
      narration: text,
    });

    await ctx.scheduler.runAfter(0, internal.tts.generateAudio, {
      narration: text,
      explanationId,
    });
  },
});

export const sendMessageStreaming = action({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, { threadId, prompt }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    await rateLimiter.limit(ctx, "sendQuestion", { key: userId, throws: true });
    await assertThreadOwner(ctx, threadId, userId);

    await ctx.scheduler.runAfter(0, internal.chat.generateIntro, {
      threadId,
      userId,
      prompt,
    });

    await directorAgent.streamText(
      ctx,
      { threadId },
      { prompt },
      { saveStreamDeltas: true }
    );
  },
});

export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const owner = await ctx.db
      .query("threads")
      .withIndex("by_agent_thread", (q) =>
        q.eq("agentThreadId", args.threadId)
      )
      .unique();
    if (!owner) throw new Error("Forbidden");
    if (owner.userId !== userId) throw new Error("Forbidden");

    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});
