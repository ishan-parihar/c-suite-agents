import { describe, test, expect, beforeEach } from "bun:test";
import {
  hashToolCall,
  hashToolOutcome,
  detectToolCallLoop,
  recordToolCall,
  recordToolCallOutcome,
  getToolCallStats,
  DEFAULT_LOOP_DETECTION_CONFIG,
  clearCircuitBreakers,
} from "../runtime/tool-loop-detection";
import type { ToolCallRecord, ToolLoopDetectionConfig } from "../runtime/tool-loop-detection";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEnabledConfig(
  overrides?: Partial<ToolLoopDetectionConfig>,
): ToolLoopDetectionConfig {
  return {
    enabled: true,
    historySize: 30,
    warningThreshold: 10,
    criticalThreshold: 20,
    globalCircuitBreakerThreshold: 30,
    detectors: {
      genericRepeat: true,
      knownPollNoProgress: true,
      pingPong: true,
    },
    ...overrides,
  };
}

function buildHistory(
  count: number,
  toolName: string,
  args: unknown,
  resultHash?: string,
): ToolCallRecord[] {
  const argsHash = hashToolCall(toolName, args);
  const history: ToolCallRecord[] = [];
  for (let i = 0; i < count; i++) {
    history.push({
      toolName,
      argsHash,
      resultHash,
      timestamp: Date.now() + i,
    });
  }
  return history;
}

function makeRecord(
  argsHash: string,
  toolName: string,
  resultHash?: string,
  toolCallId?: string,
): ToolCallRecord {
  return {
    toolName,
    argsHash,
    toolCallId,
    resultHash,
    timestamp: Date.now(),
  };
}

// ─── 1. hashToolCall ────────────────────────────────────────────────────────

// Clear module-level circuit breaker state between tests
beforeEach(() => {
  clearCircuitBreakers();
});

describe("hashToolCall", () => {
  test("same tool+params produces same hash", () => {
    const h1 = hashToolCall("read_file", { path: "src/index.ts" });
    const h2 = hashToolCall("read_file", { path: "src/index.ts" });
    expect(h1).toBe(h2);
  });

  test("different tool produces different hash", () => {
    const h1 = hashToolCall("read_file", { path: "src/index.ts" });
    const h2 = hashToolCall("write_file", { path: "src/index.ts" });
    expect(h1).not.toBe(h2);
  });

  test("different params produces different hash", () => {
    const h1 = hashToolCall("read_file", { path: "src/index.ts" });
    const h2 = hashToolCall("read_file", { path: "src/other.ts" });
    expect(h1).not.toBe(h2);
  });

  test("object key order doesn't affect hash", () => {
    const h1 = hashToolCall("read_file", { path: "src/index.ts", encoding: "utf-8" });
    const h2 = hashToolCall("read_file", { encoding: "utf-8", path: "src/index.ts" });
    expect(h1).toBe(h2);
  });
});

// ─── 2. hashToolOutcome ─────────────────────────────────────────────────────

describe("hashToolOutcome", () => {
  test("same result produces same hash", () => {
    const h1 = hashToolOutcome("read_file", {}, { content: "hello" });
    const h2 = hashToolOutcome("read_file", {}, { content: "hello" });
    expect(h1).toBe(h2);
    expect(h1).toBeDefined();
  });

  test("different results produce different hashes", () => {
    const h1 = hashToolOutcome("read_file", {}, { details: { status: "hello" } });
    const h2 = hashToolOutcome("read_file", {}, { details: { status: "world" } });
    expect(h1).not.toBe(h2);
    expect(h1).toBeDefined();
    expect(h2).toBeDefined();
  });

  test("error case returns error-based hash", () => {
    const h1 = hashToolOutcome("read_file", {}, undefined, new Error("file not found"));
    const h2 = hashToolOutcome("read_file", {}, undefined, new Error("file not found"));
    expect(h1).toBeDefined();
    expect(h1).toBe(h2);
    expect(typeof h1).toBe("string");
  });

  test("returns undefined for undefined result", () => {
    const h = hashToolOutcome("read_file", {}, undefined);
    expect(h).toBeUndefined();
  });
});

// ─── 3. detectToolCallLoop — global_circuit_breaker ─────────────────────────

describe("detectToolCallLoop — global_circuit_breaker", () => {
  const config = makeEnabledConfig({ detectors: { genericRepeat: false, knownPollNoProgress: false, pingPong: false } });

  test("no detection below threshold (29 repeats)", () => {
    const history = buildHistory(29, "run_command", { cmd: "ls" }, "same_result_hash");
    const result = detectToolCallLoop(history, "run_command", { cmd: "ls" }, config);
    expect(result.stuck).toBe(false);
  });

  test("triggers at threshold (30 repeats with same result hash)", () => {
    const history = buildHistory(30, "run_command", { cmd: "ls" }, "same_result_hash");
    const result = detectToolCallLoop(history, "run_command", { cmd: "ls" }, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.detector).toBe("global_circuit_breaker");
      expect(result.level).toBe("critical");
      expect(result.count).toBe(30);
    }
  });

  test("returns critical level", () => {
    const history = buildHistory(35, "run_command", { cmd: "ls" }, "same_result_hash");
    const result = detectToolCallLoop(history, "run_command", { cmd: "ls" }, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.level).toBe("critical");
    }
  });

  test("only triggers when result hashes match (different results = no detection)", () => {
    const history: ToolCallRecord[] = [];
    for (let i = 0; i < 35; i++) {
      history.push({
        toolName: "run_command",
        argsHash: hashToolCall("run_command", { cmd: "ls" }),
        resultHash: `unique_hash_${i}`,
        timestamp: Date.now() + i,
      });
    }
    const result = detectToolCallLoop(history, "run_command", { cmd: "ls" }, config);
    expect(result.stuck).toBe(false);
  });
});

// ─── 4. detectToolCallLoop — known_poll_no_progress ────────────────────────

describe("detectToolCallLoop — known_poll_no_progress", () => {
  const config = makeEnabledConfig();

  test("tool named 'get_status' triggers poll detection at warning threshold", () => {
    const history = buildHistory(10, "get_status", { jobId: "123" }, "polling_result");
    const result = detectToolCallLoop(history, "get_status", { jobId: "123" }, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.detector).toBe("known_poll_no_progress");
      expect(result.level).toBe("warning");
      expect(result.count).toBe(10);
    }
  });

  test("tool named 'check_health' triggers at critical threshold", () => {
    const history = buildHistory(20, "check_health", { service: "api" }, "health_result");
    const result = detectToolCallLoop(history, "check_health", { service: "api" }, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.detector).toBe("known_poll_no_progress");
      expect(result.level).toBe("critical");
      expect(result.count).toBe(20);
    }
  });

  test("non-poll tool does NOT trigger this detector", () => {
    const history = buildHistory(15, "create_file", { path: "test.txt" }, "create_result");
    const result = detectToolCallLoop(history, "create_file", { path: "test.txt" }, config);
    // At 15, it should NOT trigger known_poll_no_progress (not a poll tool)
    // But it WILL trigger generic_repeat at 15 (>= warningThreshold=10)
    // However, the key test is: is the detector 'known_poll_no_progress'? No.
    if (result.stuck) {
      expect(result.detector).not.toBe("known_poll_no_progress");
    }
  });

  test("returns warning at warningThreshold, critical at globalCircuitBreakerThreshold for poll tools", () => {
    // Warning at 10
    const history10 = buildHistory(10, "poll_updates", {}, "poll_hash");
    const result10 = detectToolCallLoop(history10, "poll_updates", {}, config);
    expect(result10.stuck).toBe(true);
    if (result10.stuck) {
      expect(result10.level).toBe("warning");
      expect(result10.detector).toBe("known_poll_no_progress");
    }

    // Critical at 20
    const history20 = buildHistory(20, "poll_updates", {}, "poll_hash");
    const result20 = detectToolCallLoop(history20, "poll_updates", {}, config);
    expect(result20.stuck).toBe(true);
    if (result20.stuck) {
      expect(result20.level).toBe("critical");
      expect(result20.detector).toBe("known_poll_no_progress");
    }
  });
});

// ─── 5. detectToolCallLoop — ping_pong ──────────────────────────────────────

describe("detectToolCallLoop — ping_pong", () => {
  const config = makeEnabledConfig({ warningThreshold: 4, criticalThreshold: 8, detectors: { genericRepeat: false, knownPollNoProgress: false, pingPong: true } });

  test("4 alternating calls (A→B→A→B) with stable results triggers warning", () => {
    const hashA = hashToolCall("tool_a", { id: "1" });
    const hashB = hashToolCall("tool_b", { id: "1" });
    const resultHashA = "result_a_stable";
    const resultHashB = "result_b_stable";

    const history: ToolCallRecord[] = [
      makeRecord(hashA, "tool_a", resultHashA),
      makeRecord(hashB, "tool_b", resultHashB),
      makeRecord(hashA, "tool_a", resultHashA),
      makeRecord(hashB, "tool_b", resultHashB),
    ];

    const result = detectToolCallLoop(history, "tool_a", { id: "1" }, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.detector).toBe("ping_pong");
      expect(result.level).toBe("warning");
      expect(result.count).toBe(5);
    }
  });

  test("non-alternating pattern does NOT trigger", () => {
    const hashA = hashToolCall("tool_a", { id: "1" });
    const hashB = hashToolCall("tool_b", { id: "1" });
    const hashC = hashToolCall("tool_c", { id: "1" });

    const history: ToolCallRecord[] = [
      makeRecord(hashA, "tool_a"),
      makeRecord(hashB, "tool_b"),
      makeRecord(hashC, "tool_c"),
      makeRecord(hashA, "tool_a"),
    ];

    const result = detectToolCallLoop(history, "tool_a", { id: "1" }, config);
    expect(result.stuck).toBe(false);
  });

  test("different result hashes between calls still triggers but without noProgressEvidence", () => {
    const hashA = hashToolCall("tool_a", { id: "1" });
    const hashB = hashToolCall("tool_b", { id: "1" });

    const history: ToolCallRecord[] = [
      makeRecord(hashA, "tool_a", "result_v1"),
      makeRecord(hashB, "tool_b", "result_v1"),
      makeRecord(hashA, "tool_a", "result_v2"),
      makeRecord(hashB, "tool_b", "result_v2"),
    ];

    const result = detectToolCallLoop(history, "tool_a", { id: "1" }, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.detector).toBe("ping_pong");
      expect(result.level).toBe("warning");
    }
  });
});

// ─── 6. detectToolCallLoop — generic_repeat ─────────────────────────────────

describe("detectToolCallLoop — generic_repeat", () => {
  const config = makeEnabledConfig();

  test("same tool called warningThreshold times triggers warning", () => {
    const history = buildHistory(10, "custom_tool", { action: "do" }, "unique_result");
    // Different result hashes each time means no global_circuit_breaker, no known_poll_no_progress
    // But generic_repeat counts by argsHash only, not resultHash
    const result = detectToolCallLoop(history, "custom_tool", { action: "do" }, config);
    expect(result.stuck).toBe(true);
    if (result.stuck) {
      expect(result.detector).toBe("generic_repeat");
      expect(result.level).toBe("warning");
      expect(result.count).toBe(10);
    }
  });

  test("different tool names don't accumulate", () => {
    const history: ToolCallRecord[] = [];
    for (let i = 0; i < 15; i++) {
      history.push({
        toolName: `tool_${i}`,
        argsHash: hashToolCall(`tool_${i}`, { action: "do" }),
        timestamp: Date.now() + i,
      });
    }
    const result = detectToolCallLoop(history, "tool_15", { action: "do" }, config);
    expect(result.stuck).toBe(false);
  });

  test("below warningThreshold returns not stuck", () => {
    const history = buildHistory(5, "custom_tool", { action: "do" });
    const result = detectToolCallLoop(history, "custom_tool", { action: "do" }, config);
    expect(result.stuck).toBe(false);
  });

  test("disabled config returns not stuck regardless of history", () => {
    const history = buildHistory(50, "custom_tool", { action: "do" }, "same");
    const disabledConfig = makeEnabledConfig({ enabled: false });
    const result = detectToolCallLoop(history, "custom_tool", { action: "do" }, disabledConfig);
    expect(result.stuck).toBe(false);
  });

  test("empty history returns not stuck", () => {
    const result = detectToolCallLoop([], "any_tool", {}, config);
    expect(result.stuck).toBe(false);
  });
});

// ─── 7. recordToolCall ──────────────────────────────────────────────────────

describe("recordToolCall", () => {
  test("returns new array (immutability)", () => {
    const history: ToolCallRecord[] = [];
    const updated = recordToolCall(history, "tool_a", { x: 1 });
    expect(updated).not.toBe(history);
    expect(history.length).toBe(0);
    expect(updated.length).toBe(1);
  });

  test("enforces historySize limit", () => {
    const history = buildHistory(30, "old_tool", {});
    expect(history.length).toBe(30);
    const updated = recordToolCall(history, "new_tool", {});
    expect(updated.length).toBe(30);
    // First item should be dropped
    expect(updated[0].toolName).toBe("old_tool");
    // The 30 old_tool items minus 1 dropped = 29 old + 1 new
    const oldToolCount = updated.filter((r) => r.toolName === "old_tool").length;
    expect(oldToolCount).toBe(29);
    const newToolCount = updated.filter((r) => r.toolName === "new_tool").length;
    expect(newToolCount).toBe(1);
  });

  test("includes toolCallId", () => {
    const updated = recordToolCall([], "tool_a", {}, "call-123");
    expect(updated[0].toolCallId).toBe("call-123");
  });

  test("includes correct argsHash", () => {
    const updated = recordToolCall([], "read_file", { path: "test.ts" });
    expect(updated[0].argsHash).toBe(hashToolCall("read_file", { path: "test.ts" }));
  });

  test("does not include resultHash on initial call", () => {
    const updated = recordToolCall([], "tool_a", {});
    expect(updated[0].resultHash).toBeUndefined();
  });
});

// ─── 8. recordToolCallOutcome ───────────────────────────────────────────────

describe("recordToolCallOutcome", () => {
  test("matches by toolCallId", () => {
    const history = recordToolCall([], "tool_a", { x: 1 }, "call-abc");
    expect(history[0].resultHash).toBeUndefined();

    const updated = recordToolCallOutcome(
      history,
      "tool_a",
      { x: 1 },
      { data: "result" },
      undefined,
      "call-abc",
    );

    expect(updated[0].resultHash).toBeDefined();
    expect(updated[0].toolCallId).toBe("call-abc");
  });

  test("falls back to toolName+argsHash matching", () => {
    const history = recordToolCall([], "tool_a", { x: 1 });
    expect(history[0].resultHash).toBeUndefined();

    const updated = recordToolCallOutcome(
      history,
      "tool_a",
      { x: 1 },
      { data: "result" },
    );

    expect(updated[0].resultHash).toBeDefined();
  });

  test("returns new array", () => {
    const history = recordToolCall([], "tool_a", { x: 1 }, "call-1");
    const updated = recordToolCallOutcome(
      history,
      "tool_a",
      { x: 1 },
      { data: "result" },
      undefined,
      "call-1",
    );
    expect(updated).not.toBe(history);
  });

  test("appends new record when no match found", () => {
    const history: ToolCallRecord[] = [];
    const updated = recordToolCallOutcome(
      history,
      "tool_a",
      { x: 1 },
      { data: "orphan_result" },
      undefined,
      "orphan-call",
    );
    expect(updated.length).toBe(1);
    expect(updated[0].resultHash).toBeDefined();
    expect(updated[0].toolCallId).toBe("orphan-call");
  });

  test("returns same-length array when resultHash is undefined", () => {
    // hashToolOutcome returns undefined when result is undefined and no error
    const history = recordToolCall([], "tool_a", { x: 1 }, "call-1");
    const updated = recordToolCallOutcome(
      history,
      "tool_a",
      { x: 1 },
      undefined, // no result
      undefined, // no error
      "call-1",
    );
    expect(updated.length).toBe(history.length);
    expect(updated[0].resultHash).toBeUndefined();
  });

  test("skips records that already have resultHash", () => {
    const history = recordToolCall([], "tool_a", { x: 1 }, "call-1");
    const withOutcome = recordToolCallOutcome(
      history,
      "tool_a",
      { x: 1 },
      { data: "first" },
      undefined,
      "call-1",
    );
    const firstHash = withOutcome[0].resultHash;

    const updated = recordToolCallOutcome(
      withOutcome,
      "tool_a",
      { x: 1 },
      { data: "second" },
      undefined,
      "call-1",
    );

    expect(updated[0].resultHash).toBe(firstHash);
  });
});

// ─── 9. getToolCallStats ────────────────────────────────────────────────────

describe("getToolCallStats", () => {
  test("empty history returns zeros", () => {
    const stats = getToolCallStats([]);
    expect(stats.totalCalls).toBe(0);
    expect(stats.uniquePatterns).toBe(0);
    expect(stats.mostFrequent).toBeNull();
  });

  test("correctly counts total and unique patterns", () => {
    const history = buildHistory(5, "tool_a", { x: 1 });
    const history2 = buildHistory(3, "tool_b", { y: 2 });
    const combined = [...history, ...history2];

    const stats = getToolCallStats(combined);
    expect(stats.totalCalls).toBe(8);
    expect(stats.uniquePatterns).toBe(2);
  });

  test("identifies most frequent pattern", () => {
    const history = buildHistory(5, "tool_a", { x: 1 });
    const history2 = buildHistory(3, "tool_b", { y: 2 });
    const combined = [...history, ...history2];

    const stats = getToolCallStats(combined);
    expect(stats.mostFrequent).not.toBeNull();
    if (stats.mostFrequent) {
      expect(stats.mostFrequent.toolName).toBe("tool_a");
      expect(stats.mostFrequent.count).toBe(5);
    }
  });

  test("single call returns correct stats", () => {
    const history = buildHistory(1, "solo_tool", {});
    const stats = getToolCallStats(history);
    expect(stats.totalCalls).toBe(1);
    expect(stats.uniquePatterns).toBe(1);
    expect(stats.mostFrequent).not.toBeNull();
    if (stats.mostFrequent) {
      expect(stats.mostFrequent.toolName).toBe("solo_tool");
      expect(stats.mostFrequent.count).toBe(1);
    }
  });
});

// ─── 10. DEFAULT_LOOP_DETECTION_CONFIG ──────────────────────────────────────

describe("DEFAULT_LOOP_DETECTION_CONFIG", () => {
  test("has correct default values", () => {
    expect(DEFAULT_LOOP_DETECTION_CONFIG.enabled).toBe(false);
    expect(DEFAULT_LOOP_DETECTION_CONFIG.historySize).toBe(30);
    expect(DEFAULT_LOOP_DETECTION_CONFIG.warningThreshold).toBe(10);
    expect(DEFAULT_LOOP_DETECTION_CONFIG.criticalThreshold).toBe(20);
    expect(DEFAULT_LOOP_DETECTION_CONFIG.globalCircuitBreakerThreshold).toBe(30);
    expect(DEFAULT_LOOP_DETECTION_CONFIG.detectors.genericRepeat).toBe(true);
    expect(DEFAULT_LOOP_DETECTION_CONFIG.detectors.knownPollNoProgress).toBe(true);
    expect(DEFAULT_LOOP_DETECTION_CONFIG.detectors.pingPong).toBe(true);
  });
});
