import { describe, test, expect } from "bun:test";
import { createExecutionContext, withPhase, elapsedMs, startTimer } from "../runtime/observability.js";

describe("observability helpers", () => {
  test("createExecutionContext includes correlationId and fields", () => {
    const ctx = createExecutionContext({ agentId: "ceo-strategic", taskId: "t1" });
    expect(typeof ctx.correlationId).toBe("string");
    expect(ctx.correlationId.length).toBeGreaterThan(10);
    expect(ctx.agentId).toBe("ceo-strategic");
    expect(ctx.taskId).toBe("t1");
  });

  test("withPhase preserves context and sets phase", () => {
    const base = createExecutionContext({ agentId: "coo-productivity" });
    const phased = withPhase(base, "scheduler.task.start");
    expect(phased.correlationId).toBe(base.correlationId);
    expect(phased.agentId).toBe("coo-productivity");
    expect(phased.phase).toBe("scheduler.task.start");
  });

  test("elapsedMs returns non-negative duration", async () => {
    const started = startTimer();
    await new Promise((r) => setTimeout(r, 2));
    const ms = elapsedMs(started);
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});

