// AutoStore & AutoRecall — Automatic memory lifecycle for every agent turn
//
// autoStore: After EVERY agent response (user message, heartbeat, inter-agent),
// the conversation is automatically stored in MemoryFacade with appropriate
// scope, kind, and tags. No LLM effort required.
//
// autoRecall: Before EVERY agent turn, relevant memories are fetched and
// injected into the prompt. Uses the MemoryInjector pipeline.
//
// This ensures memory is always fresh and always available — agents don't
// need to "remember to remember."

import { logger } from "../logger";
import { getMemoryFacade, type MemoryFacade } from "../memory/index";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// AutoStore
// ---------------------------------------------------------------------------

export interface AutoStoreParams {
  agentId: string;
  /** The user/agent message that triggered this turn */
  inputText: string;
  /** The agent's response text */
  outputText: string;
  /** What triggered this turn */
  trigger: "user_message" | "heartbeat" | "inter_agent_message" | "scheduled_task" | "proactive_work";
  /** Additional context about who/what this involves */
  context?: {
    from?: string;
    to?: string;
    threadId?: string;
    taskId?: string;
    domain?: string;
  };
}

/**
 * Automatically store a conversation turn in memory.
 * Stores both the input (as episodic observation) and output (as episodic log).
 * Deduplication is handled by MemoryFacade.
 */
export async function autoStore(params: AutoStoreParams): Promise<{ inputId: string | null; outputId: string | null }> {
  let mf: MemoryFacade;
  try {
    mf = await getMemoryFacade();
  } catch (err: any) {
    logger.warn({ err: err.message, agentId: params.agentId }, "autoStore: MemoryFacade unavailable, skipping");
    return { inputId: null, outputId: null };
  }

  const result = { inputId: null as string | null, outputId: null as string | null };

  // Store the input as an episodic observation
  if (params.inputText && params.inputText.trim().length > 5) {
    const tags = ["conversation", params.trigger];
    if (params.context?.from) tags.push(`from:${params.context.from}`);
    if (params.context?.domain) tags.push(`domain:${params.context.domain}`);

    result.inputId = await mf.upsert({
      agent_id: params.agentId,
      scope: "personal",
      kind: "episodic",
      type: "obs",
      content: `[${params.trigger}] Received: ${params.inputText.slice(0, 500)}`,
      importance: 0.4,
      tags,
      thread_id: params.context?.threadId,
      task_id: params.context?.taskId,
      source: "conversation",
    }).catch((err: any) => {
      logger.debug({ err: err.message }, "autoStore: input dedup or error");
      return null;
    });
  }

  // Store the output as an episodic log (the agent's actual work/thought)
  if (params.outputText && params.outputText.trim().length > 10) {
    const tags = ["conversation", params.trigger, "agent-output"];
    if (params.context?.to) tags.push(`to:${params.context.to}`);
    if (params.context?.domain) tags.push(`domain:${params.context.domain}`);

    result.outputId = await mf.upsert({
      agent_id: params.agentId,
      scope: "personal",
      kind: "episodic",
      type: "log",
      content: `[${params.trigger}] Responded: ${params.outputText.slice(0, 500)}`,
      importance: triggerImportance(params.trigger),
      tags,
      thread_id: params.context?.threadId,
      task_id: params.context?.taskId,
      source: "conversation",
    }).catch((err: any) => {
      logger.debug({ err: err.message }, "autoStore: output dedup or error");
      return null;
    });
  }

  if (result.inputId || result.outputId) {
    logger.debug({ agentId: params.agentId, trigger: params.trigger, inputId: result.inputId, outputId: result.outputId }, "autoStore: conversation turn saved");
  }

  return result;
}

function triggerImportance(trigger: AutoStoreParams["trigger"]): number {
  switch (trigger) {
    case "user_message": return 0.7;    // User interactions are important
    case "inter_agent_message": return 0.5;
    case "scheduled_task": return 0.5;
    case "proactive_work": return 0.6;
    case "heartbeat": return 0.3;        // Heartbeats are routine
    default: return 0.4;
  }
}

// ---------------------------------------------------------------------------
// AutoRecall
// ---------------------------------------------------------------------------

export interface AutoRecallParams {
  agentId: string;
  /** The incoming message or task description to search for relevant memories */
  queryText: string;
  /** Optional domain context (e.g., "finance", "content", "relationships") */
  domain?: string;
  /** What triggered this turn */
  trigger: "user_message" | "heartbeat" | "inter_agent_message" | "scheduled_task" | "proactive_work";
}

/**
 * Automatically recall relevant memories and format them for prompt injection.
 * Returns a formatted string ready to prepend to the agent's prompt delta.
 */
export async function autoRecall(params: AutoRecallParams): Promise<string> {
  let mf: MemoryFacade;
  try {
    mf = await getMemoryFacade();
  } catch (err: any) {
    logger.warn({ err: err.message, agentId: params.agentId }, "autoRecall: MemoryFacade unavailable, skipping");
    return "";
  }

  if (!params.queryText || params.queryText.trim().length < 3) {
    return "";
  }

  try {
    // Use the injector's task injection — it already handles vector search + formatting
    const injected = await mf.injectForTask(params.agentId, params.queryText);
    if (injected) {
      logger.debug({ agentId: params.agentId, trigger: params.trigger }, "autoRecall: memories injected");
    }
    return injected;
  } catch (err: any) {
    logger.warn({ err: err.message, agentId: params.agentId }, "autoRecall: injection failed");
    return "";
  }
}

/**
 * Recall memories specifically for proactive domain work.
 * Uses a longer lookback window (7 days) to find patterns and trends.
 *
 * FILTERING: Excludes passive heartbeat memories ("nothing changed", "same pattern")
 * to prevent the feedback loop where agents read their own passivity and reinforce it.
 */
export async function autoRecallProactive(agentId: string, domainContext: string): Promise<string> {
  let mf: MemoryFacade;
  try {
    mf = await getMemoryFacade();
  } catch (err: any) {
    logger.warn({ err: err.message, agentId }, "autoRecallProactive: MemoryFacade unavailable");
    return "";
  }

  try {
    const result = await mf.injectForProactiveWork(agentId, domainContext);

    // Filter out passive heartbeat memories that reinforce "nothing to do" behavior
    return filterPassiveMemories(result);
  } catch (err: any) {
    logger.warn({ err: err.message, agentId }, "autoRecallProactive: injection failed");
    return "";
  }
}

/**
 * Filter out passive heartbeat memories that reinforce agent passivity.
 * These are memories from heartbeat cycles where the agent reported "nothing changed."
 * If the agent sees these, it concludes "this is a cycle of doing nothing" and gives up.
 */
function filterPassiveMemories(text: string): string {
  if (!text || text.trim().length === 0) return "";

  const passivePatterns = [
    /same\s+(picture|pattern|as\s*before)/i,
    /nothing\s+(new|changed|to\s*flag|to\s*report)/i,
    /just\s+(monitoring|checking)/i,
    /no\s+escalation\s*needed/i,
    /repetitive/i,
    /all\s+clear.*monitoring/i,
    /nothing\s+urgent/i,
  ];

  const lines = text.split("\n");
  const filtered = lines.filter(line => {
    // Check if this line (or the next few lines) contain passive language
    return !passivePatterns.some(p => p.test(line));
  });

  // If filtering removed most content, return empty (better than injecting passivity)
  if (filtered.length < lines.length * 0.3) {
    logger.debug({ before: lines.length, after: filtered.length }, "autoRecallProactive: filtered out mostly passive memories");
    return "";
  }

  return filtered.join("\n");
}
