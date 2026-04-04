// Native Agent Runtime — Core LLM execution loop with tool calling
// Replaces OpenCode HTTP client with direct LLM API calls
// Supports OpenAI-compatible APIs with model fallback chains

import OpenAI from "openai";
import { logger } from "../logger.js";
import { buildSystemPrompt, isSilentAck, stripHeartbeatToken, hasSubstantiveFinding, currentTimeLine } from "./prompt-builder.js";
import { ContextManager, type ChatMessage, type ToolCall, estimateTokens, type SummarizeFn, type PersistCallbacks } from "./context-manager.js";
import { buildToolDefinitions, createToolBridge, type ToolExecutor, type ToolResult } from "./tool-bridge.js";
import { v4 as uuidv4 } from "uuid";
import { retryAsync, isRetryableError, type RetryOptions } from "./retry.js";
import {
  createFailoverChain,
  getCurrentModel,
  shouldFailover,
  failoverToNext,
  resetFailover,
  type FailoverState,
  type ModelEntry,
} from "./model-fallback.js";
import { loadConfig } from "../config/loader.js";
import { OpenAICompatibleProvider, PromptCacheTracker, createPromptFingerprint, type StreamEvent } from "./provider.js";

// SessionRegistry-compatible interface for persistence wiring
export interface SessionPersistence {
  saveMessages: (sessionId: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string; tokenEstimate: number; isSummary?: boolean; compacted?: boolean; timestamp: number }>) => void;
  saveToolCalls: (sessionId: string, toolCalls: Array<{ id: string; name: string; arguments: string; result?: string; tokenEstimate?: number; compacted?: boolean; timestamp: number }>) => void;
  loadSessionData: (sessionId: string) => { messages: Array<{ role: string; content: string; tokenEstimate: number; isSummary: boolean; compacted: boolean; timestamp: number }>; toolCalls: Array<{ id: string; name: string; arguments: string; result?: string; tokenEstimate: number; compacted: boolean; timestamp: number }>; metadata: { compactionCount: number; previousSummary?: string; hasRealConversation: boolean } | null } | null;
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
  private agentToolScope: Map<string, string[]> = new Map();
  private agentSessions = new Map<string, string>();
  private failoverState: FailoverState | null = null;

  constructor(config?: Partial<NativeAgentRuntimeConfig>) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };
    this.contextManager = new ContextManager({
      maxMessages: this.config.maxMessages,
      maxContextTokens: this.config.maxContextTokens,
      modelContextTokens: this.config.llm.contextTokens,
    });

    this.failoverState = this.buildFailoverChain();
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
      contextTokens: this.config.llm.contextTokens || this.config.maxContextTokens,
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
    } catch {
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

  setToolExecutor(executor: ToolExecutor, toolNames: string[]) {
    this.toolExecutor = executor;
    this.toolDefinitions = buildToolDefinitions(toolNames);
    logger.info({ toolCount: toolNames.length }, "Tool executor configured");
  }

  setAgentToolScope(agentId: string, toolNames: string[]) {
    this.agentToolScope.set(agentId, toolNames);
  }

  private getScopedToolDefinitions(agentId: string | undefined): ReturnType<typeof buildToolDefinitions> {
    if (!agentId) return this.toolDefinitions;
    const scoped = this.agentToolScope.get(agentId);
    if (!scoped || scoped.length === 0) return this.toolDefinitions;
    return buildToolDefinitions(scoped);
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
          messages: data.messages.map(m => ({ ...m, role: m.role as "system" | "user" | "assistant" })),
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

  getOrCreateRuntimeSession(agentId: string, options?: {
    memoryInjection?: string;
    mode?: "full" | "heartbeat" | "message" | "minimal";
  }): string {
    const existing = this.agentSessions.get(agentId);
    if (existing) {
      const session = this.contextManager.getSession(existing);
      if (session) return existing;
    }
    const sessionId = this.createSession(agentId, options);
    this.agentSessions.set(agentId, sessionId);
    return sessionId;
  }

  async sendMessage(sessionId: string, message: string, agentId?: string): Promise<AgentExecutionResult> {
    const session = this.contextManager.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Always use session's agentId — ignore caller-provided agentId to prevent spoofing
    this.contextManager.addUserMessage(sessionId, message);

    let toolCallsExecuted = 0;
    let finalText = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalReasoningTokens = 0;

    for (let round = 0; round < (this.config.llm.maxToolRounds || 10); round++) {
      const messages = this.contextManager.getMessagesForLLM(sessionId);

      const response = await this.callLLMWithRetry(messages, undefined, session.agentId);

      if (response.usage) {
        totalInputTokens += response.usage.prompt_tokens || 0;
        totalOutputTokens += response.usage.completion_tokens || 0;
        totalReasoningTokens += ((response.usage as Record<string, unknown>)["completion_tokens_details"] as Record<string, unknown> | undefined)?.["reasoning_tokens"] as number | undefined || 0;
      }

      const textContent = response.content
        .filter(c => c.type === "text")
        .map(c => c.text)
        .join("\n");

      if (response.toolCalls && response.toolCalls.length > 0 && this.toolExecutor) {
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
          const result = await this.toolExecutor(tc.function.name, args);

          if (!(args as Record<string, unknown>)["agent_id"]) {
            (args as Record<string, unknown>)["agent_id"] = session.agentId;
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
          this.contextManager.recordToolCall(sessionId, {
            id: tr.id,
            name: tr.name,
            arguments: tr.args,
            result: tr.result,
            timestamp: Date.now(),
          });
        }

        continue;
      }

      finalText = textContent;
      break;
    }

    if (finalText) {
      this.contextManager.addAssistantMessage(sessionId, finalText);
    }

    const silentAck = isSilentAck(finalText);
    const substantive = hasSubstantiveFinding(finalText);

    logger.info({
      sessionId,
      agentId: session.agentId,
      silentAck,
      substantive,
      toolCalls: toolCallsExecuted,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    }, "Agent response complete");

    return {
      sessionId,
      text: finalText,
      tokens: {
        total: totalInputTokens + totalOutputTokens,
        input: totalInputTokens,
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

  compactSession(sessionId: string, keepRecent?: number): void {
    this.contextManager.compact(sessionId, keepRecent);
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

  // ── Compaction Summarization ─────────────────────────────────────────

  /**
   * Summarization callback for ContextManager compaction.
   * Uses the LLM to summarize old messages into a structured summary.
   */
  private async compactionSummarizeFn(
    messages: ChatMessage[],
    previousSummary?: string,
    customInstructions?: string,
  ): Promise<string> {
    const promptParts: string[] = [
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
      promptParts.unshift(`## Previous Summary\n${previousSummary}\n`);
      promptParts.unshift("Build on the previous summary. Update it with new information from the messages below.\n");
    }

    if (customInstructions) {
      promptParts.push("");
      promptParts.push(customInstructions);
    }

    const messageText = messages
      .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
      .join("\n\n");

    promptParts.push("\n---\n## Conversation to Summarize\n");
    promptParts.push(messageText);

    const summaryMessages: ChatMessage[] = [
      { role: "system", content: "You are a conversation summarizer. Provide structured summaries for agent continuation.", timestamp: Date.now() },
      { role: "user", content: promptParts.join("\n"), timestamp: Date.now() },
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
    } catch {
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
    this.updateClientForModel();

    try {
      const result = await this.callLLM(messages, options, agentId);
      resetFailover(this.failoverState);
      return result;
    } catch (err: unknown) {
      const { should: shouldFail, reason } = shouldFailover(err);

      if (!shouldFail) {
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
        "Model failover — switching to fallback",
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

    const llmMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

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

    let timeoutMs = 120000;
    try {
      const fullConfig = loadConfig();
      timeoutMs = fullConfig.llm?.timeoutMs ?? this.config.llm.timeoutMs ?? 120000;
    } catch {
      timeoutMs = this.config.llm.timeoutMs ?? 120000;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
    const messages = this.contextManager.getMessagesForLLM(sessionId);

    const currentModel = this.failoverState ? getCurrentModel(this.failoverState) : null;
    const model = currentModel?.model ?? this.config.llm.model;

    const llmMessages = messages.map(m => ({ role: m.role, content: m.content }));
    const fingerprint = createPromptFingerprint(llmMessages);

    const tools = this.getScopedToolDefinitions(agentId);
    const toolDefs = tools.length > 0
      ? tools.map(t => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;

    let timeoutMs = this.config.llm.timeoutMs ?? 120000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      for await (const event of this.provider.stream({
        model,
        messages: llmMessages,
        tools: toolDefs,
        temperature: this.config.llm.temperature,
        maxTokens: this.config.llm.maxTokens,
        abortSignal: controller.signal,
      })) {
        if (event.type === "usage" && this.promptCacheTracker) {
          const cacheRead = (event.usage as Record<string, unknown>)?.["cache_read_input_tokens"] as number | undefined;
          if (cacheRead !== undefined) {
            this.promptCacheTracker.record(fingerprint, cacheRead);
          }
        }
        yield event;
      }
    } finally {
      clearTimeout(timeoutId);
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
    } catch {
    }

    runtime = new NativeAgentRuntime(config);
  }
  return runtime;
}

export function initNativeRuntime(config?: Partial<NativeAgentRuntimeConfig>): NativeAgentRuntime {
  runtime = new NativeAgentRuntime(config);
  return runtime;
}
