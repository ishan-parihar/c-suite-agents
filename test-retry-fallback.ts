/**
 * Test suite for retry utility and model fallback chain subsystems.
 * Run with: bun run test-retry-fallback.ts
 *
 * No external test frameworks — pure assertion-based tests.
 * No `as any` type suppressions.
 * No actual LLM calls.
 */

import {
  retryAsync,
  isRetryableError,
  computeBackoffDelay,
} from "./src/runtime/retry.js";

import {
  createFailoverChain,
  getCurrentModel,
  failoverToNext,
  resetFailover,
  shouldFailover,
  classifyFailoverReason,
  type ModelEntry,
} from "./src/runtime/model-fallback.js";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  reason?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn: () => unknown, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

async function assertThrowsAsync(
  fn: () => Promise<unknown>,
  message: string,
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, reason });
  }
}

// ---------------------------------------------------------------------------
// RETRY TESTS
// ---------------------------------------------------------------------------

// 1. retryAsync succeeds on first try (no retries needed)
await test("retryAsync succeeds on first try (no retries needed)", async () => {
  let callCount = 0;
  const result = await retryAsync(async () => {
    callCount++;
    return "ok";
  }, { attempts: 3, minDelayMs: 1, maxDelayMs: 10, jitter: 0 });
  assert(callCount === 1, `Expected 1 call, got ${callCount}`);
  assert(result === "ok", `Expected "ok", got ${result}`);
});

// 2. retryAsync retries on transient error then succeeds
await test("retryAsync retries on transient error then succeeds", async () => {
  let callCount = 0;
  const result = await retryAsync(async () => {
    callCount++;
    if (callCount < 3) {
      const e = new Error("ECONNREFUSED");
      (e as unknown as Record<string, string>).code = "ECONNREFUSED";
      throw e;
    }
    return "recovered";
  }, { attempts: 5, minDelayMs: 1, maxDelayMs: 10, jitter: 0 });
  assert(callCount === 3, `Expected 3 calls, got ${callCount}`);
  assert(result === "recovered", `Expected "recovered", got ${result}`);
});

// 3. retryAsync exhausts retries and throws
await test("retryAsync exhausts retries and throws", async () => {
  let callCount = 0;
  await assertThrowsAsync(async () => {
    await retryAsync(async () => {
      callCount++;
      const e = new Error("ECONNREFUSED");
      (e as unknown as Record<string, string>).code = "ECONNREFUSED";
      throw e;
    }, { attempts: 3, minDelayMs: 1, maxDelayMs: 10, jitter: 0 });
  }, "Expected retryAsync to throw after exhausting retries");
  assert(callCount === 3, `Expected 3 calls, got ${callCount}`);
});

// 4. retryAsync respects shouldRetry predicate (non-retryable errors throw immediately)
await test("retryAsync respects shouldRetry predicate (non-retryable errors throw immediately)", async () => {
  let callCount = 0;
  await assertThrowsAsync(async () => {
    await retryAsync(async () => {
      callCount++;
      throw new Error("context length exceeded");
    }, {
      attempts: 5,
      minDelayMs: 1,
      maxDelayMs: 10,
      jitter: 0,
      shouldRetry: () => false,
    });
  }, "Expected immediate throw for non-retryable error");
  assert(callCount === 1, `Expected 1 call (no retries), got ${callCount}`);
});

// 5. retryAsync honours retryAfterMs callback
await test("retryAsync honours retryAfterMs callback", async () => {
  let onRetryCalled = false;
  let capturedDelay = 0;
  const startMs = Date.now();
  await assertThrowsAsync(async () => {
    await retryAsync(async () => {
      const e = new Error("rate limited");
      (e as unknown as Record<string, number>).status = 429;
      throw e;
    }, {
      attempts: 2,
      minDelayMs: 1,
      maxDelayMs: 100,
      jitter: 0,
      retryAfterMs: () => 50,
      onRetry: (info) => {
        onRetryCalled = true;
        capturedDelay = info.delayMs;
      },
    });
  }, "Expected throw after retry");
  assert(onRetryCalled, "onRetry should have been called");
  assert(capturedDelay === 50, `Expected delay 50ms from retryAfterMs, got ${capturedDelay}`);
  const elapsed = Date.now() - startMs;
  assert(elapsed >= 40, `Expected at least 40ms delay, elapsed ${elapsed}ms`);
});

// 6. retryAsync fires onRetry callback
await test("retryAsync fires onRetry callback", async () => {
  const retries: number[] = [];
  await assertThrowsAsync(async () => {
    await retryAsync(async () => {
      const e = new Error("ECONNREFUSED");
      (e as unknown as Record<string, string>).code = "ECONNREFUSED";
      throw e;
    }, {
      attempts: 3,
      minDelayMs: 1,
      maxDelayMs: 10,
      jitter: 0,
      onRetry: (info) => {
        retries.push(info.attempt);
      },
    });
  }, "Expected throw");
  assert(retries.length === 2, `Expected 2 onRetry calls, got ${retries.length}`);
  assert(retries[0] === 1, `First retry should be attempt 1, got ${retries[0]}`);
  assert(retries[1] === 2, `Second retry should be attempt 2, got ${retries[1]}`);
});

// 7. computeBackoffDelay produces exponential growth
await test("computeBackoffDelay produces exponential growth", () => {
  // Use jitter=0 to get deterministic results
  const d1 = computeBackoffDelay(1, 100, 10000, 0);
  const d2 = computeBackoffDelay(2, 100, 10000, 0);
  const d3 = computeBackoffDelay(3, 100, 10000, 0);

  // base = 100 * 2^(attempt-1), jitter=0 means no variance
  assert(d1 === 100, `Attempt 1: expected 100, got ${d1}`);
  assert(d2 === 200, `Attempt 2: expected 200, got ${d2}`);
  assert(d3 === 400, `Attempt 3: expected 400, got ${d3}`);
});

// 8. computeBackoffDelay applies jitter correctly
await test("computeBackoffDelay applies jitter correctly", () => {
  const values = new Set<number>();
  // Run 50 times with jitter to see variance
  for (let i = 0; i < 50; i++) {
    values.add(computeBackoffDelay(1, 1000, 10000, 0.2));
  }
  // With jitter 0.2 on base 1000, results should be in [800, 1200]
  for (const v of values) {
    assert(v >= 800, `Jitter lower bound violated: ${v} < 800`);
    assert(v <= 1200, `Jitter upper bound violated: ${v} > 1200`);
  }
  // Multiple distinct values should appear (probabilistic, but 50 runs is enough)
  assert(values.size > 1, `Expected variance from jitter, got only ${values.size} unique value(s)`);
});

// 9. isRetryableError returns true for 500 status
await test("isRetryableError returns true for 500 status", () => {
  const e = new Error("server error");
  (e as unknown as Record<string, number>).status = 500;
  assert(isRetryableError(e) === true, "500 should be retryable");
});

// 10. isRetryableError returns true for 429 status
await test("isRetryableError returns true for 429 status", () => {
  const e = new Error("rate limited");
  (e as unknown as Record<string, number>).status = 429;
  assert(isRetryableError(e) === true, "429 should be retryable");
});

// 11. isRetryableError returns true for ECONNREFUSED
await test("isRetryableError returns true for ECONNREFUSED", () => {
  const e = new Error("connection refused");
  (e as unknown as Record<string, string>).code = "ECONNREFUSED";
  assert(isRetryableError(e) === true, "ECONNREFUSED should be retryable");
});

// 12. isRetryableError returns false for "context length" error
await test("isRetryableError returns false for 'context length' error", () => {
  const e = new Error("context length exceeded");
  assert(isRetryableError(e) === false, "'context length' should NOT be retryable");
});

// 13. isRetryableError returns false for "invalid" error
await test("isRetryableError returns false for 'invalid' error", () => {
  const e = new Error("invalid request parameters");
  assert(isRetryableError(e) === false, "'invalid' should NOT be retryable");
});

// 14. isRetryableError returns true for "model loading" error
await test("isRetryableError returns true for 'model loading' error", () => {
  const e = new Error("model is still loading, please wait");
  assert(isRetryableError(e) === true, "'model loading' should be retryable");
});

// 15. isRetryableError returns true for "timed out" error
await test("isRetryableError returns true for 'timed out' error", () => {
  const e = new Error("request timed out");
  assert(isRetryableError(e) === true, "'timed out' should be retryable");
});

// 16. retryAsync respects minDelayMs and maxDelayMs bounds
await test("retryAsync respects minDelayMs and maxDelayMs bounds", async () => {
  const delays: number[] = [];
  await assertThrowsAsync(async () => {
    await retryAsync(async () => {
      const e = new Error("ECONNREFUSED");
      (e as unknown as Record<string, string>).code = "ECONNREFUSED";
      throw e;
    }, {
      attempts: 4,
      minDelayMs: 10,
      maxDelayMs: 20,
      jitter: 0,
      onRetry: (info) => {
        delays.push(info.delayMs);
      },
    });
  }, "Expected throw");

  // With jitter=0 and minDelayMs=10:
  // attempt 1: 10 * 2^0 = 10, clamped to [10, 20] = 10
  // attempt 2: 10 * 2^1 = 20, clamped to [10, 20] = 20
  // attempt 3: 10 * 2^2 = 40, clamped to [10, 20] = 20
  assert(delays.length === 3, `Expected 3 delays, got ${delays.length}`);
  assert(delays[0] === 10, `Delay 1: expected 10, got ${delays[0]}`);
  assert(delays[1] === 20, `Delay 2: expected 20, got ${delays[1]}`);
  assert(delays[2] === 20, `Delay 3: expected 20 (capped), got ${delays[2]}`);
  // All delays should be within bounds
  for (const d of delays) {
    assert(d >= 10, `Delay ${d} below minDelayMs 10`);
    assert(d <= 20, `Delay ${d} above maxDelayMs 20`);
  }
});

// ---------------------------------------------------------------------------
// MODEL FALLBACK TESTS
// ---------------------------------------------------------------------------

const sampleChain: ModelEntry[] = [
  { provider: "openai", model: "gpt-4" },
  { provider: "anthropic", model: "claude-3-opus" },
  { provider: "google", model: "gemini-1.5" },
];

// 17. createFailoverChain throws on empty array
await test("createFailoverChain throws on empty array", () => {
  assertThrows(() => {
    createFailoverChain([]);
  }, "Expected createFailoverChain to throw on empty array");
});

// 18. createFailoverChain creates valid chain with single model
await test("createFailoverChain creates valid chain with single model", () => {
  const state = createFailoverChain([{ provider: "openai", model: "gpt-4" }]);
  assert(state.chain.length === 1, `Expected chain length 1, got ${state.chain.length}`);
  assert(state.currentIndex === 0, `Expected currentIndex 0, got ${state.currentIndex}`);
  assert(state.attemptCount === 0, `Expected attemptCount 0, got ${state.attemptCount}`);
});

// 19. createFailoverChain creates valid chain with multiple models
await test("createFailoverChain creates valid chain with multiple models", () => {
  const state = createFailoverChain(sampleChain);
  assert(state.chain.length === 3, `Expected chain length 3, got ${state.chain.length}`);
  assert(state.currentIndex === 0, `Expected currentIndex 0, got ${state.currentIndex}`);
  // Verify immutability — original array should not be mutated
  assert(state.chain[0].model === "gpt-4", "Primary model should be gpt-4");
  assert(state.chain[2].model === "gemini-1.5", "Tertiary model should be gemini-1.5");
});

// 20. getCurrentModel returns primary model initially
await test("getCurrentModel returns primary model initially", () => {
  const state = createFailoverChain(sampleChain);
  const model = getCurrentModel(state);
  assert(model.model === "gpt-4", `Expected "gpt-4", got "${model.model}"`);
  assert(model.provider === "openai", `Expected "openai", got "${model.provider}"`);
});

// 21. failoverToNext advances to next model
await test("failoverToNext advances to next model", () => {
  const state = createFailoverChain(sampleChain);
  const next = failoverToNext(state);
  assert(next !== null, "Expected next model, got null");
  if (next !== null) {
    assert(next.model === "claude-3-opus", `Expected "claude-3-opus", got "${next.model}"`);
  }
  assert(state.currentIndex === 1, `Expected currentIndex 1, got ${state.currentIndex}`);
  assert(state.attemptCount === 1, `Expected attemptCount 1, got ${state.attemptCount}`);
});

// 22. failoverToNext returns null when chain exhausted
await test("failoverToNext returns null when chain exhausted", () => {
  const state = createFailoverChain([{ provider: "openai", model: "gpt-4" }]);
  const result = failoverToNext(state);
  assert(result === null, `Expected null when chain exhausted, got ${JSON.stringify(result)}`);
  assert(state.attemptCount === 1, `Expected attemptCount 1, got ${state.attemptCount}`);
});

// 23. resetFailover resets to primary model
await test("resetFailover resets to primary model", () => {
  const state = createFailoverChain(sampleChain);
  failoverToNext(state, new Error("timeout"), "timeout");
  failoverToNext(state);

  // Verify we've advanced
  assert(state.currentIndex === 2, `Expected currentIndex 2 before reset, got ${state.currentIndex}`);
  assert(state.attemptCount === 2, `Expected attemptCount 2 before reset, got ${state.attemptCount}`);

  resetFailover(state);

  assert(state.currentIndex === 0, `Expected currentIndex 0 after reset, got ${state.currentIndex}`);
  assert(state.attemptCount === 0, `Expected attemptCount 0 after reset, got ${state.attemptCount}`);
  assert(state.lastError === undefined, "lastError should be cleared");
  assert(state.lastReason === undefined, "lastReason should be cleared");

  const model = getCurrentModel(state);
  assert(model.model === "gpt-4", `Expected "gpt-4" after reset, got "${model.model}"`);
});

// 24. shouldFailover returns false for context_overflow
await test("shouldFailover returns false for context_overflow", () => {
  const err = new Error("context length exceeded");
  const result = shouldFailover(err);
  assert(result.should === false, "context_overflow should NOT trigger failover");
  assert(result.reason === "context_overflow", `Expected reason "context_overflow", got "${result.reason}"`);
});

// 25. shouldFailover returns true for timeout
await test("shouldFailover returns true for timeout", () => {
  const err = new Error("request timed out");
  const result = shouldFailover(err);
  assert(result.should === true, "timeout should trigger failover");
  assert(result.reason === "timeout", `Expected reason "timeout", got "${result.reason}"`);
});

// 26. shouldFailover returns true for rate_limit
await test("shouldFailover returns true for rate_limit", () => {
  const err = new Error("rate limit exceeded");
  const result = shouldFailover(err);
  assert(result.should === true, "rate_limit should trigger failover");
  assert(result.reason === "rate_limit", `Expected reason "rate_limit", got "${result.reason}"`);
});

// 27. shouldFailover returns true for model_not_found
await test("shouldFailover returns true for model_not_found", () => {
  const err = new Error("model not found: gpt-99");
  const result = shouldFailover(err);
  assert(result.should === true, "model_not_found should trigger failover");
  assert(result.reason === "model_not_found", `Expected reason "model_not_found", got "${result.reason}"`);
});

// 28. classifyFailoverReason correctly identifies context_overflow errors
await test("classifyFailoverReason correctly identifies context_overflow errors", () => {
  const cases = [
    "context length exceeded",
    "context_overflow error",
    "token limit reached",
    "max tokens exceeded for input",
    "input length too large",
    "too many tokens in prompt",
    "prompt too long for model",
  ];
  for (const msg of cases) {
    const reason = classifyFailoverReason(new Error(msg));
    assert(reason === "context_overflow", `"${msg}" should classify as context_overflow, got "${reason}"`);
  }
});

// 29. classifyFailoverReason correctly identifies model_not_found errors
await test("classifyFailoverReason correctly identifies model_not_found errors", () => {
  const cases = [
    "model not found: gpt-99",
    "model_does_not_exist",
    "invalid model name",
    "unknown model identifier",
    "no such model available",
    "model is not available",
  ];
  for (const msg of cases) {
    const reason = classifyFailoverReason(new Error(msg));
    assert(reason === "model_not_found", `"${msg}" should classify as model_not_found, got "${reason}"`);
  }
});

// 30. classifyFailoverReason correctly identifies rate_limit errors
await test("classifyFailoverReason correctly identifies rate_limit errors", () => {
  const cases = [
    "rate limit exceeded",
    "too many requests",
    "429 too many requests",
    "quota exceeded for this month",
    "throttled by provider",
  ];
  for (const msg of cases) {
    const reason = classifyFailoverReason(new Error(msg));
    assert(reason === "rate_limit", `"${msg}" should classify as rate_limit, got "${reason}"`);
  }
});

// 31. classifyFailoverReason correctly identifies timeout errors
await test("classifyFailoverReason correctly identifies timeout errors", () => {
  const cases = [
    "request timed out",
    "connection timeout",
    "ETIMEDOUT error",
    "ECONNABORTED reached",
    "deadline exceeded",
    "operation aborted",
  ];
  for (const msg of cases) {
    const reason = classifyFailoverReason(new Error(msg));
    assert(reason === "timeout", `"${msg}" should classify as timeout, got "${reason}"`);
  }
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;

for (const r of results) {
  if (r.passed) {
    passCount++;
    console.log(`[PASS] ${r.name}`);
  } else {
    failCount++;
    console.log(`[FAIL] ${r.name} - ${r.reason}`);
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);
console.log(`${"=".repeat(60)}`);

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
