// Model Fallback Chain Resolver — failover-policy pattern
// When the primary model fails after retries, automatically falls back to configured secondary models.
// Imported by native-agent-runtime.ts for LLM provider resilience.
//
// OpenClaw failover pattern: actions include continue_normal, fallback_model, surface_error, return_error_payload.

// ── Types ──────────────────────────────────────────────────────────

export type FailoverReason =
  | "timeout"
  | "model_not_found"
  | "rate_limit"
  | "api_error"
  | "context_overflow"
  | "auth_error"
  | "billing_error"
  | "unknown";

export interface ModelEntry {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  contextTokens?: number;
  maxTokens?: number;
}

export interface FailoverState {
  currentIndex: number;
  chain: ModelEntry[];
  lastError?: Error;
  lastReason?: FailoverReason;
  attemptCount: number;
}

// ── Chain Creation ─────────────────────────────────────────────────

/**
 * Creates a failover chain from a list of model entries.
 * The first entry is the primary model; subsequent entries are fallbacks.
 * @throws Error if models array is empty
 */
export function createFailoverChain(models: ModelEntry[]): FailoverState {
  if (models.length === 0) {
    throw new Error("Failover chain requires at least one model entry");
  }
  return {
    currentIndex: 0,
    chain: [...models],
    attemptCount: 0,
  };
}

// ── Model Selection ────────────────────────────────────────────────

/**
 * Returns the currently active model from the failover chain.
 */
export function getCurrentModel(state: FailoverState): ModelEntry {
  return state.chain[state.currentIndex];
}

// ── Failover Decision ──────────────────────────────────────────────

/**
 * Classifies an error into a FailoverReason.
 * Maps error messages, status codes, and error codes to semantic categories.
 */
export function classifyFailoverReason(err: unknown): FailoverReason {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    const name = err.name.toLowerCase();

    // Context overflow — the same error will happen on any fallback model
    if (
      message.includes("context length") ||
      message.includes("context_overflow") ||
      message.includes("token limit") ||
      message.includes("max tokens exceeded") ||
      message.includes("input length") ||
      message.includes("too many tokens") ||
      message.includes("prompt too long")
    ) {
      return "context_overflow";
    }

    // Model not found — different model might exist on another provider
    if (
      message.includes("model not found") ||
      message.includes("model_does_not_exist") ||
      message.includes("invalid model") ||
      message.includes("unknown model") ||
      message.includes("no such model") ||
      message.includes("model is not") ||
      (message.includes("404") && message.includes("model"))
    ) {
      return "model_not_found";
    }

    // Rate limiting
    if (
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("429") ||
      message.includes("quota exceeded") ||
      message.includes("throttl")
    ) {
      return "rate_limit";
    }

    // Timeout
    if (
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("etimedout") ||
      message.includes("econnaborted") ||
      message.includes("deadline exceeded") ||
      name.includes("timeout") ||
      message.includes("abort")
    ) {
      return "timeout";
    }

    // Generic API errors (5xx, connection failures)
    if (
      (message.includes("5") && /status\s*code|http\s*\d+|server\s+error/i.test(message)) ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("enotfound") ||
      message.includes("internal server error") ||
      message.includes("bad gateway") ||
      message.includes("service unavailable") ||
      message.includes("gateway timeout")
    ) {
      return "api_error";
    }

    // Check status on Error objects that carry HTTP status (e.g. OpenAI APIError)
    if ("status" in err && typeof (err as Record<string, unknown>).status === "number") {
      const status = (err as Record<string, unknown>).status as number;
      if (status >= 500) return "api_error";
      if (status === 429) return "rate_limit";
      if (status === 404) return "model_not_found";
    }
  }

  // Check for status-based classification on non-Error objects
  if (err !== null && typeof err === "object") {
    const maybeErr = err as { status?: number; code?: string };
    if (maybeErr.status === 429) return "rate_limit";
    if (maybeErr.status === 404) return "model_not_found";
    if (maybeErr.status !== undefined && maybeErr.status >= 500) return "api_error";
    if (maybeErr.code === "ETIMEDOUT" || maybeErr.code === "ECONNABORTED") return "timeout";
  }

  return "unknown";
}

/**
 * Analyzes an error to decide if failover is warranted.
 *
 * Retryable errors that warrant failover: timeout, rate_limit, api_error, model_not_found
 * Non-failover errors: context_overflow — failover won't help since the same error will
 * occur regardless of which model is used (input is too large for any model).
 */
export function shouldFailover(err: unknown): { should: boolean; reason: FailoverReason } {
  const reason = classifyFailoverReason(err);

  // context_overflow should NOT trigger failover — the same error will happen
  // on the fallback model because the problem is with the input size, not the provider
  if (reason === "context_overflow") {
    return { should: false, reason };
  }

  // All other reasons warrant attempting a failover
  return { should: true, reason };
}

// ── Failover Execution ─────────────────────────────────────────────

/**
 * Advances the failover chain to the next model.
 * Returns the new current model, or null if the chain is exhausted.
 * Records the error and reason on the state for debugging.
 */
export function failoverToNext(
  state: FailoverState,
  err?: Error,
  reason?: FailoverReason,
): ModelEntry | null {
  if (err !== undefined) {
    state.lastError = err;
  }
  if (reason !== undefined) {
    state.lastReason = reason;
  }

  state.attemptCount++;

  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.chain.length) {
    // Chain exhausted
    return null;
  }

  state.currentIndex = nextIndex;
  return state.chain[state.currentIndex];
}

/**
 * Resets the failover chain back to the primary model (index 0).
 * Clears lastError and lastReason for a fresh start.
 */
export function resetFailover(state: FailoverState): void {
  state.currentIndex = 0;
  state.lastError = undefined;
  state.lastReason = undefined;
  state.attemptCount = 0;
}

// ── Auth Profile Rotation & Billing Backoff ──────────────────────────

/** Minimum backoff for billing errors: 1 hour */
const BILLING_BACKOFF_MIN_MS = 60 * 60 * 1000;

/** Maximum backoff for billing errors: 24 hours */
const BILLING_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

/** Backoff state for a single provider/model combination */
export interface BillingBackoffState {
  /** When the cooldown expires (ms timestamp). 0 = no active cooldown. */
  cooldownUntil: number;
  /** Number of consecutive billing errors (used for exponential backoff). */
  consecutiveErrors: number;
  /** Last billing error message for debugging. */
  lastError?: string;
}

/** Registry of billing backoff states keyed by provider+model */
export type BillingBackoffRegistry = Map<string, BillingBackoffState>;

/**
 * Create a backoff registry. Call once at startup.
 */
export function createBillingBackoffRegistry(): BillingBackoffRegistry {
  return new Map<string, BillingBackoffState>();
}

/**
 * Get or create the backoff state for a provider+model key.
 */
function getBackoffState(registry: BillingBackoffRegistry, key: string): BillingBackoffState {
  const existing = registry.get(key);
  if (existing) return existing;
  const state: BillingBackoffState = { cooldownUntil: 0, consecutiveErrors: 0 };
  registry.set(key, state);
  return state;
}

/**
 * Check if a provider/model is currently in billing cooldown.
 * Returns the remaining ms until cooldown expires, or 0 if available.
 */
export function getBillingBackoffRemainingMs(
  registry: BillingBackoffRegistry,
  provider: string,
  model: string,
): number {
  const key = `${provider}:${model}`;
  const state = registry.get(key);
  if (!state || state.cooldownUntil === 0) return 0;
  const remaining = state.cooldownUntil - Date.now();
  if (remaining <= 0) {
    // Cooldown expired — reset
    state.cooldownUntil = 0;
    state.consecutiveErrors = Math.max(0, state.consecutiveErrors - 1);
    return 0;
  }
  return remaining;
}

/**
 * Record a billing error and compute the backoff duration.
 * Uses exponential backoff: 1h, 2h, 4h, 8h, capped at 24h.
 */
export function recordBillingError(
  registry: BillingBackoffRegistry,
  provider: string,
  model: string,
  errorMessage: string,
): { cooldownMs: number; backoffUntil: number } {
  const key = `${provider}:${model}`;
  const state = getBackoffState(registry, key);
  state.consecutiveErrors++;
  state.lastError = errorMessage;

  // Exponential backoff: 1h * 2^(n-1), capped at 24h
  const backoffMs = Math.min(
    BILLING_BACKOFF_MIN_MS * Math.pow(2, state.consecutiveErrors - 1),
    BILLING_BACKOFF_MAX_MS,
  );

  state.cooldownUntil = Date.now() + backoffMs;

  return { cooldownMs: backoffMs, backoffUntil: state.cooldownUntil };
}

/**
 * Clear billing backoff for a provider/model (called on successful request).
 */
export function clearBillingBackoff(
  registry: BillingBackoffRegistry,
  provider: string,
  model: string,
): void {
  const key = `${provider}:${model}`;
  const state = registry.get(key);
  if (state) {
    state.cooldownUntil = 0;
    state.consecutiveErrors = 0;
    state.lastError = undefined;
  }
}

/**
 * Classify whether an error is a billing-related error.
 * Detects: 402 status, "insufficient funds", "billing", "payment", "credit", etc.
 */
export function isBillingError(err: unknown): boolean {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (
      message.includes("insufficient") ||
      message.includes("billing") ||
      message.includes("payment") ||
      message.includes("credit") ||
      message.includes("subscription") ||
      message.includes("account balance") ||
      message.includes("top up") ||
      message.includes("quota exceeded") ||
      message.includes("usage limit") ||
      message.includes("spending limit")
    ) {
      return true;
    }
    // OpenAI APIError with status 402
    if ("status" in err && (err as Record<string, unknown>).status === 402) return true;
  }
  if (err !== null && typeof err === "object") {
    const maybeErr = err as { status?: number; code?: string; message?: string };
    if (maybeErr.status === 402) return true;
    if (maybeErr.code === "billing_error" || maybeErr.code === "insufficient_funds") return true;
    if (maybeErr.message && /insufficient|billing|payment|credit|subscription/i.test(maybeErr.message)) return true;
  }
  return false;
}

/**
 * Classify whether an error is an auth-related error (401/403).
 */
export function isAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (
      message.includes("unauthorized") ||
      message.includes("invalid api key") ||
      message.includes("invalid_api_key") ||
      message.includes("authentication") ||
      message.includes("access denied") ||
      message.includes("forbidden") ||
      message.includes("permission denied") ||
      message.includes("api key not valid")
    ) {
      return true;
    }
    if ("status" in err) {
      const status = (err as Record<string, unknown>).status as number | undefined;
      if (status === 401 || status === 403) return true;
    }
  }
  if (err !== null && typeof err === "object") {
    const maybeErr = err as { status?: number; code?: string };
    if (maybeErr.status === 401 || maybeErr.status === 403) return true;
    if (maybeErr.code === "invalid_api_key" || maybeErr.code === "authentication_error") return true;
  }
  return false;
}

/**
 * Enhanced shouldFailover that includes auth/billing classification.
 * - billing_error: do NOT failover (back off instead, same provider has billing issue)
 * - auth_error: DO failover if there are alternate auth profiles in the chain
 */
export function shouldFailoverWithAuthAndBilling(
  err: unknown,
): { should: boolean; reason: FailoverReason; skipFailover: boolean } {
  // Check billing first
  if (isBillingError(err)) {
    return { should: false, reason: "billing_error", skipFailover: true };
  }

  // Check auth errors
  if (isAuthError(err)) {
    return { should: true, reason: "auth_error", skipFailover: false };
  }

  // Use existing logic for other errors
  const { should, reason } = shouldFailover(err);
  return { should, reason, skipFailover: !should };
}
