/**
 * Director + Visual Sub-Agent architecture.
 *
 * - Primary LLM: Groq Llama 3.3 70B (fast tool-use, structured output).
 * - Fallback: Groq gpt-oss-120b (reruns if the primary emits malformed tool calls).
 * - Ownership: every explanation is stamped with the thread owner's userId, looked
 *   up via the `threads` table by the Convex Agent thread id.
 */

import { Agent, createTool } from "@convex-dev/agent";
import { groq } from "@ai-sdk/groq";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { z } from "zod";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const PRIMARY_MODEL = process.env.GROQ_MODEL_PRIMARY ?? "llama-3.3-70b-versatile";
const FALLBACK_MODEL = process.env.GROQ_MODEL_FALLBACK ?? "openai/gpt-oss-120b";

const DIRECTOR_INSTRUCTIONS = `You are a narrative director for visual learning. You plan how to explain concepts visually, then dispatch specialized sub-agents to render each frame.

RULES:
1. NEVER generate visual configs yourself. ALWAYS delegate to launchVisualAgent.
2. Plan a narrative arc of 2-5 segments. Think: intro → build-up → key insight → summary → next actions.
3. For each segment, call launchVisualAgent with a focused prompt explaining what that frame should show.
4. ALWAYS end with a final launchVisualAgent call using skill "ui" that generates ActionCards for next steps.
5. ALWAYS call done() as your very last action.
6. Keep segment prompts concise and specific — the sub-agent handles the details.

AVAILABLE SKILLS:
- manim: Mathematical animations (3Blue1Brown style). Use for equations, graphs, geometry, proofs, step-by-step math.
- diagram: System diagrams (Excalidraw). Use for concept maps, flowcharts, architecture, relationships.
- particles: 3D particle simulations. Use for physics forces, waves, fields, molecular behavior.
- ui: Interactive components. Use for summaries, comparisons, quizzes, AND always for the final "next actions" frame with ActionCards.

EXAMPLE NARRATIVE for "explain derivatives":
1. launchVisualAgent(skill="manim", step=1, prompt="Show a curve f(x)=x² with a secant line between two points. Animate the second point approaching the first to show the limit concept. Narrate: A derivative measures the instantaneous rate of change.")
2. launchVisualAgent(skill="manim", step=2, prompt="Show the tangent line at x=1 on f(x)=x². Display the formula f'(x)=2x. Narrate: The derivative at any point gives us the slope of the tangent line.")
3. launchVisualAgent(skill="ui", step=3, prompt="Show a summary card with the derivative rules (power rule, chain rule, product rule) and 4 ActionCards: 'Quiz me on derivatives', 'Explain the chain rule in depth', 'Show real-world applications', 'Visualize integration (the reverse)'.")
4. done(totalFrames=3)`;

const launchVisualAgent = createTool({
  description: `Launch a sub-agent to render one visual frame. The sub-agent loads the skill, generates visual config, and saves the frame. Call this for each segment of your narrative.`,
  inputSchema: z.object({
    segmentPrompt: z
      .string()
      .describe(
        "Detailed prompt for this segment — what to explain, what to show, what to narrate"
      ),
    skill: z
      .enum(["manim", "diagram", "ui", "particles"])
      .describe("Which visual skill the sub-agent should use"),
    step: z.number().describe("Step number in the sequence (1-based)"),
    narrationHint: z
      .string()
      .optional()
      .describe("Key narration phrases or tone guidance"),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      await ctx.runAction(internal.agent.runSubAgent, {
        threadId: ctx.threadId!,
        segmentPrompt: args.segmentPrompt,
        skill: args.skill,
        step: args.step,
        narrationHint: args.narrationHint,
      });
      return `Frame ${args.step} (${args.skill}) generated successfully.`;
    } catch (error) {
      return `Frame ${args.step} (${args.skill}) failed: ${error instanceof Error ? error.message : "unknown error"}. Continue with the next segment.`;
    }
  },
});

const done = createTool({
  description: `Signal that all visual frames are generated. ALWAYS call this as your very last action.`,
  inputSchema: z.object({
    totalFrames: z.number().describe("Total number of frames generated"),
  }),
  execute: async (ctx, args): Promise<string> => {
    const userId = await resolveUserIdFromAgentThread(ctx, ctx.threadId!);
    await ctx.runMutation(internal.explanations.markDone, {
      threadId: ctx.threadId!,
      totalFrames: args.totalFrames,
      userId,
    });
    return "Done.";
  },
});

export const directorAgent = new Agent(components.agent, {
  name: "director",
  languageModel: groq(PRIMARY_MODEL),
  instructions: DIRECTOR_INSTRUCTIONS,
  tools: { launchVisualAgent, done },
  maxSteps: 15,
});

export const directorAgentFallback = new Agent(components.agent, {
  name: "director-fallback",
  languageModel: groq(FALLBACK_MODEL),
  instructions: DIRECTOR_INSTRUCTIONS,
  tools: { launchVisualAgent, done },
  maxSteps: 15,
});

const SUB_AGENT_INSTRUCTIONS = `You are a visual rendering sub-agent. You generate exactly ONE visual frame.

WORKFLOW:
1. Invoke the skill specified in your prompt to load output format instructions.
2. Generate the visual config JSON following those instructions exactly.
3. Call renderVisual with the config, narration, and step number.
4. Stop. Do NOT call done — the director handles that.`;

const invokeSkill = createTool({
  description: `Load visual skill instructions. Call this first to learn the output format.`,
  inputSchema: z.object({
    skill_name: z
      .string()
      .describe('Skill to invoke (e.g., "visual/manim", "visual/ui")'),
  }),
  execute: async (ctx, args): Promise<string> => {
    const skill = await ctx.runQuery(internal.skills.get, {
      name: args.skill_name,
    });
    if (!skill) return `Skill '${args.skill_name}' not found.`;

    const content = await ctx.runQuery(internal.skills.getFileInternal, {
      skillName: args.skill_name,
      path: "SKILL.md",
    });
    if (!content) return `Skill "${args.skill_name}" has no content.`;

    if (skill.hasChildren) {
      const children = await ctx.runQuery(
        internal.skills.getChildrenInternal,
        { parentName: args.skill_name }
      );
      const list = children
        .map(
          (c: { name: string; description: string }) =>
            `  - ${c.name}: ${c.description}`
        )
        .join("\n");
      return `<category name="${skill.name}">\n${content}\n\nSub-skills:\n${list}\n</category>`;
    }

    return `<skill name="${skill.name}">\n${content}\n</skill>`;
  },
});

/**
 * Resolve the owning userId by looking up the thread record our app keeps
 * keyed by Convex Agent threadId. Throws on missing record (should never
 * happen if createNewThread ran properly).
 */
async function resolveUserIdFromAgentThread(
  ctx: { runQuery: (q: any, args: any) => Promise<any> },
  agentThreadId: string
): Promise<Id<"users">> {
  const userId: Id<"users"> | null = await ctx.runQuery(
    internal.threads.getOwnerByAgentThread,
    { agentThreadId }
  );
  if (!userId) {
    throw new Error(
      `No owner found for agent thread ${agentThreadId} — was createNewThread called?`
    );
  }
  return userId;
}

export const visualAgent = new Agent(components.agent, {
  name: "visual-sub-agent",
  languageModel: groq(PRIMARY_MODEL),
  instructions: SUB_AGENT_INSTRUCTIONS,
  tools: { invokeSkill },
  maxSteps: 5,
});

export const runSubAgent = internalAction({
  args: {
    threadId: v.string(),
    segmentPrompt: v.string(),
    skill: v.string(),
    step: v.number(),
    narrationHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const prompt = [
      `Generate step ${args.step} using the visual/${args.skill} skill.`,
      `First, invoke skill "visual/${args.skill}" to load the output format.`,
      `Then call renderVisual with step=${args.step}.`,
      `You MUST call renderVisual — do NOT just describe the visual in text.`,
      ``,
      `TASK: ${args.segmentPrompt}`,
      args.narrationHint ? `NARRATION GUIDANCE: ${args.narrationHint}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const parentThreadId = args.threadId;
    const userId = await resolveUserIdFromAgentThread(ctx, parentThreadId);

    const tryWithModel = async (modelName: string) => {
      const agent = subAgentForThread(parentThreadId, args.step, userId, modelName);
      const { threadId: subThreadId } = await agent.createThread(ctx, {});
      await agent.generateText(ctx, { threadId: subThreadId }, { prompt });
    };

    try {
      await tryWithModel(PRIMARY_MODEL);
    } catch (primaryError) {
      console.warn(
        `[agent] primary model ${PRIMARY_MODEL} failed on step ${args.step}, falling back to ${FALLBACK_MODEL}:`,
        primaryError
      );
      await tryWithModel(FALLBACK_MODEL);
    }
  },
});

/**
 * Sub-agent bound to the PARENT thread id + the resolved owner userId so
 * renderVisual writes explanations scoped to the correct user. Writing to a
 * fresh sub-thread for the LLM call avoids context pollution; explanation
 * rows are tagged with the parent thread.
 */
function subAgentForThread(
  parentThreadId: string,
  step: number,
  userId: Id<"users">,
  modelName: string
) {
  const boundRenderVisual = createTool({
    description: `Save a generated visual frame. Call after generating config per skill instructions.`,
    inputSchema: z.object({
      skill: z.enum(["manim", "diagram", "ui", "particles"]),
      config: z.string().describe("JSON config for the renderer"),
      narration: z.string().describe("Voice narration for this frame"),
      step: z.number().optional().describe("Step number"),
    }),
    execute: async (ctx, args): Promise<string> => {
      const explanationId = await ctx.runMutation(internal.explanations.create, {
        threadId: parentThreadId,
        messageId: ctx.messageId,
        skill: args.skill,
        config: args.config,
        narration: args.narration,
        step: args.step ?? step,
        userId,
      });

      if (args.narration) {
        await ctx.scheduler.runAfter(0, internal.tts.generateAudio, {
          narration: args.narration,
          explanationId,
        });
      }

      return `Saved: ${args.skill} step ${args.step ?? step}`;
    },
  });

  return new Agent(components.agent, {
    name: `sub-agent-step-${step}`,
    languageModel: groq(modelName),
    instructions: SUB_AGENT_INSTRUCTIONS,
    tools: { invokeSkill, renderVisual: boundRenderVisual },
    maxSteps: 5,
  });
}
