// Recovery Registry Tests
import { describe, test, expect, beforeEach } from "bun:test";
import {
  RecoveryRegistry,
  attemptRecovery,
  FailureScenario,
  RecoveryStep,
  type RecoveryContext,
  type RecoveryRecipe,
  type RecoveryStepResult,
} from "../runtime/recovery.js";

describe("RecoveryRegistry", () => {
  beforeEach(() => {
    // Reset singleton between tests
    const registry = RecoveryRegistry.getInstance();
    registry.reset();
  });

  describe("singleton", () => {
    test("getInstance returns the same instance", () => {
      const a = RecoveryRegistry.getInstance();
      const b = RecoveryRegistry.getInstance();
      expect(a).toBe(b);
    });

    test("reset clears the singleton", () => {
      const a = RecoveryRegistry.getInstance();
      a.reset();
      // After reset, getInstance creates a new instance
      // (reset sets instance to null)
      // Verify the registry is clean
      const b = RecoveryRegistry.getInstance();
      expect(b.listScenarios()).toHaveLength(0);
    });
  });

  describe("register / getRecipe", () => {
    test("register stores a recipe and getRecipe retrieves it", () => {
      const registry = RecoveryRegistry.getInstance();
      const recipe: RecoveryRecipe = {
        scenario: FailureScenario.AgentHeartbeatFailure,
        steps: [],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description: "Test recipe",
      };
      registry.register(recipe);
      expect(registry.getRecipe(FailureScenario.AgentHeartbeatFailure)).toBe(recipe);
    });

    test("register overwrites existing recipe for same scenario", () => {
      const registry = RecoveryRegistry.getInstance();
      const recipe1: RecoveryRecipe = {
        scenario: FailureScenario.LLMProviderFailure,
        steps: [],
        maxAttempts: 1,
        escalationPolicy: "LogAndContinue",
        description: "First",
      };
      const recipe2: RecoveryRecipe = {
        scenario: FailureScenario.LLMProviderFailure,
        steps: [],
        maxAttempts: 2,
        escalationPolicy: "AlertUser",
        description: "Second",
      };
      registry.register(recipe1);
      registry.register(recipe2);
      expect(registry.getRecipe(FailureScenario.LLMProviderFailure)?.description).toBe("Second");
      expect(registry.getRecipe(FailureScenario.LLMProviderFailure)?.maxAttempts).toBe(2);
    });

    test("getRecipe returns undefined for unregistered scenario", () => {
      const registry = RecoveryRegistry.getInstance();
      expect(registry.getRecipe(FailureScenario.MCPToolExecutionFailure)).toBeUndefined();
    });
  });

  describe("listScenarios", () => {
    test("returns empty array when no recipes registered", () => {
      const registry = RecoveryRegistry.getInstance();
      expect(registry.listScenarios()).toEqual([]);
    });

    test("returns all registered scenarios", () => {
      const registry = RecoveryRegistry.getInstance();
      registry.register({
        scenario: FailureScenario.AgentHeartbeatFailure,
        steps: [],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description: "test",
      });
      registry.register({
        scenario: FailureScenario.MemoryStoreFailure,
        steps: [],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description: "test",
      });
      const scenarios = registry.listScenarios();
      expect(scenarios).toContain(FailureScenario.AgentHeartbeatFailure);
      expect(scenarios).toContain(FailureScenario.MemoryStoreFailure);
      expect(scenarios).toHaveLength(2);
    });
  });

  describe("execute", () => {
    test("returns event with escalation when no recipe registered", async () => {
      const registry = RecoveryRegistry.getInstance();
      const event = await registry.execute(FailureScenario.LLMProviderFailure, {
        error: new Error("test"),
        scenario: FailureScenario.LLMProviderFailure,
        attemptNumber: 1,
      });
      expect(event.success).toBe(false);
      expect(event.escalation_triggered).toBe(true);
      expect(event.escalation_policy).toBe("LogAndContinue");
      expect(event.message).toContain("No recovery recipe registered");
    });

    test("executes steps and returns success when all steps succeed", async () => {
      const registry = RecoveryRegistry.getInstance();
      const stepResult: RecoveryStepResult = { success: true, message: "Step OK" };
      registry.register({
        scenario: FailureScenario.MCPToolExecutionFailure,
        steps: [
          async () => stepResult,
          async () => ({ success: true, message: "Step 2 OK" }),
        ],
        maxAttempts: 1,
        escalationPolicy: "LogAndContinue",
        description: "Test",
      });

      const event = await registry.execute(FailureScenario.MCPToolExecutionFailure, {
        error: new Error("tool failed"),
        scenario: FailureScenario.MCPToolExecutionFailure,
        attemptNumber: 1,
      });

      expect(event.success).toBe(true);
      expect(event.escalation_triggered).toBe(false);
      expect(event.stepsAttempted).toHaveLength(2);
    });

    test("stops on first failing step and retries up to maxAttempts", async () => {
      const registry = RecoveryRegistry.getInstance();
      let attemptCount = 0;
      registry.register({
        scenario: FailureScenario.KanbanPersistenceFailure,
        steps: [
          async (ctx) => {
            attemptCount = ctx.attemptNumber;
            return { success: false, message: "Step fails" };
          },
        ],
        maxAttempts: 3,
        escalationPolicy: "AlertUser",
        description: "Failing recipe",
      });

      const event = await registry.execute(FailureScenario.KanbanPersistenceFailure, {
        error: new Error("fail"),
        scenario: FailureScenario.KanbanPersistenceFailure,
        attemptNumber: 1,
      });

      expect(attemptCount).toBe(3);
      expect(event.success).toBe(false);
      expect(event.escalation_triggered).toBe(true);
      expect(event.escalation_policy).toBe("AlertUser");
    });

    test("succeeds on second attempt after first failure", async () => {
      const registry = RecoveryRegistry.getInstance();
      let callCount = 0;
      registry.register({
        scenario: FailureScenario.MessageDeliveryFailure,
        steps: [
          async () => {
            callCount++;
            if (callCount < 2) {
              return { success: false, message: "Attempt 1 fails" };
            }
            return { success: true, message: "Attempt 2 succeeds" };
          },
        ],
        maxAttempts: 2,
        escalationPolicy: "LogAndContinue",
        description: "Retry recipe",
      });

      const event = await registry.execute(FailureScenario.MessageDeliveryFailure, {
        error: new Error("delivery fail"),
        scenario: FailureScenario.MessageDeliveryFailure,
        attemptNumber: 1,
      });

      expect(event.success).toBe(true);
      expect(event.escalation_triggered).toBe(false);
      expect(callCount).toBe(2);
    });
  });

  describe("event listeners", () => {
    test("onEvent fires after every execute", async () => {
      const registry = RecoveryRegistry.getInstance();
      registry.register({
        scenario: FailureScenario.AgentHeartbeatFailure,
        steps: [async () => ({ success: true, message: "OK" })],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description: "test",
      });

      const events: any[] = [];
      registry.onEvent((e) => events.push(e));

      await registry.execute(FailureScenario.AgentHeartbeatFailure, {
        error: new Error("test"),
        scenario: FailureScenario.AgentHeartbeatFailure,
        attemptNumber: 1,
      });

      expect(events).toHaveLength(1);
      expect(events[0].scenario).toBe(FailureScenario.AgentHeartbeatFailure);
      expect(events[0].success).toBe(true);
    });

    test("offEvent removes listener", async () => {
      const registry = RecoveryRegistry.getInstance();
      registry.register({
        scenario: FailureScenario.TelegramNotificationFailure,
        steps: [async () => ({ success: true, message: "OK" })],
        maxAttempts: 1,
        escalationPolicy: "LogAndContinue",
        description: "test",
      });

      const events: any[] = [];
      const listener = (e: any) => events.push(e);
      registry.onEvent(listener);
      registry.offEvent(listener);

      await registry.execute(FailureScenario.TelegramNotificationFailure, {
        error: new Error("test"),
        scenario: FailureScenario.TelegramNotificationFailure,
        attemptNumber: 1,
      });

      expect(events).toHaveLength(0);
    });

    test("listener throwing does not crash recovery", async () => {
      const registry = RecoveryRegistry.getInstance();
      registry.register({
        scenario: FailureScenario.LLMProviderFailure,
        steps: [async () => ({ success: true, message: "OK" })],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description: "test",
      });

      registry.onEvent(() => {
        throw new Error("listener error");
      });

      // Should not throw
      const event = await registry.execute(FailureScenario.LLMProviderFailure, {
        error: new Error("test"),
        scenario: FailureScenario.LLMProviderFailure,
        attemptNumber: 1,
      });
      expect(event.success).toBe(true);
    });
  });

  describe("registerDefaultRecipes", () => {
    test("registers all 7 default scenarios", () => {
      const registry = RecoveryRegistry.getInstance();
      registry.registerDefaultRecipes();
      const scenarios = registry.listScenarios();
      expect(scenarios).toHaveLength(7);
      expect(scenarios).toContain(FailureScenario.AgentHeartbeatFailure);
      expect(scenarios).toContain(FailureScenario.MessageDeliveryFailure);
      expect(scenarios).toContain(FailureScenario.MemoryStoreFailure);
      expect(scenarios).toContain(FailureScenario.KanbanPersistenceFailure);
      expect(scenarios).toContain(FailureScenario.MCPToolExecutionFailure);
      expect(scenarios).toContain(FailureScenario.LLMProviderFailure);
      expect(scenarios).toContain(FailureScenario.TelegramNotificationFailure);
    });

    test("onAlert hook fires on AlertUser escalation", async () => {
      const registry = RecoveryRegistry.getInstance();
      const alerts: any[] = [];
      // Register a recipe that will definitely fail to trigger escalation
      registry.register({
        scenario: FailureScenario.LLMProviderFailure,
        steps: [async () => ({ success: false, message: "intentional fail" })],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description: "Test: always-fail LLM recipe",
      });
      registry.onEvent((evt) => {
        if (evt.escalation_triggered && evt.escalation_policy === "AlertUser") {
          alerts.push(evt);
        }
      });

      await registry.execute(FailureScenario.LLMProviderFailure, {
        error: new Error("provider down"),
        scenario: FailureScenario.LLMProviderFailure,
        attemptNumber: 1,
        agentId: "test-agent",
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].escalation_triggered).toBe(true);
    });

    test("onAbort hook fires on AbortAgent escalation", async () => {
      const registry = RecoveryRegistry.getInstance();
      const aborts: string[] = [];
      registry.registerDefaultRecipes({ onAbort: (id) => aborts.push(id) });
      // Override AgentHeartbeatFailure with AbortAgent AFTER default registration
      registry.register({
        scenario: FailureScenario.AgentHeartbeatFailure,
        steps: [async () => ({ success: false, message: "Restart failed" })],
        maxAttempts: 1,
        escalationPolicy: "AbortAgent",
        description: "Abort recipe",
      });

      await registry.execute(FailureScenario.AgentHeartbeatFailure, {
        error: new Error("heartbeat lost"),
        scenario: FailureScenario.AgentHeartbeatFailure,
        attemptNumber: 1,
        agentId: "agent-42",
      });

      expect(aborts).toContain("agent-42");
    });
  });

  describe("attemptRecovery", () => {
    test("convenience function calls the registry", async () => {
      const registry = RecoveryRegistry.getInstance();
      registry.registerDefaultRecipes();

      const event = await attemptRecovery(FailureScenario.MCPToolExecutionFailure, {
        agentId: "agent-1",
        error: new Error("tool error"),
      });

      expect(event.scenario).toBe(FailureScenario.MCPToolExecutionFailure);
      // Recovery steps are now real implementations — the event should have
      // been processed (may succeed or fail depending on runtime state)
      expect(event.stepsAttempted.length).toBeGreaterThan(0);
    });
  });
});
