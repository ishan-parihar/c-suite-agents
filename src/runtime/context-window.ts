// Context Window Resolution — Model-aware context limits
// Replaces hardcoded 128K limit with per-model configuration

import { logger } from "../logger";

// ── Types ──────────────────────────────────────────────────────────────

export interface ContextWindowInfo {
  model: string;
  contextTokens: number;
  effectiveLimit: number;
  warningThreshold: number;
  blockedThreshold: number;
}

// ── Known Model Context Windows ────────────────────────────────────────

const KNOWN_MODEL_CONTEXT: Record<string, number> = {
  // Anthropic
  "claude-opus": 200_000,
  "claude-opus-4": 200_000,
  "claude-opus-4-20250514": 200_000,
  "claude-sonnet": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-sonnet-4-20250514": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-7-sonnet": 200_000,
  "claude-3-7-sonnet-20250219": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-sonnet-3-5": 200_000,

  // OpenAI
  "gpt-4": 128_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4-turbo-preview": 128_000,
  "gpt-4-0125-preview": 128_000,
  "gpt-4-1106-preview": 128_000,
  "gpt-3.5-turbo": 16_385,
  "gpt-3.5-turbo-0125": 16_385,
  "o1": 200_000,
  "o1-mini": 128_000,
  "o3": 200_000,
  "o3-mini": 200_000,
  "o4-mini": 200_000,

  // Qwen
  "qwen3-coder-plus": 262_144,
  "qwen3-coder": 262_144,
  "qwen3-235b-a22b": 131_072,
  "qwen3-30b-a3b": 131_072,
  "qwen3-32b": 131_072,
  "qwen2.5-coder": 131_072,
  "qwen2.5-coder-32b": 131_072,
  "coder-model": 262_144,

  // Llama
  "llama3.1:8b": 8_192,
  "llama3.1:70b": 131_072,
  "llama3.1:405b": 131_072,
  "llama3.2:1b": 8_192,
  "llama3.2:3b": 8_192,
  "llama3.3:70b": 131_072,
  "llama-3.1-8b": 8_192,
  "llama-3.1-70b": 131_072,
  "llama-3.1-405b": 131_072,
  "llama-3.3-70b": 131_072,

  // Mistral
  "mistral-large": 128_000,
  "mistral-small": 32_000,
  "mistral-nemo": 128_000,
  "mixtral-8x7b": 32_000,
  "mixtral-8x22b": 64_000,

  // DeepSeek
  "deepseek-chat": 128_000,
  "deepseek-coder": 128_000,
  "deepseek-reasoner": 64_000,

  // Gemini
  "gemini-2.0-flash": 1_048_576,
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-1.5-pro": 2_097_152,
  "gemini-1.5-flash": 1_048_576,
};

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_CONTEXT_TOKENS = 128_000;
const WARNING_THRESHOLD = 32_000;
const BLOCKED_THRESHOLD = 16_000;

// ── Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve context window info for a given model.
 *
 * Lookup order:
 *   1. Exact match in known models map
 *   2. Configured tokens override (if provided)
 *   3. Default fallback (128K)
 *
 * Throws if the resolved context is below 16K.
 * Warns if below 32K.
 */
export function resolveContextWindowInfo(
  model: string,
  configuredTokens?: number,
): ContextWindowInfo {
  const knownContext = lookupModelContext(model);

  const contextTokens = configuredTokens ?? knownContext ?? DEFAULT_CONTEXT_TOKENS;

  if (contextTokens < BLOCKED_THRESHOLD) {
    throw new Error(
      `Model "${model}" has a context window of ${contextTokens.toLocaleString()} tokens, which is below the minimum required ${BLOCKED_THRESHOLD.toLocaleString()} tokens. ` +
      `Please use a model with at least ${BLOCKED_THRESHOLD.toLocaleString()} context tokens, or configure a higher contextTokens value.`,
    );
  }

  if (contextTokens < WARNING_THRESHOLD) {
    logger.warn(
      { model, contextTokens, threshold: WARNING_THRESHOLD },
      `Context window (${contextTokens.toLocaleString()} tokens) is below ${WARNING_THRESHOLD.toLocaleString()} — sessions will be constrained`,
    );
  }

  return {
    model,
    contextTokens,
    effectiveLimit: contextTokens,
    warningThreshold: WARNING_THRESHOLD,
    blockedThreshold: BLOCKED_THRESHOLD,
  };
}

/**
 * Look up a model's context window in the known models map.
 * Tries exact match first, then prefix match for models with version suffixes.
 */
function lookupModelContext(model: string): number | undefined {
  // Exact match
  if (KNOWN_MODEL_CONTEXT[model] !== undefined) {
    return KNOWN_MODEL_CONTEXT[model];
  }

  const lower = model.toLowerCase();

  // Prefix match — handles models like "gpt-4o-2024-05-13" or "claude-3-sonnet-20240229"
  for (const [prefix, ctx] of Object.entries(KNOWN_MODEL_CONTEXT)) {
    if (lower.startsWith(prefix) || lower.includes(prefix)) {
      return ctx;
    }
  }

  return undefined;
}
