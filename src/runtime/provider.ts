// Provider Abstraction — Decouples LLM client from OpenAI SDK
// Supports SSE streaming and prompt cache tracking

import { createHash } from "crypto";

// ── Interfaces ───────────────────────────────────────────────────────

export interface CompletionMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}

export interface CompletionRequest {
  model: string;
  messages: CompletionMessage[];
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

export interface CompletionResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  promptCache?: PromptCacheInfo;
}

export interface PromptCacheInfo {
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHit: boolean;
  unexpectedBreak: boolean;
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_use"; id: string; name: string; input: string }
  | { type: "usage"; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }
  | { type: "prompt_cache"; info: PromptCacheInfo }
  | { type: "done" };

export interface LLMProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncIterable<StreamEvent>;
}

// ── Prompt Cache Tracker ─────────────────────────────────────────────

export class PromptCacheTracker {
  private static readonly MAX_ENTRIES = 100;
  private cache: Map<string, number> = new Map();

  /**
   * Record cache read tokens for a given prompt fingerprint.
   */
  record(promptFingerprint: string, cacheRead: number): void {
    if (this.cache.size >= PromptCacheTracker.MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(promptFingerprint, cacheRead);
  }

  /**
   * Check if cache broke unexpectedly compared to the prior call.
   * Returns whether the break was unexpected and how many tokens dropped.
   */
  check(
    promptFingerprint: string,
    currentCacheRead: number,
  ): { unexpected: boolean; tokenDrop: number } {
    const lastCacheRead = this.cache.get(promptFingerprint);
    if (lastCacheRead === undefined) {
      return { unexpected: false, tokenDrop: 0 };
    }

    const tokenDrop = lastCacheRead - currentCacheRead;
    const unexpected = currentCacheRead < lastCacheRead;
    return { unexpected, tokenDrop };
  }

  /**
   * Get stats about tracked fingerprints.
   */
  getStats(): { totalFingerprints: number } {
    return { totalFingerprints: this.cache.size };
  }

  /**
   * Clear all cached fingerprints.
   */
  clear(): void {
    this.cache.clear();
  }
}

// ── Utility: Create prompt fingerprint ───────────────────────────────

/**
 * Create a fingerprint from the system prompt + first N messages.
 * Used to detect when the prompt context changed enough to break cache.
 */
export function createPromptFingerprint(
  messages: Array<{ role: string; content: string | null }>,
  messageCount: number = 3,
): string {
  const relevant = messages.slice(0, messageCount);
  const raw = relevant.map((m) => `${m.role}:${m.content ?? ""}`).join("\n");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

// ── SSE Parser ───────────────────────────────────────────────────────

/**
 * Parse an SSE chunk into { event, data } or null if incomplete.
 * Handles "data: " prefixed lines and multi-line data.
 */
function parseSSEChunk(rawChunk: string): Array<{ event?: string; data: string }> {
  const results: Array<{ event?: string; data: string }> = [];
  const lines = rawChunk.split("\n");

  let currentEvent: string | undefined;
  let currentData = "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "" || trimmed === "data: [DONE]") {
      if (currentData) {
        results.push({ event: currentEvent, data: currentData });
        currentData = "";
        currentEvent = undefined;
      }
      if (trimmed === "data: [DONE]") {
        // Signal end of stream
        results.push({ event: "done", data: "[DONE]" });
      }
      continue;
    }

    if (trimmed.startsWith("event:")) {
      currentEvent = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("data:")) {
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        if (currentData) {
          results.push({ event: currentEvent, data: currentData });
          currentData = "";
        }
        results.push({ event: "done", data: "[DONE]" });
      } else {
        currentData += (currentData ? "\n" : "") + data;
      }
    }
  }

  // Flush remaining data
  if (currentData) {
    results.push({ event: currentEvent, data: currentData });
  }

  return results;
}

// ── OpenAI-Compatible Provider ───────────────────────────────────────

export class OpenAICompatibleProvider implements LLMProvider {
  private baseUrl: string;
  private apiKey: string;
  private lastCacheRead: number | null = null;

  constructor(baseUrl: string, apiKey: string) {
    // Normalize baseUrl: remove trailing /v1 if present, we'll add it
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  private get apiUrl(): string {
    return `${this.baseUrl}/v1/chat/completions`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private buildBody(request: CompletionRequest, streaming: boolean): Record<string, unknown> {
    const messages = request.messages.map(m => {
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        if (!m.content || m.content.trim().length === 0) {
          return { ...m, content: null };
        }
      }
      return m;
    });

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: streaming,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }

    return body;
  }

  private extractCacheInfo(usage: Record<string, unknown> | undefined): PromptCacheInfo | undefined {
    if (!usage) return undefined;

    const cacheReadTokens = (usage["cache_read_input_tokens"] as number) ?? 0;
    const cacheCreationTokens = (usage["cache_creation_input_tokens"] as number) ?? 0;
    const promptTokens = (usage["prompt_tokens"] as number) ?? 0;

    const cacheHit = cacheReadTokens > 0;

    let unexpectedBreak = false;
    if (this.lastCacheRead !== null) {
      // Cache broke if we previously had cached tokens but now have fewer
      unexpectedBreak = cacheReadTokens < this.lastCacheRead;
    }
    this.lastCacheRead = cacheReadTokens;

    return {
      cacheReadTokens,
      cacheCreationTokens,
      cacheHit,
      unexpectedBreak,
    };
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildBody(request, false);

    const controller = request.abortSignal ? undefined : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), 120_000) : undefined;
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: request.abortSignal ?? controller?.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
      if (!choice) {
        throw new Error("No response from LLM");
      }

      const message = choice.message as Record<string, unknown> | undefined;
      const content = (message?.content as string) ?? "";

      let toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined;
      const rawToolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined;
      if (rawToolCalls) {
        toolCalls = rawToolCalls.map((tc) => ({
          id: tc.id as string,
          name: (tc.function as Record<string, unknown>).name as string,
          arguments: (tc.function as Record<string, unknown>).arguments as string,
        }));
      }

      const usage = data.usage as Record<string, unknown> | undefined;
      const promptCache = this.extractCacheInfo(usage);

      let usageOut: CompletionResponse["usage"] | undefined;
      if (usage) {
        usageOut = {
          prompt_tokens: (usage["prompt_tokens"] as number) ?? 0,
          completion_tokens: (usage["completion_tokens"] as number) ?? 0,
          total_tokens: (usage["total_tokens"] as number) ?? 0,
        };
      }

      return { content, toolCalls, usage: usageOut, promptCache };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    const body = this.buildBody(request, true);

    const controller = request.abortSignal ? undefined : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), 120_000) : undefined;
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          ...this.buildHeaders(),
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: request.abortSignal ?? controller?.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null — streaming not supported");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages from buffer
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() || ""; // Keep incomplete chunk in buffer

          for (const chunk of chunks) {
            const parsed = parseSSEChunk(chunk);
            for (const { event, data } of parsed) {
              if (event === "done" || data === "[DONE]") {
                yield { type: "done" };
                return;
              }

              let parsedData: Record<string, unknown>;
              try {
                parsedData = JSON.parse(data);
              } catch {
                continue; // Skip malformed JSON
              }

              // Extract delta text
              const delta = (parsedData.choices as Array<Record<string, unknown>> | undefined)?.[0]
                ?.delta as Record<string, unknown> | undefined;

              if (delta) {
                // Text content
                if (typeof delta.content === "string" && delta.content.length > 0) {
                  yield { type: "text", delta: delta.content };
                }

                // Tool use
                const toolCallDelta = (delta.tool_calls as Array<Record<string, unknown>> | undefined)?.[0];
                if (toolCallDelta) {
                  const id = (toolCallDelta.id as string) ?? "";
                  const funcInfo = toolCallDelta.function as Record<string, unknown> | undefined;
                  if (funcInfo) {
                    const name = (funcInfo.name as string) ?? "";
                    const input = (funcInfo.arguments as string) ?? "";
                    if (name || input) {
                      yield { type: "tool_use", id, name, input };
                    }
                  }
                }

                // Usage (typically in the last chunk)
                if (parsedData.usage) {
                  const usage = parsedData.usage as Record<string, unknown>;
                  yield {
                    type: "usage",
                    usage: {
                      prompt_tokens: (usage["prompt_tokens"] as number) ?? 0,
                      completion_tokens: (usage["completion_tokens"] as number) ?? 0,
                      total_tokens: (usage["total_tokens"] as number) ?? 0,
                    },
                  };

                  const cacheInfo = this.extractCacheInfo(usage);
                  if (cacheInfo) {
                    yield { type: "prompt_cache", info: cacheInfo };
                  }
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { type: "done" };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
