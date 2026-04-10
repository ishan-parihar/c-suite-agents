// Native Agent Runtime — Core LLM execution loop with tool calling
// Replaces OpenCode HTTP client with direct LLM API calls
// Supports OpenAI-compatible APIs with model fallback chains

import OpenAI from "openai";
import { logger } from "../logger.js";
import { buildSystemPrompt } from "./prompt-builder.js";
import { isSilentAck, stripHeartbeatToken, hasSubstantiveFinding, currentTimeLine, LruMap } from "./utils.js";
import { ContextManager, type ChatMessage, type ToolCall, estimateTokens, type SummarizeFn, type PersistCallbacks, splitMessagesByTokenShare } from "./context-manager.js";
import { resolveContextWindowInfo, type ContextWindowInfo } from "./context-window.js";
import { buildToolDefinitions, createToolBridge, type ToolExecutor, type ToolResult, type ToolDefinition } from "./tool-bridge.js";
import { v4 as uuidv4 } from "uuid";
import { retryAsync, isRetryableError, type RetryOptions } from "./retry.js";
import {
  createFailoverChain,
  getCurrentModel,
  shouldFailover,
  shouldFailoverWithAuthAndBilling,
  failoverToNext,
  resetFailover,
  createBillingBackoffRegistry,
  recordBillingError,
  clearBillingBackoff,
  getBillingBackoffRemainingMs,
  type FailoverState,
  type ModelEntry,
  type BillingBackoffRegistry,
} from "./model-fallback.js";
import { loadConfig } from "../config/loader.js";
import { OpenAICompatibleProvider, PromptCacheTracker, createPromptFingerprint, type StreamEvent, MAX_SAFE_TIMEOUT_MS } from "./provider.js";
import { SkillRegistry, type Skill } from "./skill-registry.js";
import { getAgentWorkspace } from "../agents/workspace-manager.js";
import { detectToolCallLoop, recordToolCall, recordToolCallOutcome, DEFAULT_LOOP_DETECTION_CONFIG, type ToolLoopDetectionConfig, type ToolCallRecord } from "./tool-loop-detection.js";
import { truncateToolResult } from "./tool-result-truncation.js";
import { getWsGateway } from "../transport/ws-server.js";

// SessionRegistry-compatible interface for persistence wiring
export interface SessionPersistence {
  saveMessages: (sessionId: string, messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string | null; tokenEstimate: number; isSummary?: boolean; compacted?: boolean; timestamp: number; tool_call_id?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }>) => void;
  saveToolCalls: (sessionId: string, toolCalls: Array<{ id: string; name: string; arguments: string; result?: string; tokenEstimate?: number; compacted?: boolean; timestamp: number }>) => void;
  loadSessionData: (sessionId: string) => { messages: Array<{ role: string; content: string | null; tokenEstimate: number; isSummary: boolean; compacted: boolean; timestamp: number; tool_call_id?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }>; toolCalls: Array<{ id: string; name: string; arguments: string; result?: string; tokenEstimate: number; compacted: boolean; timestamp: number }>; metadata: { compactionCount: number; previousSummary?: string; hasRealConversation: boolean } | null } | null;
  updateSessionMetadata: (sessionId: string, data: { compactionCount?: number; previousSummary?: string; hasRealConversation?: boolean }) => void;
}

export interface LLMConfig {
  provider: "openai" | "ollama" | "anthropic" | "openrouter" | "qwen-proxy" | "qwen-code";
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  maxToolRounds?: number;
  contextTokens?: number;
  timeoutMs?: number;
}

export interface NativeAgentRuntimeConfig {
  llm: LLMConfig;
  maxMessages?: number;
  maxContextTokens?: number;
  persistCallbacks?: PersistCallbacks;
}

const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: "qwen-proxy",
  baseUrl: "http://127.0.0.1:3000/v1",
  model: "coder-model",
  maxTokens: 65536,
  temperature: 0.3,
  maxToolRounds: 10,
  contextTokens: 262144,
};

const DEFAULT_RUNTIME_CONFIG: NativeAgentRuntimeConfig = {
  llm: DEFAULT_LLM_CONFIG,
  maxMessages: 50,
  maxContextTokens: 32000,
};

/**
 * Resolve timeoutMs: 0 = unlimited (MAX_SAFE_TIMEOUT_MS), negative/undefined = 48h default.
 */
function resolveTimeoutMs(raw: number | undefined): number {
  if (raw === undefined || raw < 0) return 48 * 60 * 60 * 1000; // 48h default
  if (raw === 0) return MAX_SAFE_TIMEOUT_MS; // unlimited
  return Math.min(raw, MAX_SAFE_TIMEOUT_MS);
}

export interface AgentExecutionResult {
  sessionId: string;
  text: string;
  tokens?: { total: number; input: number; output: number; reasoning: number };
  isSilentAck: boolean;
  hasSubstantiveFinding: boolean;
  toolCallsExecuted: number;
}

export class NativeAgentRuntime {
  private client!: OpenAI;
  private provider: OpenAICompatibleProvider | null = null;
  private promptCacheTracker: PromptCacheTracker | null = null;
  private contextManager: ContextManager;
  private config: NativeAgentRuntimeConfig;
  private toolExecutor: ToolExecutor | null = null;
  private toolDefinitions: ReturnType<typeof buildToolDefinitions> = [];
  private mcpToolDefinitions: ToolDefinition[] = [];
  private agentToolScope: LruMap<string, string[]> = new LruMap(50);
  private agentSessions = new LruMap<string, string>(50);
  private sessionInitPromises = new LruMap<string, Promise<string>>(50);
  private failoverState: FailoverState | null = null;
  private billingBackoff: BillingBackoffRegistry;
  private contextWindowInfo: ContextWindowInfo;
  private skillRegistries = new Map<string, SkillRegistry>();
  private loopDetectionConfig: ToolLoopDetectionConfig;

  constructor(config?: Partial<NativeAgentRuntimeConfig>) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };
    this.loopDetectionConfig = (this.config.llm as unknown as Record<string, unknown>).loopDetection as ToolLoopDetectionConfig | undefined ?? DEFAULT_LOOP_DETECTION_CONFIG;

    this.contextWindowInfo = resolveContextWindowInfo(
      this.config.llm.model,
      this.config.llm.contextTokens,
    );

    this.contextManager = new ContextManager({
      maxMessages: this.config.maxMessages,
      maxContextTokens: this.config.maxContextTokens,
      modelContextTokens: this.contextWindowInfo.contextTokens,
      contextWindowInfo: this.contextWindowInfo,
    });

    this.failoverState = this.buildFailoverChain();
    this.billingBackoff = createBillingBackoffRegistry();
    this.updateClientForModel();
    this.initProvider();
    this.contextManager.setSummarizeFn(this.compactionSummarizeFn.bind(this));

    if (this.config.persistCallbacks) {
      this.contextManager.wirePersistence(this.config.persistCallbacks);
      logger.info("Session persistence wired");
    }

    const currentModel = this.failoverState ? getCurrentModel(this.failoverState) : null;
    logger.info({
      provider: this.config.llm.provider,
      model: this.config.llm.model,
      baseUrl: currentModel?.baseUrl ?? this.config.llm.baseUrl,
      contextTokens: this.contextWindowInfo.contextTokens,
      failoverModels: this.failoverState?.chain.length ?? 1,
    }, "Native agent runtime initialized");
  }

  /**
   * Build a failover chain from config.
   * Primary model first, then any configured fallbacks.
   */
  private buildFailoverChain(): FailoverState | null {
    const primary: ModelEntry = {
      provider: this.config.llm.provider,
      baseUrl: this.config.llm.baseUrl,
      apiKey: this.config.llm.apiKey,
      model: this.config.llm.model,
      contextTokens: this.config.llm.contextTokens,
      maxTokens: this.config.llm.maxTokens,
    };

    try {
      const fullConfig = loadConfig();
      if (fullConfig.models?.fallbacks?.length) {
        const fallbackModels: ModelEntry[] = fullConfig.models.fallbacks.map((modelId: string) => {
          if (fullConfig.providers) {
            for (const [providerName, providerDef] of Object.entries(fullConfig.providers)) {
              const model = providerDef.models?.find((m) => m.id === modelId);
              if (model) {
                return {
                  provider: providerName,
                  baseUrl: providerDef.baseUrl,
                  apiKey: providerDef.apiKey,
                  model: model.id,
                  contextTokens: model.contextTokens,
                  maxTokens: model.maxTokens,
                };
              }
            }
          }
          return {
            provider: this.config.llm.provider,
            baseUrl: this.config.llm.baseUrl,
            apiKey: this.config.llm.apiKey,
            model: modelId,
            contextTokens: this.config.llm.contextTokens,
            maxTokens: this.config.llm.maxTokens,
          };
        });

        return createFailoverChain([primary, ...fallbackModels]);
      }
    } catch (err) {
      logger.warn({ err }, "Failed to load failover chain config — using primary model only");
    }

    return createFailoverChain([primary]);
  }

  /**
   * Recreate the OpenAI client with the current failover model's baseUrl/apiKey.
   * Called on initialization and whenever the failover chain switches providers.
   */
  private updateClientForModel(): void {
    const model = this.failoverState ? getCurrentModel(this.failoverState) : null;
    const baseUrl = model?.baseUrl ?? this.config.llm.baseUrl;
    const apiKey = model?.apiKey ?? this.config.llm.apiKey ?? "unused";

    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    });
  }

  private initProvider(): void {
    const currentModel = this.failoverState ? getCurrentModel(this.failoverState) : null;
    const baseUrl = currentModel?.baseUrl ?? this.config.llm.baseUrl;
    const apiKey = currentModel?.apiKey ?? this.config.llm.apiKey;

    if (baseUrl && apiKey) {
      this.provider = new OpenAICompatibleProvider(baseUrl, apiKey);
    }

    const contextTokens = this.config.llm.contextTokens ?? this.config.maxContextTokens;
    if (contextTokens && contextTokens > 0) {
      this.promptCacheTracker = new PromptCacheTracker();
    }
  }

  setToolExecutor(executor: ToolExecutor, toolNames: string[], mcpDefs?: ToolDefinition[]) {
    this.toolExecutor = executor;
    if (mcpDefs && mcpDefs.length > 0) {
      this.mcpToolDefinitions = mcpDefs;
      this.toolDefinitions = buildToolDefinitions(toolNames);
    } else {
      this.toolDefinitions = buildToolDefinitions(toolNames);
      this.mcpToolDefinitions = [];
    }
    const totalCount = this.toolDefinitions.length + this.mcpToolDefinitions.length;
    logger.info({ nativeCount: this.toolDefinitions.length, mcpCount: this.mcpToolDefinitions.length, totalCount }, "Tool executor configured");
  }

  setAgentToolScope(agentId: string, toolNames: string[]) {
    this.agentToolScope.set(agentId, toolNames);
  }

  private getScopedToolDefinitions(agentId: string | undefined): ToolDefinition[] {
    if (!agentId) return [...this.toolDefinitions, ...this.mcpToolDefinitions];
    const scoped = this.agentToolScope.get(agentId);
    if (!scoped || scoped.length === 0) return [...this.toolDefinitions, ...this.mcpToolDefinitions];
    const nativeDefs = buildToolDefinitions(scoped);
    const mcpDefs = this.mcpToolDefinitions.filter(d => scoped.includes(d.name));
    return [...nativeDefs, ...mcpDefs];
  }

  /**
   * Wire session persistence to a SessionRegistry-compatible store.
   * Messages, tool calls, and metadata will be persisted and restored across restarts.
   */
  wireSessionPersistence(registry: SessionPersistence): void {
    const callbacks: PersistCallbacks = {
      onSave: (sessionId, messages, toolCalls, metadata) => {
        registry.saveMessages(sessionId, messages.map(m => ({
          role: m.role,
          content: m.content,
          tokenEstimate: m.tokenEstimate ?? 0,
          isSummary: m.isSummary,
          compacted: m.compacted,
          timestamp: m.timestamp,
          tool_call_id: m.tool_call_id,
          tool_calls: m.tool_calls,
        })));
        registry.saveToolCalls(sessionId, toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          result: tc.result,
          tokenEstimate: tc.tokenEstimate ?? 0,
          compacted: tc.compacted,
          timestamp: tc.timestamp,
        })));
        registry.updateSessionMetadata(sessionId, {
          compactionCount: metadata.compactionCount,
          previousSummary: metadata.previousSummary,
          hasRealConversation: metadata.hasRealConversation,
        });
      },
      onLoad: (sessionId) => {
        const data = registry.loadSessionData(sessionId);
        if (!data || data.messages.length === 0) return null;
        return {
          messages: data.messages.map(m => ({ ...m, role: m.role as "system" | "user" | "assistant" | "tool" })),
          toolCalls: data.toolCalls,
          metadata: data.metadata ?? { compactionCount: 0, hasRealConversation: false },
        };
      },
    };
    this.contextManager.wirePersistence(callbacks);
    logger.info("Session persistence wired to registry");
  }

  createSession(agentId: string, options?: {
    memoryInjection?: string;
    mode?: "full" | "heartbeat" | "message" | "minimal";
  }): string {
    const sessionId = uuidv4();
    const systemPrompt = buildSystemPrompt({
      agentId,
      memoryInjection: options?.memoryInjection,
      mode: options?.mode || "full",
    });

    this.contextManager.createSession(agentId, sessionId, systemPrompt, {
      modelContextTokens: this.config.llm.contextTokens,
    });
    logger.info({ sessionId, agentId }, "Session created");
    return sessionId;
  }

  async getOrCreateRuntimeSession(agentId: string, options?: {
    memoryInjection?: string;
    mode?: "full" | "heartbeat" | "message" | "minimal";
    chatId?: string;
  }): Promise<string> {
    const sessionKey = `${agentId}:${options?.chatId || ''}`;
    const existing = this.agentSessions.get(sessionKey);
    if (existing) {
      const session = this.contextManager.getSession(existing);
      if (session) return existing;
    }

    let initPromise = this.sessionInitPromises.get(sessionKey);
    if (!initPromise) {
      initPromise = (async () => {
        const sessionId = this.createSession(agentId, options);
        this.agentSessions.set(sessionKey, sessionId);
        return sessionId;
      })().then(sessionId => {
        this.sessionInitPromises.delete(sessionKey);
        return sessionId;
      }).catch((err) => {
        this.sessionInitPromises.delete(sessionKey);
        logger.error({ agentId, err: err.message }, "Session init failed");
        throw err;
      });
      this.sessionInitPromises.set(sessionKey, initPromise);
    }
    return initPromise;
  }

  restoreSession(agentId: string, sessionId: string, options?: {
    mode?: "full" | "heartbeat" | "message" | "minimal";
    chatId?: string;
  }): boolean {
    const sessionKey = `${agentId}:${options?.chatId || ''}`;
    const systemPrompt = buildSystemPrompt({
      agentId,
      mode: options?.mode || "full",
    });

    const created = this.contextManager.createSession(agentId, sessionId, systemPrompt, {
      modelContextTokens: this.config.llm.contextTokens,
    });

    if (created) {
      this.agentSessions.set(sessionKey, sessionId);
      logger.info({ sessionId, agentId }, "Session restored from persisted state");
      return true;
    }

    logger.warn({ sessionId, agentId }, "Session restoration failed — creating fresh session");
    const newSessionId = this.createSession(agentId, options);
    this.agentSessions.set(sessionKey, newSessionId);
    return false;
  }

  async sendMessage(sessionId: string, message: string, agentId?: string): Promise<AgentExecutionResult> {
    const session = this.contextManager.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const resolvedAgentId = session.agentId;

    const skillsBlock = await this.buildSkillsBlock(resolvedAgentId, message);
    const systemPrompt = skillsBlock && !session.systemPrompt.includes("## Available Skills")
      ? session.systemPrompt + "\n\n" + skillsBlock
      : session.systemPrompt;

    this.contextManager.addUserMessage(sessionId, message);

    let toolCallsExecuted = 0;
    let finalText = "";
    let firstRoundInputTokens = 0;
    let totalOutputTokens = 0;
    let totalReasoningTokens = 0;
    let toolCallHistory: ToolCallRecord[] = [];

    for (let round = 0; round < (this.config.llm.maxToolRounds || 10); round++) {
      const messages = this.contextManager.getMessagesForLLM(sessionId);

      // Inject augmented system prompt if skills were added
      if (systemPrompt !== session.systemPrompt) {
        const sysMsg = messages.find(m => m.role === "system");
        if (sysMsg) {
          sysMsg.content = systemPrompt;
        }
      }

      const response = await this.callLLMWithRetry(messages, undefined, session.agentId);

      if (response.usage) {
        if (round === 0) {
          firstRoundInputTokens = response.usage.prompt_tokens || 0;
        }
        totalOutputTokens += response.usage.completion_tokens || 0;
        totalReasoningTokens += ((response.usage as Record<string, unknown>)["completion_tokens_details"] as Record<string, unknown> | undefined)?.["reasoning_tokens"] as number | undefined || 0;
      }

      const textContent = response.content
        .filter(c => c.type === "text")
        .map(c => c.text)
        .join("\n");

      if (response.toolCalls && response.toolCalls.length > 0 && this.toolExecutor) {
        await this.contextManager.recordAssistantToolCalls(sessionId, textContent, response.toolCalls);

        const toolResults: Array<{ id: string; name: string; args: string; result: string }> = [];

        for (const tc of response.toolCalls) {
          let args: Record<string, unknown>;
          let argsStr: string;
          try {
            args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments;
            argsStr = typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments);
          } catch (parseErr: unknown) {
            const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
            logger.warn(
              { tool: tc.function.name, error: msg, raw: (tc.function.arguments as string).slice(0, 200) },
              "Failed to parse tool arguments — sending error to LLM",
            );
            // Push error result to LLM so it can self-correct
            toolResults.push({
              id: tc.id,
              name: tc.function.name,
              args: (tc.function.arguments as string) ?? "",
              result: `Error: Failed to parse arguments: ${msg}`,
            });
            toolCallsExecuted++;
            continue;
          }

          logger.info({ tool: tc.function.name, round, agentId: session.agentId }, "Tool call");

          // Ensure agent_id is injected before tool execution
          if (!(args as Record<string, unknown>)["agent_id"]) {
            (args as Record<string, unknown>)["agent_id"] = session.agentId;
          }

          // Record tool call for loop detection
          toolCallHistory = recordToolCall(toolCallHistory, tc.function.name, args, tc.id, this.loopDetectionConfig);

          // Check for tool call loops before execution
          const loopCheck = detectToolCallLoop(toolCallHistory, tc.function.name, args, this.loopDetectionConfig);
          if (loopCheck.stuck && loopCheck.level === "critical") {
            logger.error(
              { tool: tc.function.name, round, agentId: session.agentId, message: loopCheck.message },
              "Tool call loop detected — blocking execution",
            );
            toolResults.push({
              id: tc.id,
              name: tc.function.name,
              args: argsStr,
              result: `BLOCKED: ${loopCheck.message}`,
            });
            toolCallsExecuted++;
            toolCallHistory = recordToolCallOutcome(toolCallHistory, tc.function.name, args, `BLOCKED: ${loopCheck.message}`, undefined, tc.id, this.loopDetectionConfig);
            continue;
          }

          const result = await this.toolExecutor(tc.function.name, args);

          // Record outcome for loop detection
          toolCallHistory = recordToolCallOutcome(
            toolCallHistory,
            tc.function.name,
            args,
            result.success ? result.content : result.error ?? "Unknown error",
            undefined,
            tc.id,
            this.loopDetectionConfig,
          );

          // Inject warning for non-critical loops
          if (loopCheck.stuck && loopCheck.level === "warning") {
            const warningText = `⚠️ Loop Warning: ${loopCheck.message} Please stop repeating the same tool calls and try a different approach.`;
            logger.warn(
              { tool: tc.function.name, round, agentId: session.agentId, message: loopCheck.message },
              "Tool call loop warning — injecting message to agent",
            );
            this.contextManager.addUserMessage(sessionId, warningText);
          }

          toolResults.push({
            id: tc.id,
            name: tc.function.name,
            args: argsStr,
            result: result.success ? result.content : `Error: ${result.error}`,
          });

          toolCallsExecuted++;
        }

        for (const tr of toolResults) {
          const { content: truncatedResult, truncated, originalLength } = truncateToolResult(tr.result);
          if (truncated) {
            logger.warn({ tool: tr.name, originalLength, truncatedLength: truncatedResult.length }, "Tool result truncated for context safety");
          }
          await this.contextManager.recordToolCall(sessionId, {
            id: tr.id,
            name: tr.name,
            arguments: tr.args,
            result: truncatedResult,
            timestamp: Date.now(),
          });
        }

        continue;
      }

      finalText = textContent;
      break;
    }

    // Empty-response retry: if tool calls ran but produced no text summary,
    // make one extra LLM round to extract findings as text.
    if (!finalText && toolCallsExecuted > 0) {
      logger.warn(
        { sessionId, agentId: session.agentId, toolCallsExecuted },
        "Tool loop exhausted without text response — requesting summary",
      );

      const summaryMessages = this.contextManager.getMessagesForLLM(sessionId);
      const summaryResponse = await this.callLLMWithRetry(
        summaryMessages,
        undefined,
        session.agentId,
      );

      if (summaryResponse.usage) {
        totalOutputTokens += summaryResponse.usage.completion_tokens || 0;
        totalReasoningTokens += ((summaryResponse.usage as Record<string, unknown>)["completion_tokens_details"] as Record<string, unknown> | undefined)?.["reasoning_tokens"] as number | undefined || 0;
      }

      finalText = summaryResponse.content
        .filter(c => c.type === "text")
        .map(c => c.text)
        .join("\n");

      if (!finalText) {
        finalText = `The agent completed ${toolCallsExecuted} tool operations but could not generate a summary. This may indicate context overflow or a complex multi-step task. Check the Kanban board for task status and review the agent's memory for detailed findings.`;
        logger.warn(
          { sessionId, agentId: session.agentId, toolCallsExecuted },
          "Summary round also returned empty — using fallback text",
        );
      }
    }

    if (finalText) {
      await this.contextManager.addAssistantMessage(sessionId, finalText);
    }

    const silentAck = isSilentAck(finalText);
    const substantive = hasSubstantiveFinding(finalText);

    logger.info({
      sessionId,
      agentId: session.agentId,
      silentAck,
      substantive,
      toolCalls: toolCallsExecuted,
      inputTokens: firstRoundInputTokens,
      outputTokens: totalOutputTokens,
    }, "Agent response complete");

    return {
      sessionId,
      text: finalText,
      tokens: {
        total: firstRoundInputTokens + totalOutputTokens,
        input: firstRoundInputTokens,
        output: totalOutputTokens,
        reasoning: totalReasoningTokens,
      },
      isSilentAck: silentAck,
      hasSubstantiveFinding: substantive,
      toolCallsExecuted,
    };
  }

  async sendHeartbeat(sessionId: string, taskDelta: string, agentId?: string, memoryInjection?: string): Promise<AgentExecutionResult> {
    const session = this.contextManager.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const resolvedAgentId = session.agentId;

    const heartbeatPrompt = [
      currentTimeLine(),
      memoryInjection || "",
      taskDelta,
    ].filter(Boolean).join("\n\n");

    return this.sendMessage(sessionId, heartbeatPrompt, resolvedAgentId);
  }

  async compactSession(sessionId: string, keepRecent?: number): Promise<void> {
    await this.contextManager.compact(sessionId, keepRecent);
  }

  clearSession(sessionId: string): void {
    this.contextManager.clearHistory(sessionId);
  }

  deleteSession(sessionId: string): void {
    this.contextManager.deleteSession(sessionId);
  }

  getSessionStats(sessionId: string) {
    return this.contextManager.getStats(sessionId);
  }

  listSessions() {
    return this.contextManager.listSessions();
  }

  getContextManager() {
    return this.contextManager;
  }

  // ── Skill Discovery and Injection ──────────────────────────────────

  private getOrCreateRegistry(agentId: string): SkillRegistry {
    const existing = this.skillRegistries.get(agentId);
    if (existing) return existing;

    const registry = new SkillRegistry();
    this.skillRegistries.set(agentId, registry);
    return registry;
  }

  private async buildSkillsBlock(agentId: string, message: string): Promise<string | null> {
    const workspaceDir = getAgentWorkspace(agentId);
    const registry = this.getOrCreateRegistry(agentId);

    const skills = await registry.discover(workspaceDir);
    if (skills.length === 0) return null;

    const relevant = registry.findRelevant(message, 3);
    if (relevant.length === 0) return null;

    const lines: string[] = [
      "## Available Skills",
      "",
      "The following skills are relevant to the current task. Use them as your operational playbook:",
      "",
    ];

    for (const skill of relevant) {
      lines.push(`### ${skill.name}`);
      lines.push("");
      if (skill.description) {
        lines.push(skill.description);
        lines.push("");
      }
      lines.push(skill.content);
      lines.push("");
    }

    logger.info({ agentId, skillCount: relevant.length, totalSkills: skills.length }, "Skills injected into system prompt");
    return lines.join("\n");
  }

  // ── Compaction Summarization ─────────────────────────────────────────

  /** Max tokens before staging kicks in (aligned with context-manager) */
  private static readonly SUMMARY_STAGE_THRESHOLD = 16_000;

  /**
   * Summarization callback for ContextManager compaction.
   * Uses LLM-based staged summarization: split → summarize → merge.
   * Preserves all opaque identifiers (UUIDs, hashes, IDs, URLs, file paths).
   */
  private async compactionSummarizeFn(
    messages: ChatMessage[],
    previousSummary?: string,
    customInstructions?: string,
  ): Promise<string> {
    const totalTokens = messages.reduce(
      (sum, m) => sum + (m.tokenEstimate ?? estimateTokens(m.content ?? "")),
      0,
    );

    if (totalTokens <= NativeAgentRuntime.SUMMARY_STAGE_THRESHOLD) {
      return this.summarizeChunk(messages, previousSummary, customInstructions);
    }

    const numChunks = Math.max(
      2,
      Math.ceil(totalTokens / NativeAgentRuntime.SUMMARY_STAGE_THRESHOLD),
    );
    const chunks = splitMessagesByTokenShare(messages, numChunks);

    const chunkSummaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkInstructions = [
        `Preserve ALL opaque identifiers exactly as written — UUIDs, hashes, IDs, API keys, hostnames, IPs, ports, URLs, file names. Do NOT summarize or paraphrase these.`,
        `(chunk ${i + 1}/${chunks.length})`,
      ].join(" ");
      const s = await this.summarizeChunk(chunks[i], undefined, chunkInstructions);
      chunkSummaries.push(s);
    }

    if (chunkSummaries.length === 1) return chunkSummaries[0];

    const mergeInput = chunkSummaries
      .map((s, i) => `--- Chunk ${i + 1}/${chunkSummaries.length} ---\n${s}`)
      .join("\n\n");

    const mergePrompt = this.buildMergePrompt(mergeInput, previousSummary);
    return this.summarizeViaLLM(mergePrompt);
  }

  private async summarizeChunk(
    messages: ChatMessage[],
    previousSummary?: string,
    customInstructions?: string,
  ): Promise<string> {
    const prompt = this.buildSummaryPrompt(messages, previousSummary, customInstructions);
    return this.summarizeViaLLM(prompt);
  }

  private buildSummaryPrompt(
    messages: ChatMessage[],
    previousSummary?: string,
    customInstructions?: string,
  ): string {
    const parts: string[] = [
      "Provide a detailed summary for continuing this conversation.",
      "Focus on information that would be helpful for continuing the work, including what was done, what's in progress, and what needs to happen next.",
      "Do NOT respond to questions. Just output the summary.",
      "",
      "When constructing the summary, follow this template:",
      "---",
      "## Goal",
      "[What goal(s) the agent was working on]",
      "",
      "## Instructions",
      "[Important instructions, constraints, or user preferences]",
      "",
      "## Discoveries",
      "[Notable findings, data, decisions, or patterns discovered]",
      "",
      "## Accomplished",
      "[What work was completed, what's in progress, what's left]",
      "",
      "## Key Data",
      "[Specific numbers, dates, names, file paths, or IDs mentioned]",
      "",
      "## Next Steps",
      "[What to do next — concrete, actionable items]",
    ];

    if (previousSummary) {
      parts.unshift(`## Previous Summary\n${previousSummary}\n`);
      parts.unshift("Build on the previous summary. Update it with new information from the messages below.\n");
    }

    if (customInstructions) {
      parts.push("");
      parts.push(customInstructions);
    }

    const messageText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join("\n\n");

    parts.push("\n---\n## Conversation to Summarize\n");
    parts.push(messageText);

    return parts.join("\n");
  }

  private buildMergePrompt(
    partialSummaries: string,
    previousSummary?: string,
  ): string {
    const parts: string[] = [
      "Merge these partial conversation summaries into a single coherent summary.",
      "Preserve ALL opaque identifiers exactly as written — UUIDs, hashes, IDs, API keys, hostnames, IPs, ports, URLs, file names. Do NOT summarize or paraphrase these.",
      "",
      "Follow this template:",
      "---",
      "## Goal",
      "[What goal(s) the agent was working on]",
      "",
      "## Instructions",
      "[Important instructions, constraints, or user preferences]",
      "",
      "## Discoveries",
      "[Notable findings, data, decisions, or patterns discovered]",
      "",
      "## Accomplished",
      "[What work was completed, what's in progress, what's left]",
      "",
      "## Key Data",
      "[Specific numbers, dates, names, file paths, or IDs mentioned]",
      "",
      "## Next Steps",
      "[What to do next — concrete, actionable items]",
    ];

    if (previousSummary) {
      parts.unshift(`## Previous Summary\n${previousSummary}\n`);
      parts.unshift("Build on the previous summary. Integrate it with the partial summaries below.\n");
    }

    parts.push("\n---\n## Partial Summaries to Merge\n");
    parts.push(partialSummaries);

    return parts.join("\n");
  }

  private async summarizeViaLLM(prompt: string): Promise<string> {
    const summaryMessages: ChatMessage[] = [
      { role: "system", content: "You are a conversation summarizer. Provide structured summaries for agent continuation.", timestamp: Date.now() },
      { role: "user", content: prompt, timestamp: Date.now() },
    ];

    const response = await this.callLLMWithRetry(summaryMessages, {
      temperature: 0.1,
      maxTokens: 2048,
    });

    const text = response.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("\n");

    if (!text) {
      throw new Error("Summarization returned empty response");
    }

    return text;
  }

  // ── LLM Call with Retry ──────────────────────────────────────────

  /**
   * LLM call with config-driven retry using the standalone retryAsync utility.
   * Supports Retry-After headers and model fallback chain.
   */
  private async callLLMWithRetry(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
    agentId?: string,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
  }> {
    let retryConfig: RetryOptions["attempts"] = 3;
    let minDelayMs = 2000;
    let maxDelayMs = 30000;
    let jitter = 0.2;

    try {
      const fullConfig = loadConfig();
      if (fullConfig.llm?.retry) {
        retryConfig = fullConfig.llm.retry.attempts;
        minDelayMs = fullConfig.llm.retry.minDelayMs;
        maxDelayMs = fullConfig.llm.retry.maxDelayMs;
        jitter = fullConfig.llm.retry.jitter;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to load LLM retry config — using defaults");
    }

    const label = `llm-call:${this.config.llm.model}`;

    return retryAsync(
      () => this.callLLMWithFailover(messages, options, agentId),
      {
        attempts: retryConfig,
        minDelayMs,
        maxDelayMs,
        jitter,
        label,
        shouldRetry: (err: unknown) => isRetryableError(err),
        retryAfterMs: (err: unknown) => {
          const retryAfter = (err as Record<string, unknown>)?.["retryAfter"] as number | string | undefined;
          if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) return retryAfter * 1000;
          if (typeof retryAfter === "string") {
            const parsed = Number(retryAfter);
            if (Number.isFinite(parsed)) return parsed > 1000 ? parsed : parsed * 1000;
          }
          const retryAfterMs = (err as Record<string, unknown>)?.["retryAfterMs"] as number | undefined;
          if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)) return retryAfterMs;
          return undefined;
        },
        onRetry: ({ attempt, maxAttempts, delayMs, err }) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn(
            { attempt: attempt + 1, maxAttempts, delayMs, error: errMsg, label },
            "LLM call failed — retrying",
          );
        },
      },
    );
  }

  /**
   * Execute a single LLM call with model fallback chain support.
   * When the current model fails after retries, auto-failover to next model.
   * Also handles billing backoff and auth profile rotation.
   */
  private async callLLMWithFailover(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
    agentId?: string,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
  }> {
    if (!this.failoverState) {
      return this.callLLM(messages, options, agentId);
    }

    const currentModel = getCurrentModel(this.failoverState);

    // Check billing backoff — skip provider if in cooldown
    const backoffRemaining = getBillingBackoffRemainingMs(
      this.billingBackoff,
      currentModel.provider,
      currentModel.model,
    );
    if (backoffRemaining > 0) {
      logger.warn(
        { provider: currentModel.provider, model: currentModel.model, backoffMs: backoffRemaining },
        "Provider in billing cooldown — attempting failover to next model"
      );
      const nextModel = failoverToNext(this.failoverState, undefined, "billing_error");
      if (!nextModel) {
        throw new Error(`LLM provider ${currentModel.provider}:${currentModel.model} is in billing cooldown (${Math.ceil(backoffRemaining / 60000)}min remaining) and no fallback available`);
      }
      logger.info({ toModel: nextModel.model, toProvider: nextModel.provider }, "Failed over due to billing cooldown");
    }

    this.updateClientForModel();

    try {
      const result = await this.callLLM(messages, options, agentId);
      // Success — clear billing backoff and reset failover
      clearBillingBackoff(this.billingBackoff, currentModel.provider, currentModel.model);
      resetFailover(this.failoverState);
      return result;
    } catch (err: unknown) {
      const { should: shouldFail, reason, skipFailover } = shouldFailoverWithAuthAndBilling(err);

      // Billing error: record backoff, do NOT failover (same provider has billing issue)
      if (reason === "billing_error") {
        const errMsg = err instanceof Error ? err.message : String(err);
        const { cooldownMs, backoffUntil } = recordBillingError(
          this.billingBackoff,
          currentModel.provider,
          currentModel.model,
          errMsg,
        );
        logger.error(
          { provider: currentModel.provider, model: currentModel.model, cooldownMs, backoffUntil },
          "Billing error — provider placed in cooldown"
        );
        // Try failover anyway since current provider is unavailable
        const nextModel = failoverToNext(this.failoverState, err instanceof Error ? err : new Error(errMsg), reason);
        if (!nextModel) {
          throw new Error(`LLM billing error for ${currentModel.provider}:${currentModel.model}. Cooldown: ${Math.ceil(cooldownMs / 60000)}min. No fallback models available.`);
        }
        logger.warn({ toModel: nextModel.model }, "Failover after billing error");
        this.updateClientForModel();
        return this.callLLM(messages, options, agentId);
      }

      if (!shouldFail || skipFailover) {
        throw err;
      }

      const nextModel = failoverToNext(
        this.failoverState,
        err instanceof Error ? err : new Error(String(err)),
        reason,
      );

      if (!nextModel) {
        const errMsg = err instanceof Error ? err.message : String(err);
        throw new Error(`LLM call failed after exhausting all fallback models: ${errMsg}`);
      }

      logger.warn(
        {
          fromModel: currentModel.model,
          toModel: nextModel.model,
          provider: nextModel.provider,
          reason,
        },
        `Model failover — switching to fallback${reason === "auth_error" ? " (auth error rotated)" : ""}`,
      );

      this.updateClientForModel();
      return this.callLLM(messages, options, agentId);
    }
  }

  // ── Core LLM Call ────────────────────────────────────────────────

  private async callLLM(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
    agentId?: string,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
  }> {
    const currentModel = this.failoverState ? getCurrentModel(this.failoverState) : null;
    const model = currentModel?.model ?? this.config.llm.model;

    const llmMessages = messages.map(m => {
      if (m.role === "tool") {
        return { role: "tool" as const, tool_call_id: m.tool_call_id, content: m.content };
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        return { role: "assistant" as const, content: m.content ?? null, tool_calls: m.tool_calls };
      }
      return { role: m.role, content: m.content };
    });

    const params: Record<string, unknown> = {
      model,
      messages: llmMessages,
      max_tokens: options?.maxTokens ?? currentModel?.maxTokens ?? this.config.llm.maxTokens,
      temperature: options?.temperature ?? this.config.llm.temperature,
    };

    const tools = this.getScopedToolDefinitions(agentId);
    if (tools.length > 0) {
      params.tools = tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    let timeoutMs = MAX_SAFE_TIMEOUT_MS; // default: unlimited
    try {
      const fullConfig = loadConfig();
      timeoutMs = resolveTimeoutMs(fullConfig.llm?.timeoutMs ?? this.config.llm.timeoutMs);
    } catch {
      timeoutMs = resolveTimeoutMs(this.config.llm.timeoutMs);
    }

    const controller = new AbortController();
    const timeoutId = timeoutMs >= MAX_SAFE_TIMEOUT_MS ? undefined : setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.client.chat.completions.create(
        params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        { timeout: timeoutMs },
      );
      clearTimeout(timeoutId);
      const choice = response.choices[0];
      if (!choice) throw new Error("No response from LLM");

      const content: Array<{ type: "text"; text: string }> = [];
      if (choice.message.content) {
        content.push({ type: "text", text: choice.message.content });
      }

      let toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> | undefined;
      if (choice.message.tool_calls) {
        toolCalls = choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      const usageRaw = response.usage as unknown as Record<string, unknown> | undefined;
      if (usageRaw && this.promptCacheTracker) {
        const cacheRead = usageRaw["cache_read_input_tokens"] as number | undefined;
        if (cacheRead !== undefined) {
          const fingerprint = createPromptFingerprint(llmMessages);
          this.promptCacheTracker.record(fingerprint, cacheRead);
        }
      }

      return { content, toolCalls, usage: response.usage || undefined };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && (err.name === "AbortError" || (err as { code?: string }).code === "ECONNABORTED")) {
        throw new Error(`LLM call timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  // ── Prompt Cache Stats ─────────────────────────────────────────────

  getPromptCacheStats(): { enabled: boolean; totalFingerprints: number } {
    if (!this.promptCacheTracker) {
      return { enabled: false, totalFingerprints: 0 };
    }
    return { enabled: true, ...this.promptCacheTracker.getStats() };
  }

  // ── Streaming Support ──────────────────────────────────────────────

  async *streamMessage(sessionId: string, message: string, agentId?: string): AsyncIterable<StreamEvent> {
    const session = this.contextManager.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    if (!this.provider) {
      throw new Error("Streaming not available — provider not initialized");
    }

    this.contextManager.addUserMessage(sessionId, message);

    const maxRounds = this.config.llm.maxToolRounds || 10;
    let round = 0;
    let toolCallHistory: ToolCallRecord[] = [];

    // ── WS cancel support ────────────────────────────────────────────
    const abortController = new AbortController();
    let cancelHandler: ((data: { agentId: string; runId: string }) => void) | null = null;
    try {
      const ws = getWsGateway();
      cancelHandler = (data: { agentId: string; runId: string }) => {
        if (data.agentId === session.agentId && data.runId === sessionId) {
          abortController.abort();
        }
      };
      ws.on("cancel", cancelHandler);
    } catch {
      /* WS not available */
    }

    try {
    while (round < maxRounds) {
      round++;
      const messages = this.contextManager.getMessagesForLLM(sessionId);

      const currentModel = this.failoverState ? getCurrentModel(this.failoverState) : null;
      const model = currentModel?.model ?? this.config.llm.model;

      const llmMessages = messages.map(m => {
        if (m.role === "tool") {
          return { role: "tool" as const, tool_call_id: m.tool_call_id, content: m.content };
        }
        if (m.tool_calls && m.tool_calls.length > 0) {
          return { role: "assistant" as const, content: m.content ?? null, tool_calls: m.tool_calls };
        }
        return { role: m.role, content: m.content };
      });
      const fingerprint = createPromptFingerprint(llmMessages);

      const tools = this.getScopedToolDefinitions(agentId);
      const toolDefs = tools.length > 0
        ? tools.map(t => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined;

      let timeoutMs = resolveTimeoutMs(this.config.llm.timeoutMs);
      const controller = new AbortController();
      const timeoutId = timeoutMs >= MAX_SAFE_TIMEOUT_MS ? undefined : setTimeout(() => controller.abort(), timeoutMs);

      // Accumulate tool calls from the stream
      const toolCallAccum: Map<string, { id: string; name: string; inputChunks: string[] }> = new Map();
      let streamHadToolCalls = false;

      try {
        for await (const event of this.provider.stream({
          model,
          messages: llmMessages,
          tools: toolDefs,
          temperature: this.config.llm.temperature,
          maxTokens: this.config.llm.maxTokens,
          abortSignal: controller.signal,
          timeoutMs: this.config.llm.timeoutMs,
        })) {
          // Accumulate tool_call chunks
          if (event.type === "tool_use") {
            streamHadToolCalls = true;
            const existing = toolCallAccum.get(event.id);
            if (existing) {
              if (event.input) {
                existing.inputChunks.push(event.input);
              }
            } else {
              toolCallAccum.set(event.id, {
                id: event.id,
                name: event.name,
                inputChunks: event.input ? [event.input] : [],
              });
            }
          }

          // Track cache reads on usage events
          if (event.type === "usage" && this.promptCacheTracker) {
            const cacheRead = (event.usage as Record<string, unknown>)?.["cache_read_input_tokens"] as number | undefined;
            if (cacheRead !== undefined) {
              this.promptCacheTracker.record(fingerprint, cacheRead);
            }
          }

          yield event;

          try {
            const ws = getWsGateway();
            ws.pushStreamChunk(session.agentId, sessionId, event as unknown as Record<string, unknown>);
          } catch { /* WS not available */ }

          if (abortController.signal.aborted) {
            break;
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }

      // If no tool calls in the stream, we're done
      if (!streamHadToolCalls || toolCallAccum.size === 0) {
        break;
      }

      // Execute accumulated tool calls — try WS path first, fall back to direct execution
      try {
        const ws = getWsGateway();
        if (ws.getSessionByAgentId(session.agentId)) {
          const wsToolResults: Array<{ id: string; name: string; args: string; result: string }> = [];
          for (const [callId, callInfo] of toolCallAccum) {
            const argsStr = callInfo.inputChunks.join("");
            let args: Record<string, unknown>;
            try {
              args = JSON.parse(argsStr);
            } catch (parseErr: unknown) {
              const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
              logger.warn(
                { tool: callInfo.name, round, error: msg, raw: argsStr.slice(0, 200) },
                "Failed to parse tool arguments in stream (WS path)",
              );
              wsToolResults.push({
                id: callId,
                name: callInfo.name,
                args: argsStr,
                result: `Error: Failed to parse arguments: ${msg}`,
              });
              continue;
            }

            if (!args["agent_id"]) {
              args["agent_id"] = session.agentId;
            }

            logger.info({ tool: callInfo.name, round, agentId: session.agentId, mode: "ws" }, "Tool call over WS");
            const result = await ws.pushToolCall(session.agentId, callId, callInfo.name, args);
            wsToolResults.push({
              id: callId,
              name: callInfo.name,
              args: argsStr,
              result,
            });
          }

          const assistantToolCalls = Array.from(toolCallAccum.values()).map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.inputChunks.join("") },
          }));
          if (assistantToolCalls.length > 0) {
            await this.contextManager.recordAssistantToolCalls(sessionId, null, assistantToolCalls);
          }

          for (const tr of wsToolResults) {
            await this.contextManager.recordToolCall(sessionId, {
              id: tr.id,
              name: tr.name,
              arguments: tr.args,
              result: tr.result,
              timestamp: Date.now(),
            });
          }

          for (const tr of wsToolResults) {
            yield {
              type: "text" as const,
              delta: `\n[Tool: ${tr.name}] ${tr.result.slice(0, 500)}${tr.result.length > 500 ? "..." : ""}\n`,
            };
          }

          continue;
        }
      } catch { /* WS not available, fall through to direct execution */ }

      if (!this.toolExecutor) {
        logger.warn({ sessionId, agentId }, "Tool executor not available — skipping tool calls in stream");
        break;
      }

      const toolResults: Array<{ id: string; name: string; args: string; result: string }> = [];

      for (const [callId, callInfo] of toolCallAccum) {
        const argsStr = callInfo.inputChunks.join("");
        let args: Record<string, unknown>;

        try {
          args = JSON.parse(argsStr);
        } catch (parseErr: unknown) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          logger.warn(
            { tool: callInfo.name, round, error: msg, raw: argsStr.slice(0, 200) },
            "Failed to parse tool arguments in stream",
          );
          toolResults.push({
            id: callId,
            name: callInfo.name,
            args: argsStr,
            result: `Error: Failed to parse arguments: ${msg}`,
          });
          continue;
        }

        logger.info({ tool: callInfo.name, round, agentId: session.agentId }, "Tool call (stream)");

        // Ensure agent_id is set if not provided
        if (!args["agent_id"]) {
          args["agent_id"] = session.agentId;
        }

        toolCallHistory = recordToolCall(toolCallHistory, callInfo.name, args, callId, this.loopDetectionConfig);

        const loopCheck = detectToolCallLoop(toolCallHistory, callInfo.name, args, this.loopDetectionConfig);
        if (loopCheck.stuck && loopCheck.level === "critical") {
          logger.error(
            { tool: callInfo.name, round, agentId: session.agentId, message: loopCheck.message },
            "Tool call loop detected in stream — blocking execution",
          );
          const blockedResult = `BLOCKED: ${loopCheck.message}`;
          toolResults.push({
            id: callId,
            name: callInfo.name,
            args: argsStr,
            result: blockedResult,
          });
          toolCallHistory = recordToolCallOutcome(toolCallHistory, callInfo.name, args, blockedResult, undefined, callId, this.loopDetectionConfig);
          continue;
        }

        try {
          const result = await this.toolExecutor(callInfo.name, args);
          toolCallHistory = recordToolCallOutcome(
            toolCallHistory,
            callInfo.name,
            args,
            result.success ? result.content : result.error ?? "Unknown error",
            undefined,
            callId,
            this.loopDetectionConfig,
          );

          if (loopCheck.stuck && loopCheck.level === "warning") {
            const warningText = `⚠️ Loop Warning: ${loopCheck.message} Please stop repeating the same tool calls and try a different approach.`;
            logger.warn(
              { tool: callInfo.name, round, agentId: session.agentId, message: loopCheck.message },
              "Tool call loop warning in stream — injecting message to agent",
            );
            this.contextManager.addUserMessage(sessionId, warningText);
          }

          toolResults.push({
            id: callId,
            name: callInfo.name,
            args: argsStr,
            result: result.success ? result.content : `Error: ${result.error}`,
          });
        } catch (execErr: unknown) {
          const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
          logger.error({ tool: callInfo.name, round, error: errMsg }, "Tool execution failed in stream");
          toolCallHistory = recordToolCallOutcome(
            toolCallHistory,
            callInfo.name,
            args,
            `Error: Tool execution failed: ${errMsg}`,
            undefined,
            callId,
            this.loopDetectionConfig,
          );
          toolResults.push({
            id: callId,
            name: callInfo.name,
            args: argsStr,
            result: `Error: Tool execution failed: ${errMsg}`,
          });
        }
      }

      // Record assistant tool_calls message before recording tool results
      const assistantToolCalls = Array.from(toolCallAccum.values()).map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.inputChunks.join("") },
      }));
      if (assistantToolCalls.length > 0) {
        await this.contextManager.recordAssistantToolCalls(sessionId, null, assistantToolCalls);
      }

      // Record tool results in context so they're available for the next stream round
      for (const tr of toolResults) {
        await this.contextManager.recordToolCall(sessionId, {
          id: tr.id,
          name: tr.name,
          arguments: tr.args,
          result: tr.result,
          timestamp: Date.now(),
        });
      }

      // Yield tool results as synthetic text events for the caller
      for (const tr of toolResults) {
        yield {
          type: "text" as const,
          delta: `\n[Tool: ${tr.name}] ${tr.result.slice(0, 500)}${tr.result.length > 500 ? "..." : ""}\n`,
        };
      }

      // Continue the loop — next iteration will stream with tool results in context
    }
    } finally {
      try {
        if (cancelHandler) {
          const ws = getWsGateway();
          ws.off("cancel", cancelHandler);
        }
      } catch { /* ignore */ }

      if (abortController.signal.aborted) {
        try {
          const ws = getWsGateway();
          ws.pushStreamEnd(session.agentId, sessionId, "cancelled");
        } catch { /* WS not available */ }
      } else {
        try {
          const ws = getWsGateway();
          ws.pushStreamEnd(session.agentId, sessionId, "stop");
        } catch { /* WS not available */ }
      }
    }
  }
}

// Singleton
let runtime: NativeAgentRuntime | null = null;

export function getNativeRuntime(): NativeAgentRuntime {
  if (!runtime) {
    let config: Partial<NativeAgentRuntimeConfig> = {};
    try {
      const fullConfig = loadConfig();
      if (fullConfig.llm) {
        config = {
          llm: {
            provider: fullConfig.llm.provider as LLMConfig["provider"],
            baseUrl: fullConfig.llm.baseUrl,
            apiKey: fullConfig.llm.apiKey,
            model: fullConfig.llm.model,
            maxTokens: fullConfig.llm.maxTokens,
            temperature: fullConfig.llm.temperature,
            contextTokens: fullConfig.llm.contextTokens,
            timeoutMs: fullConfig.llm.timeoutMs,
          },
        };
      }
      if (fullConfig.context) {
        config.maxMessages = fullConfig.context.maxMessages;
        config.maxContextTokens = fullConfig.context.maxContextTokens;
      }
      if (fullConfig.agents) {
        config.llm = config.llm || { provider: "qwen-proxy", model: "coder-model" };
        (config.llm as LLMConfig).maxToolRounds = fullConfig.agents.maxToolRounds;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to load full config — using partial/defaults");
    }

    runtime = new NativeAgentRuntime(config);
  }
  return runtime;
}

export function initNativeRuntime(config?: Partial<NativeAgentRuntimeConfig>): NativeAgentRuntime {
  runtime = new NativeAgentRuntime(config);
  return runtime;
}
