import { describe, test, expect } from "bun:test";
import {
  classifyFailoverReason,
  shouldFailover,
  createBillingBackoffRegistry,
  recordBillingError,
  getBillingBackoffRemainingMs,
  clearBillingBackoff,
} from "../runtime/model-fallback.js";

describe("model-fallback", () => {
  test("classifies auth and billing errors", () => {
    expect(classifyFailoverReason(new Error("invalid api key"))).toBe("auth_error");
    expect(classifyFailoverReason(new Error("insufficient funds on account"))).toBe("billing_error");
    expect(classifyFailoverReason({ status: 401 })).toBe("auth_error");
    expect(classifyFailoverReason({ status: 402 })).toBe("billing_error");
  });

  test("billing errors do not trigger direct failover", () => {
    const result = shouldFailover(new Error("billing exceeded"));
    expect(result.reason).toBe("billing_error");
    expect(result.should).toBe(false);
  });

  test("billing backoff registry tracks cooldown lifecycle", () => {
    const registry = createBillingBackoffRegistry();
    const recorded = recordBillingError(registry, "openai", "gpt-x", "insufficient funds");
    expect(recorded.cooldownMs).toBeGreaterThan(0);

    const remaining = getBillingBackoffRemainingMs(registry, "openai", "gpt-x");
    expect(remaining).toBeGreaterThan(0);

    clearBillingBackoff(registry, "openai", "gpt-x");
    const afterClear = getBillingBackoffRemainingMs(registry, "openai", "gpt-x");
    expect(afterClear).toBe(0);
  });
});

