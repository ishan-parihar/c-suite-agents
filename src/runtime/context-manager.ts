// Context Manager — Conversation history, context window management, message trimming, compaction
// Manages the LLM conversation history for each agent session
//
// Improvements over v1:
// - Token estimation with 1.2x safety margin (OpenClaw pattern)
// - Real conversation detection (skip compacting heartbeat-only sessions)
// - Tool result pruning with protection window (OpenCode pattern)
// - LLM-based staged summarization via callback
// - Model-aware context windows
// - LRU eviction for old sessions
// - Identifier preservation in summaries

import { logger } from "../logger.js";
import type { ContextWindowInfo } from "./context-window.js";
import { isRealConversation } from "./utils.js";
import { AsyncMutex } from "./async-mutex.js";

// ── Token Estimation ──────────────────────────────────────────────
// OpenClaw: CHARS_PER_TOKEN = 4 with SAFETY_MARGIN = 1.2 (20% buffer)
const CHARS_PER_TOKEN = 4;
const SAFETY_MARGIN = 1.2;
const IDENTIFIER_PRESERVATION = "Preserve all opaque identifiers exactly as written (UUIDs, hashes, IDs, hostnames, IPs, ports, URLs, file names).";

// ── Compaction Constants ──────────────────────────────────────────
// OpenCode: PRUNE_PROTECT = 40_000, PRUNE_MINIMUM = 20_000
const DEFAULT_PROTECTION_WINDOW_TOKENS = 40_000; // tokens to keep recent
const DEFAULT_MIN_FREE_TOKENS = 20_000; // min tokens freed to trigger prune
const TOOL_RESULT_PRUNE_PROTECT = 40_000; // tokens to keep recent
const TOOL_RESULT_PRUNE_MINIMUM = 20_000; // min tokens freed to trigger prune
const TOOL_RESULT_PRUNE_LOOKBACK = 2; // user turns to protect
const PRUNE_PROTECTED_TOOLS = ["memory.consolidate"]; // tools whose results we never prune

// Conversation share budget (history shouldn't exceed 50% of context)
const MAX_HISTORY_SHARE = 0.5;

// Chunk ratios for staged summarization (OpenClaw)
const BASE_CHUNK_RATIO = 0.4;
const MIN_CHUNK_RATIO = 0.15;

// Default context window fallback (conservative for 8B models)
const DEFAULT_CONTEXT_TOKENS = 32_000;

// LRU eviction: max sessions before cleanup
const MAX_SESSIONS_LRU = 100;

// ── Staged Summarization Constants ────────────────────────────────
const SUMMARIZATION_OVERHEAD_TOKENS = 4096; // Reserve for summary prompt/template overhead
const MAX_SUMMARY_CHUNK_TOKENS = 16000; // Max tokens per chunk to stay safe

// ── Types ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  timestamp: number;
  tokenEstimate?: number;
  isSummary?: boolean;
  compacted?: boolean;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  timestamp: number;
  tokenEstimate?: number;
  compacted?: boolean;
}

export interface ForkInfo {
  parentSessionId: string;
  branchName?: string;
  forkedAt: number;
}

export interface AgentSession {
  agentId: string;
  sessionId: string;
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  systemPrompt: string;
  systemPromptTokens: number;
  totalTokens: number;
  createdAt: number;
  lastUsed: number;
  compactionCount: number;
  previousSummary?: string;
  hasRealConversation: boolean;
  fork?: ForkInfo;
}

export interface ContextManagerConfig {
  maxMessages: number;
  maxContextTokens: number;
  systemPromptTokens: number;
  modelContextTokens?: number; // model-specific context (overrides maxContextTokens)
  trimStrategy: "oldest_first" | "compress_middle";
  maxSessions?: number; // LRU limit
  contextWindowInfo?: ContextWindowInfo; // resolved model-aware context info
}

export interface CompactionConfig {
  /** Max tokens for the conversation history portion (excludes system prompt) */
  maxHistoryTokens: number;
  /** Number of recent messages to keep un-summarized */
  keepRecent: number;
  /** Whether to use LLM-based summarization (requires summarizeFn) */
  useLlmSummary: boolean;
  /** Custom instructions for summarization (appended to standard template) */
  customInstructions?: string;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  maxMessages: 50,
  maxContextTokens: DEFAULT_CONTEXT_TOKENS,
  systemPromptTokens: 3000,
  trimStrategy: "oldest_first",
  maxSessions: MAX_SESSIONS_LRU,
};

// ── Summarization Callback ────────────────────────────────────────
// NativeAgentRuntime provides this for LLM-based compaction
export type SummarizeFn = (
  messages: ChatMessage[],
  previousSummary?: string,
  customInstructions?: string,
) => Promise<string>;

// ── Context Manager ───────────────────────────────────────────────

export type PersistCallbacks = {
  onSave: (sessionId: string, messages: ChatMessage[], toolCalls: ToolCall[], metadata: { compactionCount: number; previousSummary?: string; hasRealConversation: boolean }) => void;
  onLoad: (sessionId: string) => { messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string | null; tokenEstimate: number; isSummary: boolean; compacted: boolean; timestamp: number; tool_call_id?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }>; toolCalls: Array<{ id: string; name: string; arguments: string; result?: string; tokenEstimate: number; compacted: boolean; timestamp: number }>; metadata: { compactionCount: number; previousSummary?: string; hasRealConversation: boolean } } | null;
};

export class ContextManager {
  private sessions: Map<string, AgentSession> = new Map();
  private sessionAccessOrder: string[] = [];
  private config: ContextManagerConfig;
  private summarizeFn: SummarizeFn | null = null;
  private persist: PersistCallbacks | null = null;
  private contextWindowInfo: ContextWindowInfo | null = null;
  private sessionMutex = new AsyncMutex();

  constructor(config?: Partial<ContextManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.contextWindowInfo = config?.contextWindowInfo ?? null;
  }

  setSummarizeFn(fn: SummarizeFn): void {
    this.summarizeFn = fn;
  }

  wirePersistence(callbacks: PersistCallbacks): void {
    this.persist = callbacks;
  }

  private triggerSave(sessionId: string): void {
    if (!this.persist) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.persist.onSave(sessionId, session.messages, session.toolCalls, {
      compactionCount: session.compactionCount,
      previousSummary: session.previousSummary,
      hasRealConversation: session.hasRealConversation,
    });
  }

  // ── Session Lifecycle ────────────────────────────────────────────

  createSession(agentId: string, sessionId: string, systemPrompt: string, options?: {
    modelContextTokens?: number;
  }): AgentSession {
    if (this.persist) {
      const loaded = this.persist.onLoad(sessionId);
      if (loaded && loaded.messages.length > 0) {
        const msgs: ChatMessage[] = loaded.messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          tokenEstimate: m.tokenEstimate,
          isSummary: m.isSummary,
          compacted: m.compacted,
          tool_call_id: m.tool_call_id,
          tool_calls: m.tool_calls,
        }));
        const tcs: ToolCall[] = loaded.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          result: tc.result,
          timestamp: tc.timestamp,
          tokenEstimate: tc.tokenEstimate,
          compacted: tc.compacted,
        }));
        const systemMsg = msgs[0];
        const totalTokens = msgs.reduce((sum, m) => sum + (m.tokenEstimate || 0), 0);
        const session: AgentSession = {
          agentId,
          sessionId,
          messages: msgs,
          toolCalls: tcs,
          systemPrompt: systemMsg.content,
          systemPromptTokens: systemMsg.tokenEstimate || 0,
          totalTokens,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          compactionCount: loaded.metadata?.compactionCount ?? 0,
          previousSummary: loaded.metadata?.previousSummary,
          hasRealConversation: loaded.metadata?.hasRealConversation ?? false,
        };
        this.sessions.set(sessionId, session);
        logger.info({ sessionId, agentId, messages: msgs.length, tokens: totalTokens }, "Session restored from persistence");
        this.touchSession(sessionId);
        return session;
      }
    }

    const estimatedTokens = estimateTokens(systemPrompt);
    const session: AgentSession = {
      agentId,
      sessionId,
      messages: [
        {
          role: "system",
          content: systemPrompt,
          timestamp: Date.now(),
          tokenEstimate: estimatedTokens,
        },
      ],
      toolCalls: [],
      systemPrompt,
      systemPromptTokens: estimatedTokens,
      totalTokens: estimatedTokens,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      compactionCount: 0,
      hasRealConversation: false,
    };
    this.sessions.set(sessionId, session);
    logger.info({ sessionId, agentId, tokens: estimatedTokens }, "Session created");
    this.touchSession(sessionId);
    return session;
  }

  getSession(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.touchSession(sessionId);
    }
    return session;
  }

  // ── Message Management ───────────────────────────────────────────

  async addUserMessage(sessionId: string, content: string): Promise<void> {
    const release = await this.sessionMutex.acquire("session");
    try {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);

      const tokens = estimateTokens(content);
      const msg: ChatMessage = {
        role: "user",
        content,
        timestamp: Date.now(),
        tokenEstimate: tokens,
      };

      session.messages.push(msg);
      session.totalTokens += tokens;
      session.lastUsed = Date.now();

      if (!session.hasRealConversation && hasMeaningfulText(content)) {
        session.hasRealConversation = true;
      }

      this._trimIfNeededInternal(session);
      this.triggerSave(sessionId);
    } finally {
      release();
    }
  }

  async addAssistantMessage(sessionId: string, content: string): Promise<void> {
    const release = await this.sessionMutex.acquire("session");
    try {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);

      const tokens = estimateTokens(content);
      const msg: ChatMessage = {
        role: "assistant",
        content,
        timestamp: Date.now(),
        tokenEstimate: tokens,
      };

      session.messages.push(msg);
      session.totalTokens += tokens;
      session.lastUsed = Date.now();

      this._trimIfNeededInternal(session);
    } finally {
      release();
    }
  }

  /**
   * Record an assistant message that contains tool_calls.
   * If textContent is empty/null, content is stored as null (required by OpenAI-compatible backends).
   */
  async recordAssistantToolCalls(sessionId: string, textContent: string | null | undefined, toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }>): Promise<void> {
    const release = await this.sessionMutex.acquire("session");
    try {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);

      const content = (textContent && textContent.trim().length > 0) ? textContent : null;
      const tokens = content ? estimateTokens(content) : 0;

      const msg: ChatMessage = {
        role: "assistant",
        content,
        timestamp: Date.now(),
        tokenEstimate: tokens,
        tool_calls: toolCalls,
      };

      session.messages.push(msg);
      session.totalTokens += tokens;
      session.lastUsed = Date.now();

      this._trimIfNeededInternal(session);
      this.triggerSave(sessionId);
    } finally {
      release();
    }
  }

  async recordToolCall(sessionId: string, toolCall: ToolCall): Promise<void> {
    const release = await this.sessionMutex.acquire("session");
    try {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);

      const resultTokens = toolCall.result ? estimateTokens(toolCall.result) : 0;
      toolCall.tokenEstimate = resultTokens;

      session.toolCalls.push(toolCall);

      if (toolCall.result) {
        const resultMsg: ChatMessage = {
          role: "tool",
          content: toolCall.result,
          tool_call_id: toolCall.id,
          timestamp: Date.now(),
          tokenEstimate: resultTokens,
        };
        session.messages.push(resultMsg);
        session.totalTokens += resultTokens;
      }

      session.lastUsed = Date.now();

      this.pruneToolResults(session);
      this._trimIfNeededInternal(session);
    } finally {
      release();
    }
  }

  getMessagesForLLM(sessionId: string): ChatMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.touchSession(sessionId);
    return [...session.messages];
  }

  // ── Context Usage ────────────────────────────────────────────────

  getContextUsage(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;
    return (session.totalTokens / this.effectiveMaxTokens()) * 100;
  }

  isContextCrowded(sessionId: string): boolean {
    return this.getContextUsage(sessionId) > 75;
  }

  /** Returns the effective context window for the current model */
  effectiveMaxTokens(): number {
    return this.config.modelContextTokens ?? this.config.maxContextTokens;
  }

  // ── Compaction ───────────────────────────────────────────────────

  async compact(sessionId: string, keepRecent: number = 10): Promise<void> {
    const release = await this.sessionMutex.acquire("session");
    try {
      await this._compactInternal(sessionId, keepRecent);
    } finally {
      release();
    }
  }

  // Internal version (no mutex — called from within already-wrapped methods)
  private async _compactInternal(sessionId: string, keepRecent: number = 10): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Skip compaction for heartbeat-only sessions
    if (!session.hasRealConversation && session.messages.length <= 5) {
      logger.debug({ sessionId, messages: session.messages.length }, "Skipping compaction — heartbeat-only session");
      return;
    }

    // Scan all messages for substantive content before compaction
    if (!isRealConversation(session.messages)) {
      logger.debug({ sessionId }, "Skipping compaction — heartbeat-only session");
      return;
    }

    // Prune old tool results before compaction
    this.pruneToolResults(session);

    const systemMsg = session.messages[0];
    const recentMessages = session.messages.slice(-keepRecent);
    let oldMessages = session.messages.slice(1, -keepRecent);

    if (oldMessages.length === 0) return;

    // Overflow detection: if context is already near capacity, force more aggressive compaction
    const usableTokens = this.effectiveMaxTokens() - SUMMARIZATION_OVERHEAD_TOKENS;
    if (session.totalTokens >= usableTokens) {
      const aggressiveKeep = Math.max(2, Math.floor(keepRecent / 2));
      oldMessages = session.messages.slice(1, -aggressiveKeep);
      if (oldMessages.length === 0) return;
      logger.warn(
        { sessionId, totalTokens: session.totalTokens, usableTokens, oldCount: oldMessages.length },
        "Context near overflow — aggressive compaction",
      );
    }

    // Attempt LLM-based summarization if available
    if (this.summarizeFn && oldMessages.length >= 2) {
      await this.compactWithLlm(session, systemMsg, oldMessages, session.messages.slice(-keepRecent));
    } else {
      // Fallback: improved local summary
      this.compactLocal(session, systemMsg, oldMessages, session.messages.slice(-keepRecent));
    }
  }

  /**
   * LLM-based progressive compaction (OpenClaw pattern).
   * Splits old messages by token share, summarizes chunks, merges.
   */
  private async compactWithLlm(
    session: AgentSession,
    systemMsg: ChatMessage,
    oldMessages: ChatMessage[],
    recentMessages: ChatMessage[],
  ): Promise<void> {
    if (!this.summarizeFn) return;

    try {
      const oldTokens = oldMessages.reduce((sum, m) => sum + (m.tokenEstimate || 0), 0);
      const summary = await this.stageSummarize(oldMessages, oldTokens, session);

      const summaryTokens = estimateTokens(summary);
      const summaryMsg: ChatMessage = {
        role: "system",
        content: `[Session Summary — ${oldMessages.length} messages compacted at ${new Date().toISOString()}]\n${summary}`,
        timestamp: Date.now(),
        tokenEstimate: summaryTokens,
        isSummary: true,
      };

      const recentTokenSum = recentMessages.reduce((sum, m) => sum + (m.tokenEstimate || 0), 0);
      session.messages = [systemMsg, summaryMsg, ...recentMessages];
      session.totalTokens = (systemMsg.tokenEstimate || 0) + summaryTokens + recentTokenSum;
      session.compactionCount++;
      session.previousSummary = summary;

      logger.info(
        { sessionId: session.sessionId, summarized: oldMessages.length, kept: recentMessages.length, summaryTokens },
        "Session compacted (LLM-based)",
      );
    } catch (err: any) {
      logger.warn({ err: err.message }, "LLM compaction failed, falling back to local summary");
      this.compactLocal(session, systemMsg, oldMessages, recentMessages);
    }
  }

  /**
   * Stage-summarize messages: if they fit in one call, summarize directly.
   * Otherwise split into chunks, summarize each, then merge.
   */
  private async stageSummarize(
    messages: ChatMessage[],
    totalTokens: number,
    session: AgentSession,
  ): Promise<string> {
    if (totalTokens <= MAX_SUMMARY_CHUNK_TOKENS) {
      return this.summarizeFn!(
        messages,
        session.previousSummary,
        `Current agent: ${session.agentId}. ${IDENTIFIER_PRESERVATION}`,
      );
    }

    // Separate oversized messages (need individual handling)
    const oversized: ChatMessage[] = [];
    const normal: ChatMessage[] = [];
    for (const msg of messages) {
      if (isOversizedForSummary(msg, MAX_SUMMARY_CHUNK_TOKENS)) {
        oversized.push(msg);
        logger.warn(
          { sessionId: session.sessionId, tokens: msg.tokenEstimate, threshold: Math.round(MAX_SUMMARY_CHUNK_TOKENS * 0.6) },
          "Oversized message detected during staged summarization — handling separately",
        );
      } else {
        normal.push(msg);
      }
    }

    // Summarize oversized messages individually
    const oversizedSummaries: string[] = [];
    for (const msg of oversized) {
      const s = await this.summarizeFn!(
        [msg],
        undefined,
        `Current agent: ${session.agentId}. ${IDENTIFIER_PRESERVATION}`,
      );
      oversizedSummaries.push(s);
    }

    // Split normal messages into chunks
    const numChunks = Math.ceil(totalTokens / MAX_SUMMARY_CHUNK_TOKENS);
    const chunks = splitMessagesByTokenShare(normal, numChunks);

    // Summarize each chunk
    const chunkSummaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkSummary = await this.summarizeFn!(
        chunks[i],
        undefined,
        `Current agent: ${session.agentId}. ${IDENTIFIER_PRESERVATION} (chunk ${i + 1}/${chunks.length})`,
      );
      chunkSummaries.push(chunkSummary);
    }

    // Merge all partial summaries
    const allParts = [...oversizedSummaries, ...chunkSummaries];
    if (allParts.length === 1) return allParts[0];

    const mergeInput = allParts
      .map((s, i) => `--- Part ${i + 1} ---\n${s}`)
      .join("\n\n");

    return this.summarizeFn!(
      [{ role: "user" as const, content: mergeInput, timestamp: Date.now() }],
      session.previousSummary,
      `Current agent: ${session.agentId}. Merge these partial summaries into one coherent summary. ${IDENTIFIER_PRESERVATION}`,
    );
  }

  /**
   * Improved local summary fallback (non-LLM).
   * Extracts structured metadata: tool calls, key topics, conversation flow.
   */
  private compactLocal(
    session: AgentSession,
    systemMsg: ChatMessage,
    oldMessages: ChatMessage[],
    recentMessages: ChatMessage[],
  ): void {
    const lines: string[] = [];
    const turns = oldMessages.filter(m => m.role !== "system");

    if (turns.length === 0) {
      lines.push("No prior conversation history.");
    } else {
      // Extract tool usage from old messages
      const toolCallsInOld = session.toolCalls.filter(tc =>
        tc.timestamp >= (oldMessages[0]?.timestamp ?? 0) &&
        tc.timestamp <= (oldMessages[oldMessages.length - 1]?.timestamp ?? Infinity) &&
        !tc.compacted
      );

      lines.push(`[Compacted: ${turns.length} messages, ${toolCallsInOld.length} tool calls]`);
      lines.push("");

      // Tool usage summary
      if (toolCallsInOld.length > 0) {
        const toolCounts = new Map<string, number>();
        for (const tc of toolCallsInOld) {
          toolCounts.set(tc.name, (toolCounts.get(tc.name) || 0) + 1);
          tc.compacted = true;
        }
        lines.push("Tools used:");
        for (const [name, count] of toolCounts) {
          lines.push(`  - ${name}: ${count}x`);
        }
        lines.push("");
      }

      // Topic extraction (first meaningful text from each turn, truncated)
      const topics = turns
        .filter(m => m.role === "user" && hasMeaningfulText(m.content))
        .slice(0, 3)
        .map(m => m.content.slice(0, 120).replace(/\n/g, " "));

      if (topics.length > 0) {
        lines.push(`Key topics: ${topics.join(" → ")}`);
      }

      // Final state before compaction
      const lastAssistant = [...turns].reverse().find(m => m.role === "assistant");
      if (lastAssistant) {
        lines.push(`Last state: ${lastAssistant.content.slice(0, 150).replace(/\n/g, " ")}`);
      }
    }

    const summary = lines.join("\n");
    const summaryTokens = estimateTokens(summary);
    const summaryMsg: ChatMessage = {
      role: "system",
      content: summary,
      timestamp: Date.now(),
      tokenEstimate: summaryTokens,
      isSummary: true,
    };

    const recentTokenSum = recentMessages.reduce((sum, m) => sum + (m.tokenEstimate || 0), 0);
    session.messages = [systemMsg, summaryMsg, ...recentMessages];
    session.totalTokens = (systemMsg.tokenEstimate || 0) + summaryTokens + recentTokenSum;
    session.compactionCount++;

    logger.info(
      { sessionId: session.sessionId, summarized: oldMessages.length, kept: recentMessages.length, summaryTokens },
      "Session compacted (local fallback)",
    );
  }

  // ── Tool Result Pruning (OpenCode Pattern) ──────────────────────

  /**
   * Prunes old tool results to reclaim context space.
   * Walks backwards through messages, protecting the most recent
   * protectionWindowTokens. Beyond that window, tool results are
   * replaced with a placeholder. Only prunes if minFreeTokens or
   * more would be freed.
   *
   * @returns Number of tokens freed (0 if no pruning performed)
   */
  pruneToolResults(
    session: AgentSession,
    protectionWindowTokens: number = DEFAULT_PROTECTION_WINDOW_TOKENS,
    minFreeTokens: number = DEFAULT_MIN_FREE_TOKENS,
  ): number {
    let cumulativeTokens = 0;
    let inPruneZone = false;
    const toPrune: { index: number; toolName: string; originalLength: number; tokens: number }[] = [];

    // Walk backwards from most recent message
    for (let i = session.messages.length - 1; i >= 1; i--) {
      const msg = session.messages[i];
      const msgTokens = msg.tokenEstimate || 0;
      cumulativeTokens += msgTokens;

      if (!inPruneZone) {
        // Still within the protection window
        if (cumulativeTokens >= protectionWindowTokens) {
          inPruneZone = true;
        }
        continue;
      }

      // Beyond protection window — identify prunable tool results
      if (msg.role === "tool") {
        // Extract tool name from the toolCalls array using tool_call_id
        const toolName = msg.tool_call_id
          ? session.toolCalls.find(tc => tc.id === msg.tool_call_id)?.name ?? "unknown"
          : "unknown";

        // Never prune protected tool types
        if (PRUNE_PROTECTED_TOOLS.includes(toolName)) continue;
        // Skip already-compacted messages
        if (msg.compacted) continue;

        toPrune.push({ index: i, toolName, originalLength: msg.content?.length ?? 0, tokens: msgTokens });
      }
    }

    // Calculate total potential savings
    const potentialFreed = toPrune.reduce((sum, item) => sum + item.tokens, 0);

    // Only prune if we free enough tokens
    if (potentialFreed < minFreeTokens || toPrune.length === 0) return 0;

    // Perform pruning — replace content with placeholder
    let actualFreed = 0;
    for (const item of toPrune) {
      const msg = session.messages[item.index];
      if (!msg) continue;

      const oldTokens = msg.tokenEstimate || 0;
      const originalLength = item.originalLength;
      const placeholder = `[Tool output pruned to save context — ${item.toolName} returned ${originalLength} chars]`;

      msg.content = placeholder;
      msg.tokenEstimate = estimateTokens(placeholder);
      actualFreed += (oldTokens - msg.tokenEstimate);
    }

    session.totalTokens -= actualFreed;

    if (actualFreed > 0) {
      logger.info(
        { sessionId: session.sessionId, pruned: toPrune.length, freedTokens: actualFreed, potentialTokens: potentialFreed },
        "Tool results pruned",
      );
    }

    return actualFreed;
  }

  // ── Trimming ─────────────────────────────────────────────────────

  // Internal version (no mutex — called from within already-wrapped methods)
  private async _trimIfNeededInternal(session: AgentSession): Promise<void> {
    const maxTokens = this.effectiveMaxTokens();

    // Check message count limit
    if (session.messages.length > this.config.maxMessages) {
      const excess = session.messages.length - this.config.maxMessages;
      const toRemove = session.messages.slice(1, 1 + excess);
      const removedTokens = toRemove.reduce((sum, m) => sum + (m.tokenEstimate || 0), 0);
      session.messages = [session.messages[0], ...session.messages.slice(1 + excess)];
      session.totalTokens -= removedTokens;
      logger.debug({ sessionId: session.sessionId, removed: excess, freedTokens: removedTokens }, "Trimmed old messages");
    }

    // Pre-emptive compaction at 75% — adaptive keepRecent based on remaining headroom
    const usagePct = session.totalTokens / maxTokens;
    if (usagePct > 0.75) {
      const headroom = maxTokens - session.totalTokens;
      const avgMsgTokens = session.messages.length > 1
        ? session.messages.slice(1).reduce((s, m) => s + (m.tokenEstimate || 0), 0) / (session.messages.length - 1)
        : 200;
      const keepRecent = Math.max(4, Math.min(16, Math.floor(headroom / avgMsgTokens)));
      await this._compactInternal(session.sessionId, keepRecent);
      return;
    }

    // Emergency compaction at 90% — minimal keepRecent
    if (usagePct > 0.9) {
      logger.warn({ sessionId: session.sessionId, usagePct }, "Context near overflow — emergency compaction");
      await this._compactInternal(session.sessionId, 4);
    }
  }

  // ── Session Management ───────────────────────────────────────────

  clearHistory(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const systemMsg = session.messages[0];
    session.messages = [systemMsg];
    session.totalTokens = systemMsg.tokenEstimate || 0;
    session.toolCalls = [];
    session.previousSummary = undefined;
    session.compactionCount = 0;
    session.hasRealConversation = false;
    session.lastUsed = Date.now();

    logger.info({ sessionId }, "Session history cleared");
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    const idx = this.sessionAccessOrder.indexOf(sessionId);
    if (idx !== -1) {
      this.sessionAccessOrder.splice(idx, 1);
    }
    logger.info({ sessionId }, "Session deleted");
  }

  forkSession(sessionId: string, branchName?: string): string {
    const parent = this.sessions.get(sessionId);
    if (!parent) throw new Error(`Session not found: ${sessionId}`);

    const newSessionId = crypto.randomUUID();
    const forkedAt = Date.now();

    const forkedMessages: ChatMessage[] = parent.messages.map((m) => ({ ...m }));
    const forkedToolCalls: ToolCall[] = parent.toolCalls.map((tc) => ({ ...tc }));

    const session: AgentSession = {
      agentId: parent.agentId,
      sessionId: newSessionId,
      messages: forkedMessages,
      toolCalls: forkedToolCalls,
      systemPrompt: parent.systemPrompt,
      systemPromptTokens: parent.systemPromptTokens,
      totalTokens: parent.totalTokens,
      createdAt: forkedAt,
      lastUsed: forkedAt,
      compactionCount: parent.compactionCount,
      previousSummary: parent.previousSummary,
      hasRealConversation: parent.hasRealConversation,
      fork: {
        parentSessionId: sessionId,
        branchName,
        forkedAt,
      },
    };

    this.sessions.set(newSessionId, session);
    logger.info(
      { newSessionId, parentSessionId: sessionId, branchName, messages: forkedMessages.length },
      "Session forked",
    );
    this.touchSession(newSessionId);
    return newSessionId;
  }

  getSessionFork(sessionId: string): ForkInfo | undefined {
    const session = this.sessions.get(sessionId);
    return session?.fork;
  }

  // ── LRU Eviction ─────────────────────────────────────────────────

  private touchSession(sessionId: string): void {
    const existingIdx = this.sessionAccessOrder.indexOf(sessionId);
    if (existingIdx !== -1) {
      this.sessionAccessOrder.splice(existingIdx, 1);
    }
    this.sessionAccessOrder.push(sessionId);

    const maxSessions = this.config.maxSessions ?? MAX_SESSIONS_LRU;
    if (this.sessions.size > maxSessions) {
      this.evictOldest();
    }
  }

  private evictOldest(): void {
    const oldestId = this.sessionAccessOrder.shift();
    if (!oldestId) return;

    const evicted = this.sessions.delete(oldestId);
    if (evicted) {
      logger.debug({ sessionId: oldestId }, "Evicting LRU session");
    }
  }

  // ── Stats ────────────────────────────────────────────────────────

  getStats(sessionId: string): { messages: number; tokens: number; usagePercent: number; age: number; compactions: number } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      messages: session.messages.length,
      tokens: session.totalTokens,
      usagePercent: this.getContextUsage(sessionId),
      age: Date.now() - session.createdAt,
      compactions: session.compactionCount,
    };
  }

  listSessions(): { sessionId: string; agentId: string; messages: number; tokens: number; lastUsed: number }[] {
    const result: { sessionId: string; agentId: string; messages: number; tokens: number; lastUsed: number }[] = [];
    for (const [id, session] of this.sessions) {
      result.push({
        sessionId: id,
        agentId: session.agentId,
        messages: session.messages.length,
        tokens: session.totalTokens,
        lastUsed: session.lastUsed,
      });
    }
    return result.sort((a, b) => b.lastUsed - a.lastUsed);
  }
}

// ── Utility Functions ──────────────────────────────────────────────

/**
 * Check if a single message is too large to include in a summarization chunk.
 * Returns true if the message's tokenEstimate exceeds 60% of maxTokens.
 * Such messages need separate handling (e.g., summarised individually).
 */
export function isOversizedForSummary(msg: ChatMessage, maxTokens: number): boolean {
  const threshold = maxTokens * 0.6;
  const tokens = msg.tokenEstimate ?? estimateTokens(msg.content);
  return tokens > threshold;
}

/**
 * Estimate tokens from text with 20% safety margin (OpenClaw pattern).
 * Uses chars/4 heuristic multiplied by 1.2 to compensate for:
 * - Multi-byte characters
 * - Special tokens
 * - Code/tokenization edge cases
 */
export function estimateTokens(text: string): number {
  const raw = Math.ceil(text.length / CHARS_PER_TOKEN);
  return Math.ceil(raw * SAFETY_MARGIN);
}

/**
 * Check if text has meaningful conversational content.
 * Filters out heartbeat acks, silent replies, and empty messages.
 * (OpenClaw: hasMeaningfulText pattern)
 */
export function hasMeaningfulText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();

  // Silent/heartbeat responses
  if (lower === "heartbeat_ok" || lower === "heartbeat ok" || lower === "heartbeatok") return false;
  if (lower.includes("heartbeat_ok") && trimmed.length < 50) return false;
  if (/^all\s*clear[\s.!]*$/i.test(lower)) return false;
  if (/^nothing\s+(new|to\s+report|here|changed)/i.test(lower)) return false;
  if (/^same\s+(picture|pattern|as\s*before)/i.test(lower)) return false;

  return trimmed.length > 10;
}

/**
 * Check if a session has real conversation content (not just heartbeats).
 * Scans messages for substantive exchanges.
 */
export function hasRealConversation(messages: ChatMessage[]): boolean {
  // Look for the last N non-system messages
  const recent = messages.filter(m => m.role !== "system").slice(-20);

  for (const msg of recent) {
    if (hasMeaningfulText(msg.content)) return true;
  }

  return false;
}

/**
 * Compute adaptive chunk ratio for staged summarization.
 * When average message size is large, use smaller chunks.
 * (OpenClaw: computeAdaptiveChunkRatio pattern)
 */
export function computeAdaptiveChunkRatio(messages: ChatMessage[], contextWindow: number): number {
  if (messages.length === 0) return BASE_CHUNK_RATIO;

  const totalTokens = messages.reduce((sum, m) => sum + (m.tokenEstimate || 0), 0);
  const avgTokens = totalTokens / messages.length;
  const safeAvg = avgTokens * SAFETY_MARGIN;
  const avgRatio = safeAvg / contextWindow;

  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}

/**
 * Split messages into chunks for staged summarization.
 * (OpenClaw: splitMessagesByTokenShare pattern)
 */
export function splitMessagesByTokenShare(messages: ChatMessage[], parts: number = 2): ChatMessage[][] {
  if (messages.length === 0) return [];

  const normalizedParts = Math.min(Math.max(1, Math.floor(parts)), messages.length);
  if (normalizedParts <= 1) return [messages];

  const totalTokens = messages.reduce((sum, m) => sum + (m.tokenEstimate || 0), 0);
  const targetTokens = totalTokens / normalizedParts;

  const chunks: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const msgTokens = msg.tokenEstimate || 0;
    if (
      chunks.length < normalizedParts - 1 &&
      current.length > 0 &&
      currentTokens + msgTokens > targetTokens
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(msg);
    currentTokens += msgTokens;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
