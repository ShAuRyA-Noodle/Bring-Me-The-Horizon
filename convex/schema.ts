// App schema: auth tables + skills + explanations + thread ownership.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  skills: defineTable({
    name: v.string(),
    description: v.string(),
    domains: v.array(v.string()),
    parentSkillName: v.optional(v.string()),
    depth: v.number(),
    hasChildren: v.boolean(),
    filePath: v.string(),
    contentHash: v.string(),
    syncedAt: v.optional(v.number()),
  })
    .index("by_name", ["name"])
    .index("by_depth", ["depth"])
    .index("by_parent", ["parentSkillName"]),

  skill_files: defineTable({
    skillName: v.string(),
    path: v.string(),
    content: v.string(),
    contentHash: v.string(),
    syncedAt: v.optional(v.number()),
  })
    .index("by_skill_path", ["skillName", "path"])
    .index("by_skill", ["skillName"]),

  threads: defineTable({
    agentThreadId: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_agent_thread", ["agentThreadId"])
    .index("by_user", ["userId"]),

  explanations: defineTable({
    threadId: v.string(),
    userId: v.id("users"),
    messageId: v.optional(v.string()),
    skill: v.string(),
    config: v.string(),
    narration: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    audioStorageId: v.optional(v.id("_storage")),
    audioTimings: v.optional(v.string()),
    step: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_message", ["messageId"])
    .index("by_user_thread", ["userId", "threadId"]),
});
