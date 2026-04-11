// Hook System Tests
import { describe, test, expect, beforeEach } from "bun:test";
import {
  HookRegistry,
  getHookRegistry,
  type HookContext,
  type HookResult,
  type HookType,
} from "../runtime/hooks";

const baseCtx: HookContext = {
  toolName: "memory.search",
  input: { query: "test" },
  agentId: "ceo",
};

describe("HookRegistry", () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  describe("register / execute", () => {
    test("execute returns empty result when no hooks registered", async () => {
      const result = await registry.execute("pre_tool_use", baseCtx);
      expect(result).toEqual({});
    });

    test("registered hook receives context and returns result", async () => {
      registry.register("pre_tool_use", "audit", async (ctx) => {
        return { feedback: `Tool ${ctx.toolName} called` };
      });
      const result = await registry.execute("pre_tool_use", baseCtx);
      expect(result.feedback).toBe("Tool memory.search called");
    });

    test("multiple hooks of same type all execute", async () => {
      registry.register("post_tool_use", "metrics", async () => ({
        feedback: "metrics",
      }));
      registry.register("post_tool_use", "log", async () => ({
        feedback: "log",
      }));
      const result = await registry.execute("post_tool_use", baseCtx);
      // Feedback is concatenated
      expect(result.feedback).toContain("metrics");
      expect(result.feedback).toContain("log");
    });
  });

  describe("cancellation", () => {
    test("cancelled hook short-circuits execution", async () => {
      const callOrder: string[] = [];
      registry.register("pre_tool_use", "blocker", async () => {
        callOrder.push("blocker");
        return { cancelled: true, feedback: "Blocked by policy" };
      });
      registry.register("pre_tool_use", "logger", async () => {
        callOrder.push("logger");
        return { feedback: "logged" };
      });

      const result = await registry.execute("pre_tool_use", baseCtx);
      expect(result.cancelled).toBe(true);
      expect(result.feedback).toBe("Blocked by policy");
      expect(callOrder).toEqual(["blocker"]);
    });
  });

  describe("input/output merging", () => {
    test("modifiedInput from multiple hooks merges", async () => {
      registry.register("pre_tool_use", "a", async () => ({
        modifiedInput: { a: 1 },
      }));
      registry.register("pre_tool_use", "b", async () => ({
        modifiedInput: { b: 2 },
      }));
      const result = await registry.execute("pre_tool_use", baseCtx);
      expect(result.modifiedInput).toEqual({ a: 1, b: 2 });
    });

    test("later modifiedOutput overwrites earlier", async () => {
      registry.register("post_tool_use", "a", async () => ({
        modifiedOutput: "first",
      }));
      registry.register("post_tool_use", "b", async () => ({
        modifiedOutput: "second",
      }));
      const result = await registry.execute("post_tool_use", baseCtx);
      expect(result.modifiedOutput).toBe("second");
    });
  });

  describe("feedback concatenation", () => {
    test("feedback from multiple hooks joined with newline", async () => {
      registry.register("pre_tool_use", "x", async () => ({ feedback: "first" }));
      registry.register("pre_tool_use", "y", async () => ({ feedback: "second" }));
      registry.register("pre_tool_use", "z", async () => ({ feedback: "third" }));
      const result = await registry.execute("pre_tool_use", baseCtx);
      expect(result.feedback).toBe("first\nsecond\nthird");
    });
  });

  describe("unregister", () => {
    test("unregister removes hook", async () => {
      registry.register("pre_tool_use", "temp", async () => ({ feedback: "temp" }));
      expect(registry.unregister("pre_tool_use", "temp")).toBe(true);
      const result = await registry.execute("pre_tool_use", baseCtx);
      expect(result.feedback).toBeUndefined();
    });

    test("unregister returns false for non-existent hook", () => {
      expect(registry.unregister("pre_tool_use", "nope")).toBe(false);
    });

    test("unregister works for non-existent type", () => {
      expect(registry.unregister("post_tool_use_failure", "nope")).toBe(false);
    });
  });

  describe("hook types", () => {
    test("all three hook types work independently", async () => {
      registry.register("pre_tool_use", "pre", async () => ({ feedback: "pre" }));
      registry.register("post_tool_use", "post", async () => ({ feedback: "post" }));
      registry.register("post_tool_use_failure", "fail", async () => ({
        feedback: "fail",
      }));

      const pre = await registry.execute("pre_tool_use", baseCtx);
      const post = await registry.execute("post_tool_use", baseCtx);
      const fail = await registry.execute("post_tool_use_failure", baseCtx);

      expect(pre.feedback).toBe("pre");
      expect(post.feedback).toBe("post");
      expect(fail.feedback).toBe("fail");
    });
  });
});

describe("getHookRegistry singleton", () => {
  test("returns same instance on repeated calls", () => {
    const a = getHookRegistry();
    const b = getHookRegistry();
    expect(a).toBe(b);
  });
});
