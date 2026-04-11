// Policy Engine Tests
import { describe, test, expect, beforeEach } from "bun:test";
import {
  PolicyEngine,
  getPrebuiltPolicies,
  type PolicyRule,
  type LaneContext,
} from "../runtime/policy";

const sampleCtx: LaneContext = {
  agentId: "coo",
  agentStatus: "active",
  cardCount: 5,
  oldestCardHours: 24,
  memoryCount: 200,
  unreadMessages: 3,
  consecutiveFailures: 0,
  sessionTokenCount: 50000,
};

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe("register / listRules", () => {
    test("register stores a rule", () => {
      engine.register({
        name: "test-rule",
        condition: { type: "agent_status", status: "active" },
        action: { type: "notify", channel: "telegram", message: "test" },
        priority: 1,
        enabled: true,
      });
      const rules = engine.listRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe("test-rule");
    });

    test("register overwrites existing rule with same name", () => {
      engine.register({
        name: "dup",
        condition: { type: "agent_status", status: "active" },
        action: { type: "notify", channel: "telegram", message: "v1" },
        priority: 1,
        enabled: true,
      });
      engine.register({
        name: "dup",
        condition: { type: "agent_status", status: "idle" },
        action: { type: "notify", channel: "telegram", message: "v2" },
        priority: 2,
        enabled: true,
      });
      const rules = engine.listRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].action.type).toBe("notify");
      expect((rules[0].action as any).message).toBe("v2");
    });

    test("listRules returns rules sorted by priority", () => {
      engine.register({
        name: "low",
        condition: { type: "agent_status", status: "active" },
        action: { type: "notify", channel: "telegram", message: "low" },
        priority: 10,
        enabled: true,
      });
      engine.register({
        name: "high",
        condition: { type: "agent_status", status: "active" },
        action: { type: "notify", channel: "telegram", message: "high" },
        priority: 1,
        enabled: true,
      });
      const rules = engine.listRules();
      expect(rules[0].name).toBe("high");
      expect(rules[1].name).toBe("low");
    });
  });

  describe("enableRule / disableRule", () => {
    test("disableRule prevents rule from matching", () => {
      engine.register({
        name: "toggle",
        condition: { type: "agent_status", status: "active" },
        action: { type: "notify", channel: "telegram", message: "active" },
        priority: 1,
        enabled: true,
      });
      engine.disableRule("toggle");
      const actions = engine.evaluate(sampleCtx);
      expect(actions).toHaveLength(0);
    });

    test("enableRule re-enables a disabled rule", () => {
      engine.register({
        name: "toggle",
        condition: { type: "agent_status", status: "active" },
        action: { type: "notify", channel: "telegram", message: "active" },
        priority: 1,
        enabled: false,
      });
      expect(engine.evaluate(sampleCtx)).toHaveLength(0);
      engine.enableRule("toggle");
      expect(engine.evaluate(sampleCtx)).toHaveLength(1);
    });

    test("enableRule/disableRule are no-op for non-existent rules", () => {
      expect(() => engine.enableRule("nope")).not.toThrow();
      expect(() => engine.disableRule("nope")).not.toThrow();
    });
  });

  describe("evaluate — atomic conditions", () => {
    test("agent_status matches exact status", () => {
      engine.register({
        name: "status-check",
        condition: { type: "agent_status", status: "active" },
        action: { type: "notify", channel: "telegram", message: "active" },
        priority: 1,
        enabled: true,
      });
      expect(engine.evaluate(sampleCtx)).toHaveLength(1);
      expect(engine.evaluate({ ...sampleCtx, agentStatus: "idle" })).toHaveLength(0);
    });

    test("card_age fires when oldestCardHours exceeds threshold", () => {
      engine.register({
        name: "stale",
        condition: { type: "card_age", hours: 20 },
        action: { type: "escalate", reason: "stale" },
        priority: 1,
        enabled: true,
      });
      expect(engine.evaluate(sampleCtx)).toHaveLength(1); // 24 > 20
      expect(engine.evaluate({ ...sampleCtx, oldestCardHours: 10 })).toHaveLength(0); // 10 < 20
    });

    test("memory_count fires when memoryCount exceeds threshold", () => {
      engine.register({
        name: "mem-heavy",
        condition: { type: "memory_count", threshold: 150 },
        action: { type: "compact", reason: "too much" },
        priority: 1,
        enabled: true,
      });
      expect(engine.evaluate(sampleCtx)).toHaveLength(1); // 200 > 150
      expect(engine.evaluate({ ...sampleCtx, memoryCount: 100 })).toHaveLength(0);
    });

    test("message_backlog fires when unreadMessages exceeds threshold", () => {
      engine.register({
        name: "msg-pileup",
        condition: { type: "message_backlog", threshold: 2 },
        action: { type: "notify", channel: "telegram", message: "check inbox" },
        priority: 1,
        enabled: true,
      });
      expect(engine.evaluate(sampleCtx)).toHaveLength(1); // 3 > 2
      expect(engine.evaluate({ ...sampleCtx, unreadMessages: 1 })).toHaveLength(0);
    });

    test("consecutive_failures fires when failures >= count", () => {
      engine.register({
        name: "fail-streak",
        condition: { type: "consecutive_failures", count: 3 },
        action: { type: "abort", reason: "too many failures" },
        priority: 1,
        enabled: true,
      });
      expect(engine.evaluate({ ...sampleCtx, consecutiveFailures: 3 })).toHaveLength(1);
      expect(engine.evaluate({ ...sampleCtx, consecutiveFailures: 5 })).toHaveLength(1);
      expect(engine.evaluate({ ...sampleCtx, consecutiveFailures: 2 })).toHaveLength(0);
    });

    test("session_token_count fires when tokens exceed threshold", () => {
      engine.register({
        name: "token-heavy",
        condition: { type: "session_token_count", threshold: 40000 },
        action: { type: "compact", reason: "tokens high" },
        priority: 1,
        enabled: true,
      });
      expect(engine.evaluate(sampleCtx)).toHaveLength(1); // 50000 > 40000
      expect(engine.evaluate({ ...sampleCtx, sessionTokenCount: 30000 })).toHaveLength(0);
    });
  });

  describe("evaluate — combinator conditions", () => {
    test("and requires ALL conditions to match", () => {
      engine.register({
        name: "both-bad",
        condition: {
          type: "and",
          conditions: [
            { type: "agent_status", status: "active" },
            { type: "card_age", hours: 48 },
          ],
        },
        action: { type: "escalate", reason: "active + stale" },
        priority: 1,
        enabled: true,
      });
      // sampleCtx has active status but only 24h card age
      expect(engine.evaluate(sampleCtx)).toHaveLength(0);
      expect(engine.evaluate({ ...sampleCtx, oldestCardHours: 50 })).toHaveLength(1);
    });

    test("or requires AT LEAST ONE condition to match", () => {
      engine.register({
        name: "either-bad",
        condition: {
          type: "or",
          conditions: [
            { type: "agent_status", status: "blocked" },
            { type: "consecutive_failures", count: 3 },
          ],
        },
        action: { type: "abort", reason: "problem" },
        priority: 1,
        enabled: true,
      });
      expect(engine.evaluate(sampleCtx)).toHaveLength(0);
      expect(engine.evaluate({ ...sampleCtx, agentStatus: "blocked" })).toHaveLength(1);
      expect(engine.evaluate({ ...sampleCtx, consecutiveFailures: 5 })).toHaveLength(1);
    });

    test("nested combinators work correctly", () => {
      engine.register({
        name: "complex",
        condition: {
          type: "and",
          conditions: [
            { type: "agent_status", status: "active" },
            {
              type: "or",
              conditions: [
                { type: "card_age", hours: 20 },
                { type: "message_backlog", threshold: 1 },
              ],
            },
          ],
        },
        action: { type: "notify", channel: "telegram", message: "complex" },
        priority: 1,
        enabled: true,
      });
      // sampleCtx: active, card 24h (>20), messages 3 (>1) — OR matches
      expect(engine.evaluate(sampleCtx)).toHaveLength(1);
      // inactive — AND fails
      expect(engine.evaluate({ ...sampleCtx, agentStatus: "idle" })).toHaveLength(0);
    });
  });

  describe("evaluate — priority ordering", () => {
    test("returns actions sorted by priority ascending", () => {
      engine.register({
        name: "low-pri",
        condition: { type: "agent_status", status: "active" },
        action: { type: "notify", channel: "telegram", message: "low" },
        priority: 10,
        enabled: true,
      });
      engine.register({
        name: "high-pri",
        condition: { type: "agent_status", status: "active" },
        action: { type: "escalate", reason: "high" },
        priority: 1,
        enabled: true,
      });
      engine.register({
        name: "mid-pri",
        condition: { type: "agent_status", status: "active" },
        action: { type: "compact", reason: "mid" },
        priority: 5,
        enabled: true,
      });

      const actions = engine.evaluate(sampleCtx);
      expect(actions).toHaveLength(3);
      expect(actions[0].type).toBe("escalate"); // priority 1
      expect(actions[1].type).toBe("compact"); // priority 5
      expect(actions[2].type).toBe("notify"); // priority 10
    });
  });

  describe("evaluate — disabled rules excluded", () => {
    test("disabled rules do not produce actions", () => {
      engine.register({
        name: "on",
        condition: { type: "agent_status", status: "active" },
        action: { type: "notify", channel: "telegram", message: "on" },
        priority: 1,
        enabled: true,
      });
      engine.register({
        name: "off",
        condition: { type: "agent_status", status: "active" },
        action: { type: "escalate", reason: "off" },
        priority: 2,
        enabled: false,
      });
      expect(engine.evaluate(sampleCtx)).toHaveLength(1);
      expect(engine.evaluate(sampleCtx)[0].type).toBe("notify");
    });
  });

  describe("getPrebuiltPolicies", () => {
    test("returns 4 pre-built rules", () => {
      const policies = getPrebuiltPolicies();
      expect(policies).toHaveLength(4);
      expect(policies.map((p) => p.name)).toContain("stale-card-escalation");
      expect(policies.map((p) => p.name)).toContain("message-backlog-notify");
      expect(policies.map((p) => p.name)).toContain("consecutive-failure-escalate");
      expect(policies.map((p) => p.name)).toContain("session-compact");
    });

    test("stale-card-escalation fires when card age > 48h", () => {
      const eng = new PolicyEngine();
      for (const rule of getPrebuiltPolicies()) eng.register(rule);
      const actions = eng.evaluate({ ...sampleCtx, oldestCardHours: 50 });
      const escalate = actions.find((a) => a.type === "escalate");
      expect(escalate).toBeDefined();
      expect((escalate as any).reason).toContain("idle for more than 48 hours");
    });

    test("message-backlog-notify fires when unread > 10", () => {
      const eng = new PolicyEngine();
      for (const rule of getPrebuiltPolicies()) eng.register(rule);
      const actions = eng.evaluate({ ...sampleCtx, unreadMessages: 15 });
      const notify = actions.find((a) => a.type === "notify");
      expect(notify).toBeDefined();
      expect((notify as any).channel).toBe("telegram");
    });

    test("consecutive-failure-escalate fires when failures >= 3", () => {
      const eng = new PolicyEngine();
      for (const rule of getPrebuiltPolicies()) eng.register(rule);
      const actions = eng.evaluate({ ...sampleCtx, consecutiveFailures: 3 });
      const escalate = actions.find((a) => a.type === "escalate" && (a as any).target === "user");
      expect(escalate).toBeDefined();
    });

    test("session-compact fires when tokens > 100k", () => {
      const eng = new PolicyEngine();
      for (const rule of getPrebuiltPolicies()) eng.register(rule);
      const actions = eng.evaluate({ ...sampleCtx, sessionTokenCount: 110000 });
      const compact = actions.find((a) => a.type === "compact");
      expect(compact).toBeDefined();
    });
  });
});
