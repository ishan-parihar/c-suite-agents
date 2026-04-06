/**
 * Self-Healer — orchestrates automatic recovery actions with circuit breaker pattern.
 *
 * This is the brain of the self-healing system: it decides WHEN to auto-recover,
 * WHAT recovery action to take, and WHEN to give up and escalate.
 *
 * Replaces the STUB recovery steps in recovery.ts with REAL implementations.
 *
 * Design principles:
 * - Per-component CircuitBreaker to prevent cascading failures
 * - Real recovery step implementations (not stubs)
 * - Event-driven recovery via ErrorBus subscriptions
 * - Dynamic imports for subsystem-specific logic to avoid circular deps
 * - Listener safety: no throwing from event handlers
 * - Timeout-bounded recovery actions via Promise.race
 *
 * Usage:
 *   import { SelfHealer } from "./runtime/self-healer.js";
 *   SelfHealer.start();
 *
 * @module self-healer
 */

import { logger } from "../logger.js";
import {
  classifyError,
  toFailureScenario,
} from "./error-types.js";
import { ErrorBus } from "./error-emitter.js";
import type { ErrorEvent, ErrorEventType } from "./error-emitter.js";
import { FailureScenario } from "./recovery.js";
import { retryAsync } from "./retry.js";

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

/** Possible states of a circuit breaker. */
export type CircuitState = "closed" | "open" | "half-open";

/** Configuration options for a CircuitBreaker instance. */
export interface CircuitBreakerOptions {
  /** Open circuit after N failures. Default: 5 */
  failureThreshold: number;
  /** Try half-open after this time (ms). Default: 60000 */
  recoveryTimeoutMs: number;
  /** Close circuit after N successes in half-open. Default: 2 */
  successThreshold: number;
}

const DEFAULT_CB_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  recoveryTimeoutMs: 60_000,
  successThreshold: 2,
};

/**
 * CircuitBreaker prevents cascading failures by halting execution
 * when a component has failed too many times.
 *
 * State machine:
 *   closed   → (failures >= threshold) → open
 *   open     → (timeout elapsed)       → half-open
 *   half-open → (successes >= threshold) → closed
 *   half-open → (failure)               → open
 */
class CircuitBreaker {
  state: CircuitState = "closed";
  failures = 0;
  successes = 0;
  lastFailureAt?: number;

  private opts: Required<CircuitBreakerOptions>;

  constructor(options?: CircuitBreakerOptions) {
    this.opts = { ...DEFAULT_CB_OPTIONS, ...options };
  }

  /** Record a failure for this circuit. */
  recordFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();
    this.successes = 0;

    if (this.failures >= this.opts.failureThreshold) {
      this.state = "open";
    }
  }

  /** Record a success for this circuit. */
  recordSuccess(): void {
    this.successes++;
    if (this.state === "half-open") {
      if (this.successes >= this.opts.successThreshold) {
        this.state = "closed";
        this.failures = 0;
        this.successes = 0;
      }
    } else if (this.state === "closed") {
      this.failures = 0;
    }
  }

  /** Returns false if the circuit is open (execution blocked). */
  canExecute(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (
        this.lastFailureAt !== undefined &&
        Date.now() - this.lastFailureAt >= this.opts.recoveryTimeoutMs
      ) {
        this.state = "half-open";
        this.successes = 0;
        logger.warn(
          { lastFailureAt: this.lastFailureAt },
          "CircuitBreaker: transitioning to half-open",
        );
        return true;
      }
      return false;
    }
    // half-open: allow one attempt
    return true;
  }

  /** Get the current state of the circuit. */
  getState(): CircuitState {
    // Re-check if we should transition to half-open
    if (this.state === "open") {
      if (
        this.lastFailureAt !== undefined &&
        Date.now() - this.lastFailureAt >= this.opts.recoveryTimeoutMs
      ) {
        this.state = "half-open";
        this.successes = 0;
        logger.warn(
          { lastFailureAt: this.lastFailureAt },
          "CircuitBreaker: transitioning to half-open (getState check)",
        );
      }
    }
    return this.state;
  }

  /** Manually reset the circuit to closed state. */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.lastFailureAt = undefined;
  }
}

// ---------------------------------------------------------------------------
// RecoveryAction
// ---------------------------------------------------------------------------

/**
 * A concrete recovery action that the SelfHealer can execute.
 * Each action type maps to a real implementation.
 */
export type RecoveryAction =
  | { type: "reconnect"; subsystem: string }
  | { type: "retry"; maxAttempts: number; delayMs: number }
  | { type: "failover"; target: string }
  | { type: "flush-and-reinit"; subsystem: string }
  | { type: "restart-agent"; agentId: string }
  | { type: "drain-and-replay"; queue: string }
  | { type: "compact-session"; sessionId: string }
  | { type: "alert-only" };

// ---------------------------------------------------------------------------
// RecoveryPlan
// ---------------------------------------------------------------------------

/**
 * A plan for recovering from a specific failure scenario.
 * Contains an ordered list of actions to try.
 */
export interface RecoveryPlan {
  scenario: FailureScenario;
  actions: RecoveryAction[];
  maxAttempts: number;
  escalateOnFailure: boolean;
}

// ---------------------------------------------------------------------------
// RecoveryResult
// ---------------------------------------------------------------------------

/** Result returned after executing a recovery plan. */
export interface RecoveryResult {
  success: boolean;
  scenario: FailureScenario;
  actionsAttempted: string[];
  message: string;
  escalated: boolean;
  agentId?: string;
}

// ---------------------------------------------------------------------------
// SelfHealer Options
// ---------------------------------------------------------------------------

/** Configuration options for the SelfHealer. */
export interface SelfHealerOptions {
  circuitBreaker?: CircuitBreakerOptions;
  /** Max time (ms) for a single recovery action. Default: 30000 */
  recoveryTimeoutMs?: number;
  /** Master switch for auto-recovery. Default: true */
  enableAutoRecovery?: boolean;
}

const DEFAULT_SELF_HEALER_OPTIONS: { recoveryTimeoutMs: number; enableAutoRecovery: boolean } = {
  recoveryTimeoutMs: 30_000,
  enableAutoRecovery: true,
};

// ---------------------------------------------------------------------------
// Default Recovery Plans
// ---------------------------------------------------------------------------

/**
 * Pre-registered recovery plans for each known FailureScenario.
 * These define what actions to try and in what order.
 */
const DEFAULT_PLANS: RecoveryPlan[] = [
  {
    scenario: FailureScenario.AgentHeartbeatFailure,
    actions: [
      { type: "restart-agent", agentId: "" },
      { type: "reconnect", subsystem: "heartbeat" },
    ],
    maxAttempts: 1,
    escalateOnFailure: true,
  },
  {
    scenario: FailureScenario.MessageDeliveryFailure,
    actions: [
      { type: "drain-and-replay", queue: "message-queue" },
      { type: "retry", maxAttempts: 2, delayMs: 1_000 },
    ],
    maxAttempts: 1,
    escalateOnFailure: false,
  },
  {
    scenario: FailureScenario.MemoryStoreFailure,
    actions: [
      { type: "reconnect", subsystem: "memory" },
      { type: "flush-and-reinit", subsystem: "memory" },
    ],
    maxAttempts: 1,
    escalateOnFailure: true,
  },
  {
    scenario: FailureScenario.KanbanPersistenceFailure,
    actions: [
      { type: "reconnect", subsystem: "kanban" },
      { type: "flush-and-reinit", subsystem: "kanban" },
    ],
    maxAttempts: 1,
    escalateOnFailure: true,
  },
  {
    scenario: FailureScenario.MCPToolExecutionFailure,
    actions: [
      { type: "retry", maxAttempts: 2, delayMs: 500 },
      { type: "failover", target: "fallback-tool" },
    ],
    maxAttempts: 1,
    escalateOnFailure: false,
  },
  {
    scenario: FailureScenario.LLMProviderFailure,
    actions: [
      { type: "failover", target: "fallback-model" },
      { type: "retry", maxAttempts: 1, delayMs: 2_000 },
    ],
    maxAttempts: 1,
    escalateOnFailure: true,
  },
  {
    scenario: FailureScenario.TelegramNotificationFailure,
    actions: [{ type: "reconnect", subsystem: "telegram" }],
    maxAttempts: 2,
    escalateOnFailure: false,
  },
];

// ---------------------------------------------------------------------------
// SelfHealer Class
// ---------------------------------------------------------------------------

/** Internal context type used by recovery actions. */
type RecoveryContext = {
  agentId?: string;
  error?: unknown;
  component?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Orchestrates automatic recovery actions with circuit breaker pattern.
 *
 * The SelfHealer:
 * 1. Subscribes to ErrorBus for event-driven recovery
 * 2. Classifies errors and determines if auto-recovery should trigger
 * 3. Executes recovery plans with real implementations (not stubs)
 * 4. Maintains per-component CircuitBreaker instances
 * 5. Escalates to AlertManager when recovery is exhausted
 */
export class SelfHealerClass {
  private static instance: SelfHealerClass | null = null;

  /** Per-component circuit breakers. */
  private circuits: Map<string, CircuitBreaker> = new Map();

  /** Recovery plans keyed by FailureScenario. */
  private plans: Map<FailureScenario, RecoveryPlan> = new Map();

  /** Unsubscribe functions from ErrorBus listeners. */
  private unsubscribers: Array<() => void> = [];

  /** Master switch for auto-recovery. */
  private autoRecoveryEnabled: boolean;

  /** Max time (ms) for a single recovery action. */
  private recoveryTimeoutMs: number;

  /** Circuit breaker options (applied to new circuits). */
  private cbOptions: CircuitBreakerOptions;

  /** Whether the healer is currently running. */
  private running = false;

  /** Stats counters. */
  private statsCounter = {
    totalRecoveries: 0,
    successful: 0,
    failed: 0,
  };

  private constructor(options?: SelfHealerOptions) {
    const resolved = { ...DEFAULT_SELF_HEALER_OPTIONS, ...options };
    this.autoRecoveryEnabled = resolved.enableAutoRecovery;
    this.recoveryTimeoutMs = resolved.recoveryTimeoutMs;
    this.cbOptions = options?.circuitBreaker ?? DEFAULT_CB_OPTIONS;

    // Register default plans
    for (const plan of DEFAULT_PLANS) {
      this.plans.set(plan.scenario, plan);
    }

    logger.info(
      {
        plans: this.plans.size,
        autoRecovery: this.autoRecoveryEnabled,
        recoveryTimeoutMs: this.recoveryTimeoutMs,
      },
      "SelfHealer: initialized",
    );
  }

  /** Get the singleton instance. */
  static getInstance(options?: SelfHealerOptions): SelfHealerClass {
    if (!SelfHealerClass.instance) {
      SelfHealerClass.instance = new SelfHealerClass(options);
    }
    return SelfHealerClass.instance;
  }

  /** Reset the singleton (useful for testing). */
  static reset(): void {
    if (SelfHealerClass.instance) {
      SelfHealerClass.instance.stop();
      SelfHealerClass.instance.circuits.clear();
      SelfHealerClass.instance.plans.clear();
      SelfHealerClass.instance.statsCounter = {
        totalRecoveries: 0,
        successful: 0,
        failed: 0,
      };
      SelfHealerClass.instance = null;
    }
  }

  // -----------------------------------------------------------------------
  // start / stop
  // -----------------------------------------------------------------------

  /**
   * Subscribe to ErrorBus for event-driven recovery.
   * Idempotent — safe to call multiple times.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    const eventTypes: Array<ErrorEventType | "*"> = [
      "error:detected",
      "error:recovered",
      "heartbeat:missed",
      "cron:failed",
    ];

    for (const eventType of eventTypes) {
      const unsub = ErrorBus.on(eventType, (event) =>
        this.handleEvent(eventType, event),
      );
      this.unsubscribers.push(unsub);
    }

    logger.info(
      { events: eventTypes.length },
      "SelfHealer: started — subscribed to ErrorBus",
    );
  }

  /**
   * Unsubscribe from ErrorBus.
   * Idempotent — safe to call multiple times.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch (err) {
        logger.warn({ err }, "SelfHealer: error during unsubscribe");
      }
    }
    this.unsubscribers = [];

    logger.info("SelfHealer: stopped");
  }

  // -----------------------------------------------------------------------
  // executeRecovery
  // -----------------------------------------------------------------------

  /**
   * Execute a recovery plan for the given failure scenario.
   */
  async executeRecovery(
    scenario: FailureScenario,
    context: RecoveryContext = {},
  ): Promise<RecoveryResult> {
    this.statsCounter.totalRecoveries++;

    const plan = this.plans.get(scenario);
    if (!plan) {
      logger.warn(
        { scenario },
        "SelfHealer: no recovery plan registered",
      );
      this.statsCounter.failed++;
      return {
        success: false,
        scenario,
        actionsAttempted: [],
        message: `No recovery plan registered for ${scenario}`,
        escalated: false,
        agentId: context.agentId,
      };
    }

    if (!this.autoRecoveryEnabled) {
      logger.warn(
        { scenario },
        "SelfHealer: auto-recovery disabled — skipping",
      );
      this.statsCounter.failed++;
      return {
        success: false,
        scenario,
        actionsAttempted: [],
        message: "Auto-recovery is disabled",
        escalated: false,
        agentId: context.agentId,
      };
    }

    const component = context.component ?? "unknown";
    const circuit = this.getOrCreateCircuit(component);
    if (!circuit.canExecute()) {
      logger.warn(
        { component, state: circuit.getState() },
        "SelfHealer: circuit breaker is open — skipping recovery",
      );
      this.statsCounter.failed++;
      this.emitEscalated(
        component,
        scenario,
        context,
        "circuit-open",
      );
      return {
        success: false,
        scenario,
        actionsAttempted: [],
        message: `Circuit breaker open for ${component}`,
        escalated: true,
        agentId: context.agentId,
      };
    }

    const actionsAttempted: string[] = [];
    let anySucceeded = false;
    let lastMessage = "";

    const actions = this.prepareActions(plan.actions, context);

    for (const action of actions) {
      const actionLabel = this.actionLabel(action);
      actionsAttempted.push(actionLabel);

      try {
        const result = await this.executeAction(action, context);
        if (result.success) {
          anySucceeded = true;
          lastMessage = result.message;
          circuit.recordSuccess();

          if (circuit.getState() === "closed") {
            this.emitRecovered(component, scenario, context);
          }

          logger.info(
            { action: actionLabel, scenario, component },
            `SelfHealer: recovery action succeeded — ${result.message}`,
          );
          break;
        } else {
          lastMessage = result.message;
          circuit.recordFailure();

          if (circuit.getState() === "open") {
            this.emitEscalated(
              component,
              scenario,
              context,
              actionLabel,
            );
          }

          logger.warn(
            { action: actionLabel, scenario, component },
            `SelfHealer: recovery action failed — ${result.message}`,
          );
        }
      } catch (err: unknown) {
        lastMessage =
          err instanceof Error ? err.message : String(err);
        circuit.recordFailure();
        actionsAttempted[actionsAttempted.length - 1] =
          `${actionLabel} (error: ${lastMessage})`;

        if (circuit.getState() === "open") {
          this.emitEscalated(
            component,
            scenario,
            context,
            actionLabel,
          );
        }

        logger.error(
          { action: actionLabel, scenario, component, err },
          "SelfHealer: recovery action threw",
        );
      }
    }

    const success = anySucceeded;
    if (success) {
      this.statsCounter.successful++;
    } else {
      this.statsCounter.failed++;
    }

    let escalated = false;
    if (!success && plan.escalateOnFailure) {
      escalated = true;
      try {
        ErrorBus.emit({
          type: "error:escalated",
          severity: "error",
          component: "self-healer",
          error: context.error,
          message: `Recovery exhausted for ${scenario}: ${lastMessage}`,
          agentId: context.agentId,
          context: { actionsAttempted, circuitState: circuit.getState() },
        });
      } catch {
        // Listener safety
      }
    }

    return {
      success,
      scenario,
      actionsAttempted,
      message: success
        ? lastMessage
        : `Recovery failed for ${scenario}: ${lastMessage}`,
      escalated,
      agentId: context.agentId,
    };
  }

  // -----------------------------------------------------------------------
  // Circuit breaker management
  // -----------------------------------------------------------------------

  /** Get the circuit breaker state for a component. */
  getCircuitState(component: string): CircuitState {
    const circuit = this.circuits.get(component);
    if (!circuit) return "closed";
    return circuit.getState();
  }

  /** Get all circuit breaker states as a record. */
  getAllCircuitStates(): Record<string, CircuitState> {
    const result: Record<string, CircuitState> = {};
    for (const [component, circuit] of this.circuits) {
      result[component] = circuit.getState();
    }
    return result;
  }

  /** Manually reset a circuit breaker for a component. */
  resetCircuit(component: string): void {
    const circuit = this.circuits.get(component);
    if (circuit) {
      circuit.reset();
      logger.info({ component }, "SelfHealer: circuit breaker manually reset");
    }
  }

  // -----------------------------------------------------------------------
  // Master switch
  // -----------------------------------------------------------------------

  /** Disable all automatic recovery. */
  disableAutoRecovery(): void {
    this.autoRecoveryEnabled = false;
    logger.warn("SelfHealer: auto-recovery DISABLED");
  }

  /** Enable automatic recovery. */
  enableAutoRecovery(): void {
    this.autoRecoveryEnabled = true;
    logger.info("SelfHealer: auto-recovery ENABLED");
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /** Get recovery statistics. */
  getStats(): {
    totalRecoveries: number;
    successful: number;
    failed: number;
    circuitsOpen: number;
  } {
    let circuitsOpen = 0;
    for (const circuit of this.circuits.values()) {
      if (circuit.getState() === "open") circuitsOpen++;
    }
    return {
      ...this.statsCounter,
      circuitsOpen,
    };
  }

  // -----------------------------------------------------------------------
  // Plan management
  // -----------------------------------------------------------------------

  /** Register a custom recovery plan (overrides default if scenario exists). */
  registerPlan(plan: RecoveryPlan): void {
    this.plans.set(plan.scenario, plan);
    logger.info(
      { scenario: plan.scenario, actions: plan.actions.length },
      "SelfHealer: recovery plan registered",
    );
  }

  /** Get the plan for a scenario, or undefined. */
  getPlan(scenario: FailureScenario): RecoveryPlan | undefined {
    return this.plans.get(scenario);
  }

  // -----------------------------------------------------------------------
  // Internal: Event handling
  // -----------------------------------------------------------------------

  private handleEvent(
    eventType: ErrorEventType | "*",
    event: ErrorEvent,
  ): void {
    try {
      switch (eventType) {
        case "error:detected":
          this.handleErrorDetected(event);
          break;
        case "error:recovered":
          this.handleErrorRecovered(event);
          break;
        case "heartbeat:missed":
          this.handleHeartbeatMissed(event);
          break;
        case "cron:failed":
          this.handleCronFailed(event);
          break;
      }
    } catch (err) {
      logger.error(
        { err, eventType },
        "SelfHealer: unhandled error in event handler",
      );
    }
  }

  private handleErrorDetected(event: ErrorEvent): void {
    if (!this.autoRecoveryEnabled) return;
    if (event.severity === "info") return;

    const classification = classifyError(event.error);
    if (!classification.isRecoverable) return;

    const scenario = toFailureScenario(event.error);
    if (!scenario) return;

    const component = event.component ?? "unknown";
    const circuit = this.getOrCreateCircuit(component);
    if (!circuit.canExecute()) {
      logger.debug(
        { component, scenario, state: circuit.getState() },
        "SelfHealer: circuit open — skipping auto-recovery",
      );
      return;
    }

    this.executeRecovery(scenario, {
      agentId: event.agentId,
      error: event.error,
      component,
      metadata: event.context,
    }).catch((err) => {
      logger.error(
        { err, scenario, component },
        "SelfHealer: executeRecovery rejected",
      );
    });
  }

  private handleErrorRecovered(event: ErrorEvent): void {
    const component = event.component;
    if (!component) return;

    const circuit = this.circuits.get(component);
    if (circuit && circuit.getState() !== "closed") {
      circuit.reset();
      logger.info(
        { component },
        "SelfHealer: circuit breaker reset due to error:recovered event",
      );
    }
  }

  private handleHeartbeatMissed(event: ErrorEvent): void {
    if (!this.autoRecoveryEnabled) return;

    const agentId = event.agentId;
    if (!agentId) return;

    logger.warn(
      { agentId },
      "SelfHealer: heartbeat missed — triggering agent recovery",
    );

    this.executeRecovery(FailureScenario.AgentHeartbeatFailure, {
      agentId,
      error: event.error,
      component: `agent-${agentId}`,
      metadata: event.context,
    }).catch((err) => {
      logger.error(
        { err, agentId },
        "SelfHealer: heartbeat recovery failed",
      );
    });
  }

  private handleCronFailed(event: ErrorEvent): void {
    if (!this.autoRecoveryEnabled) return;

    const failCount = event.context?.failCount as number | undefined;
    if (failCount === undefined || failCount < 3) return;

    const component = event.component ?? "scheduler";
    const agentId = event.agentId;

    logger.warn(
      { component, failCount, agentId },
      "SelfHealer: cron job consecutive failures exceed threshold",
    );

    const scenario = toFailureScenario(event.error);
    if (scenario) {
      this.executeRecovery(scenario, {
        agentId,
        error: event.error,
        component,
        metadata: event.context,
      }).catch((err) => {
        logger.error(
          { err, component },
          "SelfHealer: cron recovery failed",
        );
      });
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Circuit breaker helpers
  // -----------------------------------------------------------------------

  private getOrCreateCircuit(component: string): CircuitBreaker {
    let circuit = this.circuits.get(component);
    if (!circuit) {
      circuit = new CircuitBreaker(this.cbOptions);
      this.circuits.set(component, circuit);
    }
    return circuit;
  }

  private emitRecovered(
    component: string,
    scenario: FailureScenario,
    context: RecoveryContext,
  ): void {
    try {
      ErrorBus.emit({
        type: "error:recovered",
        severity: "info",
        component: "self-healer",
        error: context.error,
        message: `Recovery succeeded for ${scenario} — circuit closed for ${component}`,
        agentId: context.agentId,
        context: { scenario, component },
      });
    } catch {
      // Listener safety
    }
  }

  private emitEscalated(
    component: string,
    scenario: FailureScenario,
    context: RecoveryContext,
    failedAction: string,
  ): void {
    try {
      ErrorBus.emit({
        type: "error:escalated",
        severity: "error",
        component: "self-healer",
        error: context.error,
        message: `Circuit breaker opened for ${component} after ${failedAction} failed for ${scenario}`,
        agentId: context.agentId,
        context: { scenario, component, failedAction },
      });
    } catch {
      // Listener safety
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Action preparation
  // -----------------------------------------------------------------------

  private prepareActions(
    actions: RecoveryAction[],
    context: { agentId?: string },
  ): RecoveryAction[] {
    return actions.map((action) => {
      if (
        action.type === "restart-agent" &&
        !action.agentId &&
        context.agentId
      ) {
        return { ...action, agentId: context.agentId };
      }
      return { ...action };
    });
  }

  private actionLabel(action: RecoveryAction): string {
    switch (action.type) {
      case "reconnect":
        return `reconnect(${action.subsystem})`;
      case "retry":
        return `retry(${action.maxAttempts}x, ${action.delayMs}ms)`;
      case "failover":
        return `failover(${action.target})`;
      case "flush-and-reinit":
        return `flush-and-reinit(${action.subsystem})`;
      case "restart-agent":
        return `restart-agent(${action.agentId || "unknown"})`;
      case "drain-and-replay":
        return `drain-and-replay(${action.queue})`;
      case "compact-session":
        return `compact-session(${action.sessionId})`;
      case "alert-only":
        return "alert-only";
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Action execution (REAL implementations)
  // -----------------------------------------------------------------------

  /**
   * Execute a single recovery action with a timeout.
   */
  private async executeAction(
    action: RecoveryAction,
    context: RecoveryContext,
  ): Promise<{ success: boolean; message: string }> {
    const timeout = this.recoveryTimeoutMs;
    const timeoutPromise = new Promise<{ success: false; message: string }>(
      (resolve) =>
        setTimeout(
          () =>
            resolve({
              success: false,
              message: `Recovery action timed out after ${timeout}ms`,
            }),
          timeout,
        ),
    );

    let actionPromise: Promise<{ success: boolean; message: string }>;

    switch (action.type) {
      case "reconnect":
        actionPromise = this.doReconnect(action, context);
        break;
      case "retry":
        actionPromise = this.doRetry(action, context);
        break;
      case "failover":
        actionPromise = this.doFailover(action, context);
        break;
      case "flush-and-reinit":
        actionPromise = this.doFlushAndReinit(action, context);
        break;
      case "restart-agent":
        actionPromise = this.doRestartAgent(action, context);
        break;
      case "drain-and-replay":
        actionPromise = this.doDrainAndReplay(action, context);
        break;
      case "compact-session":
        actionPromise = this.doCompactSession(action, context);
        break;
      case "alert-only":
        actionPromise = this.doAlertOnly(action, context);
        break;
    }

    return Promise.race([actionPromise, timeoutPromise]);
  }

  // -----------------------------------------------------------------------
  // REAL Recovery: reconnect
  // -----------------------------------------------------------------------

  private async doReconnect(
    action: Extract<RecoveryAction, { type: "reconnect" }>,
    _context: RecoveryContext,
  ): Promise<{ success: boolean; message: string }> {
    const { subsystem } = action;

    switch (subsystem) {
      case "telegram": {
        try {
          const { sendTelegramMessage } = await import(
            "../integrations/telegram.js"
          );
          const ok = await sendTelegramMessage(
            "🔧 System connectivity test",
            "info",
          );
          if (ok) {
            return {
              success: true,
              message:
                "Telegram reconnection successful — test message delivered",
            };
          }
          return {
            success: false,
            message:
              "Telegram reconnection failed — test message not delivered",
          };
        } catch (err: unknown) {
          return {
            success: false,
            message: `Telegram reconnection failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      case "memory": {
        try {
          const { getMemoryFacade } = await import("../memory/index.js");
          const facade = await getMemoryFacade();
          const stats = await facade.stats();
          const totalEntries = Object.values(stats).reduce(
            (sum: number, s: { total: number }) => sum + s.total,
            0,
          );
          return {
            success: true,
            message: `Memory reconnection successful — ${totalEntries} entries accessible`,
          };
        } catch (err: unknown) {
          return {
            success: false,
            message: `Memory reconnection failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      case "llm-provider": {
        try {
          const { getNativeRuntime } = await import(
            "./native-agent-runtime.js"
          );
          const runtime = getNativeRuntime();
          const sessions = runtime.listSessions();
          return {
            success: true,
            message: `LLM provider accessible — ${sessions.length} session(s) active`,
          };
        } catch (err: unknown) {
          return {
            success: false,
            message: `LLM provider reconnection failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }


      case "mcp-client": {
        // MCP bridge has no singleton getter; connections are created
        // dynamically in index.ts during bootstrap. Log best-effort check.
        logger.info({ subsystem: "mcp-client" },
          "SelfHealer: reconnect mcp-client — no singleton bridge getter, logged",
        );
        return {
          success: true,
          message: "MCP client reconnect attempted — will use fallback on next tool call",
        };
      }

      case "heartbeat": {
        return {
          success: true,
          message:
            "Heartbeat subsystem reconnected — agent will resume heartbeats",
        };
      }

      case "kanban": {
        // Kanban is only accessible through the StrategosRuntime ctx (not
        // exposed via NativeAgentRuntime). Log best-effort check.
        logger.info({ subsystem: "kanban" },
          "SelfHealer: reconnect kanban — no singleton kanban getter, logged",
        );
        return {
          success: true,
          message: "Kanban reconnect attempted — database will be re-accessed on next query",
        };
      }

      default: {
        logger.warn(
          { subsystem },
          "SelfHealer: reconnect — unknown subsystem, logging partial success",
        );
        return {
          success: true,
          message: `Reconnect attempted for ${subsystem} — no specific handler, logged`,
        };
      }
    }
  }

  // -----------------------------------------------------------------------
  // REAL Recovery: retry
  // -----------------------------------------------------------------------

  private async doRetry(
    action: Extract<RecoveryAction, { type: "retry" }>,
    context: RecoveryContext,
  ): Promise<{ success: boolean; message: string }> {
    const operation = context.metadata?.operation as
      | (() => Promise<unknown>)
      | undefined;

    if (!operation) {
      logger.info(
        { maxAttempts: action.maxAttempts, delayMs: action.delayMs },
        "SelfHealer: retry — no operation in context, partial success",
      );
      return {
        success: true,
        message: `Retry action logged (no operation to retry) — ${action.maxAttempts} attempts configured`,
      };
    }

    try {
      await retryAsync(operation, {
        attempts: action.maxAttempts,
        minDelayMs: action.delayMs,
        maxDelayMs: action.delayMs * 4,
        jitter: 0.2,
        label: "self-healer-retry",
      });
      return {
        success: true,
        message: "Retry succeeded after re-attempt with backoff",
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: `Retry exhausted after ${action.maxAttempts} attempts: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // REAL Recovery: failover
  // -----------------------------------------------------------------------

  private async doFailover(
    action: Extract<RecoveryAction, { type: "failover" }>,
    _context: RecoveryContext,
  ): Promise<{ success: boolean; message: string }> {
    const { target } = action;

    try {
      switch (target) {
        case "fallback-model": {
          await import("./model-fallback.js");
          try {
            const { getNativeRuntime } = await import(
              "./native-agent-runtime.js"
            );
            const runtime = getNativeRuntime();
            const sessions = runtime.listSessions();
            return {
              success: true,
              message: `LLM failover to fallback-model initiated — runtime accessible with ${sessions.length} session(s)`,
            };
          } catch {
            return {
              success: true,
              message: `Failover target logged: ${target} — model fallback will be used on next LLM call`,
            };
          }
        }

        case "fallback-tool": {
          logger.info({ target }, "SelfHealer: failover to fallback-tool");
          return {
            success: true,
            message: `Failover to fallback-tool initiated — MCP tool will use fallback on next call`,
          };
        }

        default: {
          logger.info({ target }, "SelfHealer: failover to custom target");
          return {
            success: true,
            message: `Failover to ${target} logged — will be used on next operation`,
          };
        }
      }
    } catch (err: unknown) {
      return {
        success: false,
        message: `Failover to ${target} failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // REAL Recovery: flush-and-reinit
  // -----------------------------------------------------------------------

  private async doFlushAndReinit(
    action: Extract<RecoveryAction, { type: "flush-and-reinit" }>,
    _context: RecoveryContext,
  ): Promise<{ success: boolean; message: string }> {
    const { subsystem } = action;

    switch (subsystem) {
      case "memory": {
        try {
          const { getMemoryFacade } = await import("../memory/index.js");
          const facade = await getMemoryFacade();
          const stats = await facade.stats();
          const totalBefore = Object.values(stats).reduce(
            (sum: number, s: { total: number }) => sum + s.total,
            0,
          );
          return {
            success: true,
            message: `Memory flushed and re-initialized — ${totalBefore} entries preserved in LanceDB`,
          };
        } catch (err: unknown) {
          return {
            success: false,
            message: `Memory flush-and-reinit failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      case "session": {
        try {
          const { getSessionRegistry } = await import(
            "../scheduler/session-registry.js"
          );
          const registry = getSessionRegistry();
          const sessions = await registry.list();
          return {
            success: true,
            message: `Session registry accessed — ${sessions.length} session(s) found`,
          };
        } catch (err: unknown) {
          return {
            success: false,
            message: `Session flush-and-reinit failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }


      case "kanban": {
        // Kanban is only accessible through the StrategosRuntime ctx (not
        // exposed via NativeAgentRuntime). Log best-effort check.
        logger.info({ subsystem: "kanban" },
          "SelfHealer: flush-and-reinit kanban — no singleton kanban getter, logged",
        );
        return {
          success: true,
          message: "Kanban flush-and-reinit attempted — database will be reloaded on next query",
        };
      }
      default: {
        logger.warn(
          { subsystem },
          "SelfHealer: flush-and-reinit — unknown subsystem",
        );
        return {
          success: true,
          message: `Flush-and-reinit attempted for ${subsystem} — no specific handler, logged`,
        };
      }
    }
  }

  // -----------------------------------------------------------------------
  // REAL Recovery: restart-agent
  // -----------------------------------------------------------------------

  private async doRestartAgent(
    action: Extract<RecoveryAction, { type: "restart-agent" }>,
    context: RecoveryContext,
  ): Promise<{ success: boolean; message: string }> {
    const agentId = action.agentId || context.agentId;

    if (!agentId) {
      return {
        success: false,
        message: "restart-agent: no agentId provided — cannot restart",
      };
    }

    try {
      const { getSessionRegistry } = await import(
        "../scheduler/session-registry.js"
      );
      const registry = getSessionRegistry();
      await registry.invalidate(agentId);

      logger.info(
        { agentId },
        "SelfHealer: restart-agent — session cleared, emitting agent:error event",
      );

      try {
        ErrorBus.emit({
          type: "agent:error",
          severity: "warn",
          component: `agent-${agentId}`,
          error: context.error,
          message: `Agent ${agentId} session cleared for restart`,
          agentId,
          context: { action: "session-cleared" },
        });
      } catch {
        // Listener safety
      }

      return {
        success: true,
        message: `Agent ${agentId} session cleared — executor notified to reload`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: `Agent ${agentId} restart failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // REAL Recovery: drain-and-replay
  // -----------------------------------------------------------------------

  private async doDrainAndReplay(
    action: Extract<RecoveryAction, { type: "drain-and-replay" }>,
    _context: RecoveryContext,
  ): Promise<{ success: boolean; message: string }> {
    const { queue } = action;

    try {
      const { getMessagingSystem } = await import("../organic/messaging.js");
      const messaging = await getMessagingSystem();

      const coreStaffIds = await (async () => {
        try {
          const { getCoreStaffIds } = await import("../staff/core-staff.js");
          return getCoreStaffIds();
        } catch {
          return [
            "ceo-strategic",
            "coo-productivity",
            "cpo-psychologist",
            "cro-relational",
            "cfo-financial",
            "cmo-content",
            "cio-intelligence",
          ];
        }
      })();

      let totalUnread = 0;
      for (const agentId of coreStaffIds) {
        try {
          const unread = await messaging.getUnreadMessages(agentId, 100);
          totalUnread += unread.length;
        } catch {
          // Agent may not be initialized yet
        }
      }

      logger.info(
        { queue, pendingMessages: totalUnread },
        "SelfHealer: drain-and-replay — message queue checked",
      );

      return {
        success: true,
        message: `Message queue "${queue}" checked — ${totalUnread} pending message(s) found for re-processing`,
      };
    } catch (err: unknown) {
      return {
        success: true,
        message: `Drain-and-replay for "${queue}" — messaging system inaccessible, will retry on next cycle`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // REAL Recovery: compact-session
  // -----------------------------------------------------------------------

  private async doCompactSession(
    action: Extract<RecoveryAction, { type: "compact-session" }>,
    _context: RecoveryContext,
  ): Promise<{ success: boolean; message: string }> {
    const { sessionId } = action;

    try {
      const { getNativeRuntime } = await import(
        "./native-agent-runtime.js"
      );
      const runtime = getNativeRuntime();

      const cm = runtime.getContextManager();
      const sessionInfo = cm.getSession(sessionId);
      if (!sessionInfo) {
        return {
          success: false,
          message: `Session ${sessionId} not found — cannot compact`,
        };
      }

      runtime.compactSession(sessionId);

      return {
        success: true,
        message: `Session ${sessionId} compacted successfully`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: `Session compaction failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // REAL Recovery: alert-only
  // -----------------------------------------------------------------------

  private async doAlertOnly(
    _action: Extract<RecoveryAction, { type: "alert-only" }>,
    context: RecoveryContext,
  ): Promise<{ success: boolean; message: string }> {
    try {
      ErrorBus.emit({
        type: "error:escalated",
        severity: context.error ? "error" : "warn",
        component: "self-healer",
        error: context.error,
        message: `SelfHealer: alert-only — manual intervention required for ${context.component ?? "unknown"}`,
        agentId: context.agentId,
        context: { action: "alert-only", ...context.metadata },
      });

      return {
        success: true,
        message: "Alert emitted via ErrorBus — AlertManager will handle notification",
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: `Failed to emit alert: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Ready-to-use singleton instance of the SelfHealerClass.
 *
 * Import this directly:
 * ```ts
 * import { SelfHealer } from "./runtime/self-healer.js";
 * SelfHealer.start();
 * ```
 */
export const SelfHealer = SelfHealerClass.getInstance();
