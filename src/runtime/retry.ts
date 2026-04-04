/**
 * Standalone retry utility combining exponential backoff with jitter.
 * Designed for LLM API calls with configurable retry predicates,
 * Retry-After header support, and observability hooks.
 *
 * Import pattern: `import { retryAsync, isRetryableError } from "./retry.js"`
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Base configuration for retry behaviour. */
export interface RetryConfig {
  /** Maximum number of attempts (min 1). Default: 3. */
  attempts: number;
  /** Minimum delay between attempts in ms. Default: 2000. */
  minDelayMs: number;
  /** Maximum delay cap in ms. Default: 30_000. */
  maxDelayMs: number;
  /** Jitter factor in range [0, 1]. 0.2 = ±20 %. Default: 0.2. */
  jitter: number;
}

/** Extended options for `retryAsync`. */
export interface RetryOptions extends RetryConfig {
  /** Human-readable label for logging / onRetry callbacks. */
  label?: string;

  /**
   * Custom predicate to decide whether an error is retryable.
   * Overrides the built-in `isRetryableError` when provided.
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean;

  /**
   * Extract a server-suggested wait time (ms) from the error.
   * Useful for parsing `retry-after-ms` / `retry-after` headers.
   * Return `undefined` to fall through to normal backoff.
   */
  retryAfterMs?: (err: unknown) => number | undefined;

  /** Callback fired before each retry attempt. */
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    err: unknown;
    label?: string;
  }) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  attempts: 3,
  minDelayMs: 2_000,
  maxDelayMs: 30_000,
  jitter: 0.2,
};

// ---------------------------------------------------------------------------
// Pure delay calculation
// ---------------------------------------------------------------------------

/**
 * Compute an exponential backoff delay with optional jitter.
 *
 * Formula:
 *   base = minDelayMs * 2^(attempt - 1)
 *   withJitter = base * (1 + (Math.random() * jitter * 2 - jitter))
 *   result = clamp(withJitter, minDelayMs, maxDelayMs)
 *
 * @param attempt  1-based attempt number.
 * @param minDelayMs Minimum delay in ms.
 * @param maxDelayMs Maximum delay cap in ms.
 * @param jitter  Jitter factor (0 = none, 0.2 = ±20 %, 1 = 0–200 %).
 * @returns Delay in ms, always finite and ≥ 0.
 */
export function computeBackoffDelay(
  attempt: number,
  minDelayMs: number,
  maxDelayMs: number,
  jitter: number,
): number {
  const exponent = attempt - 1;
  const base = minDelayMs * Math.pow(2, exponent);

  // Apply jitter: ±jitter fraction of base
  const jitterFactor = 1 + (Math.random() * jitter * 2 - jitter);
  const withJitter = base * jitterFactor;

  // Clamp to valid range
  const clamped = Math.max(minDelayMs, Math.min(maxDelayMs, withJitter));

  // Safety: guarantee finite, non-negative result
  if (!Number.isFinite(clamped) || clamped < 0) {
    return minDelayMs;
  }

  return clamped;
}

// ---------------------------------------------------------------------------
// Default retryable-error predicate
// ---------------------------------------------------------------------------

// HTTP status codes that indicate a retryable server-side issue.
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

// Node.js network error codes worth retrying.
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ENOTFOUND",
  "ECONNABORTED",
]);

/**
 * Default predicate that inspects an error and decides whether it is retryable.
 *
 * Returns **true** for:
 * - HTTP status ≥ 500 or === 429
 * - Network error codes: ECONNREFUSED, ETIMEDOUT, ECONNRESET, ENOTFOUND, ECONNABORTED
 * - Error messages containing "model" AND "loading" (LLM loading delay)
 * - Error messages containing "timed out"
 *
 * Returns **false** for:
 * - Messages containing "context length" (won't help to retry)
 * - Messages containing "invalid" (client-side input error)
 */
export function isRetryableError(err: unknown): boolean {
  const message = getErrorMessage(err);
  const lowerMessage = message.toLowerCase();

  // Short-circuit: explicitly non-retryable messages
  if (lowerMessage.includes("context length")) return false;
  if (lowerMessage.includes("invalid")) return false;

  // Check HTTP status code
  const statusCode = extractStatusCode(err);
  if (statusCode !== undefined) {
    return RETRYABLE_HTTP_STATUSES.has(statusCode);
  }

  // Check Node.js error code
  const code = extractErrorCode(err);
  if (code !== undefined && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  // Check message patterns
  if (lowerMessage.includes("model") && lowerMessage.includes("loading")) {
    return true;
  }
  if (lowerMessage.includes("timed out")) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main retry function
// ---------------------------------------------------------------------------

/**
 * Execute an async function with configurable retry logic.
 *
 * @param fn      Async function to execute (called fresh on each attempt).
 * @param options Retry configuration.
 * @returns The resolved value of `fn` on success.
 * @throws The last error after all attempts are exhausted.
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options };
  const maxAttempts = Math.max(1, config.attempts);
  const predicate = config.shouldRetry ?? isRetryableError;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // Last attempt — no point checking retryability
      if (attempt >= maxAttempts) break;

      // Check if error is retryable
      if (!predicate(err, attempt)) {
        throw err;
      }

      // Determine delay: honour Retry-After first, then backoff
      const retryAfter = config.retryAfterMs?.(err);
      const delayMs =
        retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter >= 0
          ? Math.min(retryAfter, config.maxDelayMs)
          : computeBackoffDelay(attempt, config.minDelayMs, config.maxDelayMs, config.jitter);

      // Fire callback
      config.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        err,
        label: config.label,
      });

      // Sleep
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastErr;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const msg = (err as Record<string, unknown>)["message"];
    if (typeof msg === "string") return msg;
    const body = (err as Record<string, unknown>)["body"];
    if (typeof body === "string") return body;
    if (typeof body === "object" && body !== null) {
      const msg2 = (body as Record<string, unknown>)["message"];
      if (typeof msg2 === "string") return msg2;
    }
  }
  return "";
}

function extractStatusCode(err: unknown): number | undefined {
  // Axios / fetch-like wrappers
  const direct = (err as Record<string, unknown>)["status"];
  if (typeof direct === "number") return direct;

  // Response-like objects nested in error
  const response = (err as Record<string, unknown>)["response"] as
    | Record<string, unknown>
    | undefined;
  if (response) {
    const s = response["status"];
    if (typeof s === "number") return s;
  }

  // statusCode (http.IncomingMessage style)
  const sc = (err as Record<string, unknown>)["statusCode"];
  if (typeof sc === "number") return sc;

  return undefined;
}

function extractErrorCode(err: unknown): string | undefined {
  const code = (err as Record<string, unknown>)["code"];
  if (typeof code === "string") return code;
  return undefined;
}
