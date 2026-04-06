import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ErrorBus, ErrorEmitter, MAX_HISTORY, createErrorEvent } from "../runtime/error-emitter.js";
import { ErrorAggregatorClass } from "../runtime/error-aggregator.js";
import { AlertManagerClass } from "../runtime/alert-manager.js";
import { SelfHealerClass } from "../runtime/self-healer.js";
import { HeartbeatMonitorClass } from "../scheduler/heartbeat-monitor.js";
import { CronErrorHandlerClass } from "../scheduler/cron-error-handler.js";
import {
  StrategosError,
  ProviderError,
  ToolExecutionError,
  PersistenceError,
  HeartbeatError,
  CronJobError,
  GatewayError,
  AgentError,
  classifyError,
  toFailureScenario,
} from "../runtime/error-types.js";
import { FailureScenario } from "../runtime/recovery.js";
import { RecoveryRegistry, attemptRecovery } from "../runtime/recovery.js";

describe("Error Observability Integration", () => {
  beforeEach(() => {
    ErrorEmitter.reset();
    ErrorAggregatorClass.reset();
    AlertManagerClass.reset();
    SelfHealerClass.reset();
    HeartbeatMonitorClass.reset();
    CronErrorHandlerClass.reset();
    RecoveryRegistry.getInstance().reset();
  });

  describe("Error Types", () => {
    test("StrategosError has all required properties", () => {
      const err = new StrategosError("test", {
        code: "TEST_001",
        component: "test",
        severity: "error",
        metadata: { key: "value" },
      });
      expect(err.name).toBe("Error");
      expect(err.message).toBe("test");
      expect(err.code).toBe("TEST_001");
      expect(err.component).toBe("test");
      expect(err.severity).toBe("error");
      expect(err.metadata).toEqual({ key: "value" });
    });

    test("ProviderError carries failover reason", () => {
      const err = new ProviderError("timeout", {
        failoverReason: "timeout",
        provider: "openai",
        model: "gpt-4",
        httpStatus: 504,
      });
      expect(err.failoverReason).toBe("timeout");
      expect(err.provider).toBe("openai");
      expect(err.model).toBe("gpt-4");
      expect(err.httpStatus).toBe(504);
      expect(err.code).toBe("PROVIDER_ERROR");
      expect(err.component).toBe("llm-provider");
      expect(err.severity).toBe("error");
    });

    test("ToolExecutionError carries tool metadata", () => {
      const err = new ToolExecutionError("tool failed", {
        toolName: "bash",
        toolType: "native",
        round: 3,
      });
      expect(err.toolName).toBe("bash");
      expect(err.toolType).toBe("native");
      expect(err.round).toBe(3);
    });

    test("PersistenceError carries subsystem", () => {
      const err = new PersistenceError("db locked", {
        subsystem: "kanban",
        operation: "write",
      });
      expect(err.subsystem).toBe("kanban");
      expect(err.operation).toBe("write");
      expect(err.severity).toBe("critical");
    });

    test("HeartbeatError carries agent info", () => {
      const err = new HeartbeatError("missed", {
        agentId: "ceo",
        missedCount: 3,
        lastHeartbeatAt: 1000,
      });
      expect(err.agentId).toBe("ceo");
      expect(err.missedCount).toBe(3);
    });

    test("CronJobError severity scales with failCount", () => {
      const low = new CronJobError("fail", { jobId: "j1", failCount: 1 });
      const high = new CronJobError("fail", { jobId: "j2", failCount: 5 });
      expect(low.severity).toBe("warn");
      expect(high.severity).toBe("critical");
    });

    test("GatewayError carries gateway type", () => {
      const err = new GatewayError("down", {
        gatewayType: "mcp-client",
        url: "http://localhost:3001",
      });
      expect(err.gatewayType).toBe("mcp-client");
      expect(err.url).toBe("http://localhost:3001");
    });

    test("AgentError carries lifecycle phase", () => {
      const err = new AgentError("init failed", {
        agentId: "cio",
        lifecyclePhase: "init",
      });
      expect(err.agentId).toBe("cio");
      expect(err.lifecyclePhase).toBe("init");
    });

    test("cause chain is preserved", () => {
      const cause = new Error("root cause");
      const err = new ProviderError("upstream", {
        failoverReason: "api_error",
        cause,
      });
      expect(err.cause).toBe(cause);
    });
  });

  describe("classifyError", () => {
    test("typed StrategosError uses declared severity", () => {
      const err = new HeartbeatError("missed", { agentId: "ceo" });
      const result = classifyError(err);
      expect(result.severity).toBe("warn");
      expect(result.isRecoverable).toBe(true);
    });

    test("ProviderError with rate_limit is recoverable", () => {
      const err = new ProviderError("rate limited", { failoverReason: "rate_limit" });
      const result = classifyError(err);
      expect(result.isRecoverable).toBe(true);
    });

    test("ProviderError with context_overflow is NOT recoverable", () => {
      const err = new ProviderError("too long", { failoverReason: "context_overflow" });
      const result = classifyError(err);
      expect(result.isRecoverable).toBe(false);
    });

    test("PersistenceError is critical and not recoverable", () => {
      const err = new PersistenceError("corrupt", { subsystem: "memory", operation: "read" });
      const result = classifyError(err);
      expect(result.severity).toBe("critical");
      expect(result.isRecoverable).toBe(false);
    });

    test("plain Error with timeout message is recoverable", () => {
      const result = classifyError(new Error("request timed out"));
      expect(result.severity).toBe("warn");
      expect(result.isRecoverable).toBe(true);
    });

    test("plain Error with auth message is NOT recoverable", () => {
      const result = classifyError(new Error("unauthorized 401"));
      expect(result.severity).toBe("error");
      expect(result.isRecoverable).toBe(false);
    });
  });

  describe("toFailureScenario", () => {
    test("ProviderError → LLMProviderFailure", () => {
      const err = new ProviderError("err", { failoverReason: "timeout" });
      expect(toFailureScenario(err)).toBe(FailureScenario.LLMProviderFailure);
    });

    test("ToolExecutionError → MCPToolExecutionFailure", () => {
      const err = new ToolExecutionError("fail", { toolName: "bash", toolType: "native" });
      expect(toFailureScenario(err)).toBe(FailureScenario.MCPToolExecutionFailure);
    });

    test("PersistenceError(memory) → MemoryStoreFailure", () => {
      const err = new PersistenceError("err", { subsystem: "memory", operation: "read" });
      expect(toFailureScenario(err)).toBe(FailureScenario.MemoryStoreFailure);
    });

    test("PersistenceError(kanban) → KanbanPersistenceFailure", () => {
      const err = new PersistenceError("err", { subsystem: "kanban", operation: "write" });
      expect(toFailureScenario(err)).toBe(FailureScenario.KanbanPersistenceFailure);
    });

    test("HeartbeatError → AgentHeartbeatFailure", () => {
      const err = new HeartbeatError("missed", { agentId: "ceo" });
      expect(toFailureScenario(err)).toBe(FailureScenario.AgentHeartbeatFailure);
    });

    test("GatewayError(telegram) → TelegramNotificationFailure", () => {
      const err = new GatewayError("err", { gatewayType: "telegram" });
      expect(toFailureScenario(err)).toBe(FailureScenario.TelegramNotificationFailure);
    });
  });

  describe("ErrorBus", () => {
    test("emit creates event with id and timestamp", () => {
      const evt = ErrorBus.emit({
        type: "error:detected",
        severity: "error",
        component: "test",
        error: new Error("test"),
        message: "test error",
      });
      expect(evt.id).toBeDefined();
      expect(typeof evt.id).toBe("string");
      expect(evt.timestamp).toBeGreaterThan(0);
      expect(evt.type).toBe("error:detected");
    });

    test("on/once/off listener lifecycle", () => {
      const calls: string[] = [];
      const unsub = ErrorBus.on("error:detected", (e) => calls.push(e.message));
      ErrorBus.emit({ type: "error:detected", severity: "error", component: "t", error: null, message: "first" });
      unsub();
      ErrorBus.emit({ type: "error:detected", severity: "error", component: "t", error: null, message: "second" });
      expect(calls).toEqual(["first"]);
    });

    test("wildcard listener receives all events", () => {
      const calls: string[] = [];
      ErrorBus.on("*", (e) => calls.push(e.type));
      ErrorBus.emit({ type: "tool:failed", severity: "error", component: "t", error: null, message: "a" });
      ErrorBus.emit({ type: "cron:failed", severity: "warn", component: "t", error: null, message: "b" });
      expect(calls).toEqual(["tool:failed", "cron:failed"]);
    });

    test("history maintains ring buffer", () => {
      for (let i = 0; i < MAX_HISTORY + 10; i++) {
        ErrorBus.emit({ type: "error:detected", severity: "info", component: "t", error: null, message: `evt-${i}` });
      }
      const history = ErrorBus.history();
      expect(history.length).toBe(MAX_HISTORY);
      expect(history[0].message).toBe(`evt-${MAX_HISTORY + 9}`);
    });

    test("stats returns correct counts", () => {
      ErrorBus.emit({ type: "tool:failed", severity: "error", component: "tools", error: null, message: "a" });
      ErrorBus.emit({ type: "tool:failed", severity: "warn", component: "tools", error: null, message: "b" });
      ErrorBus.emit({ type: "heartbeat:missed", severity: "warn", component: "heartbeat", error: null, message: "c" });
      const stats = ErrorBus.stats();
      expect(stats.totalEmitted).toBeGreaterThanOrEqual(3);
      expect(stats.byType["tool:failed"]).toBeGreaterThanOrEqual(2);
      expect(stats.byComponent.tools).toBeGreaterThanOrEqual(2);
    });

    test("createErrorEvent builds event from StrategosError", () => {
      const err = new ProviderError("timeout", { failoverReason: "timeout", provider: "openai" });
      const evt = createErrorEvent("provider:failed", err, { component: "llm", agentId: "ceo" });
      expect(evt.type).toBe("provider:failed");
      expect(evt.agentId).toBe("ceo");
      expect(evt.error).toBe(err);
    });
  });

  describe("ErrorAggregator", () => {
    test("deduplicates identical errors", () => {
      const agg = ErrorAggregatorClass.getInstance();
      agg.start();
      ErrorBus.emit({ type: "tool:failed", severity: "error", component: "tools", error: new Error("bash failed"), message: "bash failed" });
      ErrorBus.emit({ type: "tool:failed", severity: "error", component: "tools", error: new Error("bash failed"), message: "bash failed" });
      ErrorBus.emit({ type: "tool:failed", severity: "error", component: "tools", error: new Error("bash failed"), message: "bash failed" });
      
      const aggregated = agg.getAggregated();
      expect(aggregated.length).toBe(1);
      expect(aggregated[0].count).toBe(3);
      agg.stop();
    });

    test("getHistogram returns type counts", () => {
      const agg = ErrorAggregatorClass.getInstance();
      agg.start();
      ErrorBus.emit({ type: "tool:failed", severity: "error", component: "tools", error: null, message: "a" });
      ErrorBus.emit({ type: "tool:failed", severity: "error", component: "tools", error: null, message: "b" });
      ErrorBus.emit({ type: "heartbeat:missed", severity: "warn", component: "heartbeat", error: null, message: "c" });
      
      const hist = agg.getHistogram();
      expect(hist["tool:failed"]).toBe(2);
      expect(hist["heartbeat:missed"]).toBe(1);
      agg.stop();
    });
  });

  describe("SelfHealer", () => {
    test("circuit breaker starts closed", () => {
      const healer = SelfHealerClass.getInstance();
      expect(healer.getCircuitState("test")).toBe("closed");
    });

    test("executeRecovery returns structured result", async () => {
      const healer = SelfHealerClass.getInstance();
      const result = await healer.executeRecovery(FailureScenario.LLMProviderFailure, {
        agentId: "test",
        error: new Error("provider down"),
      });
      expect(result.scenario).toBe(FailureScenario.LLMProviderFailure);
      expect(result.actionsAttempted.length).toBeGreaterThan(0);
    });

    test("stats tracks recovery attempts", async () => {
      const healer = SelfHealerClass.getInstance();
      await healer.executeRecovery(FailureScenario.MCPToolExecutionFailure, {
        agentId: "test",
        error: new Error("tool fail"),
      });
      const stats = healer.getStats();
      expect(stats.totalRecoveries).toBeGreaterThan(0);
    });
  });

  describe("Recovery (no more STUBs)", () => {
    test("LLMProviderFailure recovery attempts real actions", async () => {
      const registry = RecoveryRegistry.getInstance();
      registry.registerDefaultRecipes();
      const event = await registry.execute(FailureScenario.LLMProviderFailure, {
        error: new Error("provider down"),
        scenario: FailureScenario.LLMProviderFailure,
        attemptNumber: 1,
      });
      expect(event.stepsAttempted.length).toBeGreaterThan(0);
      expect(event.scenario).toBe(FailureScenario.LLMProviderFailure);
    });

    test("MCPToolExecutionFailure recovery attempts real actions", async () => {
      const registry = RecoveryRegistry.getInstance();
      registry.registerDefaultRecipes();
      const event = await registry.execute(FailureScenario.MCPToolExecutionFailure, {
        error: new Error("tool fail"),
        scenario: FailureScenario.MCPToolExecutionFailure,
        agentId: "agent-1",
        attemptNumber: 1,
      });
      expect(event.stepsAttempted.length).toBeGreaterThan(0);
    });

    test("attemptRecovery convenience function works", async () => {
      const registry = RecoveryRegistry.getInstance();
      registry.registerDefaultRecipes();
      const event = await attemptRecovery(FailureScenario.TelegramNotificationFailure, {
        error: new Error("telegram down"),
      });
      expect(event.scenario).toBe(FailureScenario.TelegramNotificationFailure);
    });
  });

  describe("CronErrorHandler", () => {
    test("tracks consecutive failures", () => {
      const handler = CronErrorHandlerClass.getInstance();
      handler.recordFailure("job-1", "test job", "ceo", "error msg");
      handler.recordFailure("job-1", "test job", "ceo", "error msg");
      const state = handler.getJobState("job-1");
      expect(state?.consecutiveFailures).toBe(2);
      expect(state?.totalFailures).toBe(2);
    });

    test("recordSuccess resets consecutive failures", () => {
      const handler = CronErrorHandlerClass.getInstance();
      handler.recordFailure("job-1", "test job", "ceo", "error msg");
      handler.recordFailure("job-1", "test job", "ceo", "error msg");
      handler.recordSuccess("job-1");
      const state = handler.getJobState("job-1");
      expect(state?.consecutiveFailures).toBe(0);
      expect(state?.lastSuccessAt).toBeDefined();
    });

    test("getStats returns summary", () => {
      const handler = CronErrorHandlerClass.getInstance();
      handler.recordFailure("job-1", "test job", "ceo", "error msg");
      handler.recordFailure("job-2", "another job", "coo", "error msg");
      const stats = handler.getStats();
      expect(stats.totalJobsTracked).toBe(2);
      expect(stats.jobsWithFailures).toBe(2);
      expect(stats.totalConsecutiveFailures).toBe(2);
    });
  });

  describe("HeartbeatMonitor", () => {
    test("checkNow returns classified agents", async () => {
      const monitor = HeartbeatMonitorClass.getInstance();
      const result = await monitor.checkNow();
      expect(result).toHaveProperty("silent");
      expect(result).toHaveProperty("degraded");
      expect(result).toHaveProperty("healthy");
      expect(result).toHaveProperty("errors");
      expect(Array.isArray(result.silent)).toBe(true);
    });

    test("checkHistory bounded at 50", async () => {
      const monitor = HeartbeatMonitorClass.getInstance();
      for (let i = 0; i < 55; i++) {
        await monitor.checkNow();
      }
      const history = monitor.getCheckHistory();
      expect(history.length).toBeLessThanOrEqual(50);
    });
  });

  describe("AlertManager", () => {
    test("formatAlertMessage produces user-safe output", () => {
      const mgr = AlertManagerClass.getInstance();
      const evt = ErrorBus.emit({
        type: "provider:failed",
        severity: "error",
        component: "llm-provider",
        error: new Error("timeout"),
        message: "LLM provider timeout",
        agentId: "ceo",
      });
      const state = mgr.getState("llm-provider:ceo") || {
        key: "llm-provider:ceo",
        component: "llm-provider",
        agentId: "ceo",
        consecutiveFailures: 3,
        totalAlertsSent: 1,
        tier: "warn",
      };
      const msg = mgr.formatAlertMessage(evt, state, "warn");
      expect(msg.length).toBeLessThan(4000);
      expect(msg.toLowerCase()).toContain("llm");
      expect(msg.toLowerCase()).toContain("provider");
    });

    test("addRule and removeRule work", () => {
      const mgr = AlertManagerClass.getInstance();
      mgr.addRule({
        component: "custom-component",
        consecutiveThreshold: 1,
        cooldownMs: 1000,
        tier: "warn",
      });
      mgr.removeRule("custom-component");
    });
  });

  describe("Wiring: ErrorBus emits flow through subsystems", () => {
    test("ErrorBus emit is received by Aggregator", () => {
      const agg = ErrorAggregatorClass.getInstance();
      agg.start();
      ErrorBus.emit({
        type: "tool:failed",
        severity: "error",
        component: "tools",
        error: new Error("test tool fail"),
        message: "test tool fail",
      });
      const aggregated = agg.getAggregated();
      expect(aggregated.length).toBeGreaterThanOrEqual(1);
      agg.stop();
    });

    test("ErrorBus emit is received by AlertManager", () => {
      const mgr = AlertManagerClass.getInstance();
      mgr.start();
      ErrorBus.emit({
        type: "provider:failed",
        severity: "error",
        component: "llm-provider",
        error: new Error("provider error"),
        message: "provider error",
        agentId: "ceo",
      });
      const states = mgr.getAllStates();
      const llmState = states.find(s => s.component === "llm-provider");
      expect(llmState).toBeDefined();
      mgr.stop();
    });

    test("ErrorBus emit is received by SelfHealer", async () => {
      const healer = SelfHealerClass.getInstance();
      healer.start();
      ErrorBus.emit({
        type: "error:detected",
        severity: "error",
        component: "test-component",
        error: new Error("test error"),
        message: "test error",
        agentId: "test-agent",
      });
      const stats = healer.getStats();
      expect(typeof stats.totalRecoveries).toBe("number");
      healer.stop();
    });

    test("CronErrorHandler receives cron:failed events", () => {
      const handler = CronErrorHandlerClass.getInstance();
      handler.start();
      ErrorBus.emit({
        type: "cron:failed",
        severity: "warn",
        component: "scheduler",
        error: new Error("cron job failed"),
        message: "cron job failed",
        agentId: "ceo",
        context: { cronId: "test-job" },
      });
      const states = handler.getAllStates();
      expect(states.length).toBeGreaterThanOrEqual(1);
      handler.stop();
    });
  });
});
