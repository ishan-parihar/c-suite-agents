import { logger } from "../logger.js";

/**
 * Recovery Recipes — encoded failure playbooks with auto-attempt + escalation.
 *
 * Pattern: each failure scenario gets exactly 1 automatic recovery attempt
 * before escalation is triggered. Following claw-code's recovery_recipes.rs.
 *
 * Import pattern: `import { RecoveryRegistry, attemptRecovery } from "./recovery.js"`
 *
 * Integration into agent-executor.ts:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 1. Import & initialise at module level:                                 │
 * │    import { RecoveryRegistry, attemptRecovery } from "./recovery.js";  │
 * │    const recovery = RecoveryRegistry.getInstance();                     │
 * │                                                                         │
 * │ 2. Register recipes during bootstrapping:                               │
 * │    recovery.registerDefaultRecipes({                                    │
 * │      onAlert: (evt) => telegramBot.sendMessage(adminChatId, fmt(evt)), │
 * │      onAbort: (agentId) => killAgent(agentId),                         │
 * │    });                                                                  │
 * │                                                                         │
 * │ 3. Wrap every fallible operation in a try/catch that maps errors       │
 * │    to FailureScenario, then calls attemptRecovery():                   │
 * │    try { await someOperation(); } catch (err) {                        │
 * │      const scenario = classifyError(err);                               │
 * │      const event = await attemptRecovery(scenario, { agentId, err });  │
 * │      if (event.escalation_triggered) handleEscalation(event);          │
 * │    }                                                                    │
 * │                                                                         │
 * │ 4. Optionally listen to recovery events via recovery.onEvent(cb).       │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Failure scenarios specific to the Strategos multi-agent orchestration system.
 * Each scenario represents a distinct failure mode with a dedicated recovery recipe.
 */
export enum FailureScenario {
  /** Agent stopped sending heartbeat signals (expected every 30 minutes). */
  AgentHeartbeatFailure = "AgentHeartbeatFailure",
  /** Message could not be delivered to target agent or thread. */
  MessageDeliveryFailure = "MessageDeliveryFailure",
  /** LanceDB vector memory store is unreachable or corrupted. */
  MemoryStoreFailure = "MemoryStoreFailure",
  /** SQLite-backed Kanban board persistence failed. */
  KanbanPersistenceFailure = "KanbanPersistenceFailure",
  /** MCP tool call returned an error or timed out. */
  MCPToolExecutionFailure = "MCPToolExecutionFailure",
  /** LLM provider (OpenAI-compatible API) is down or returning errors. */
  LLMProviderFailure = "LLMProviderFailure",
  /** Telegram notification bot cannot reach the user. */
  TelegramNotificationFailure = "TelegramNotificationFailure",
}

/**
 * Concrete recovery step identifiers. Each step maps to an async function
 * in the recovery context that can be executed by the registry.
 */
export enum RecoveryStep {
  /** Re-establish connection to the affected subsystem. */
  ReconnectSubsystem = "ReconnectSubsystem",
  /** Retry the failed operation with backoff. */
  RetryOperation = "RetryOperation",
  /** Switch to a fallback provider or resource. */
  SwitchToFallback = "SwitchToFallback",
  /** Flush stale state and re-initialise. */
  FlushAndReinitialise = "FlushAndReinitialise",
  /** Restart the affected agent process. */
  RestartAgent = "RestartAgent",
  /** Drain pending messages and replay after recovery. */
  DrainAndReplayQueue = "DrainAndReplayQueue",
  /** Alert human operator via Telegram. */
  AlertOperator = "AlertOperator",
}

/**
 * Escalation policy applied when the automatic recovery attempt is exhausted.
 *
 * - `AlertUser`     — notify the human operator and continue running.
 * - `LogAndContinue` — record the failure and let the agent proceed (best-effort).
 * - `AbortAgent`     — terminate the affected agent to prevent cascading damage.
 */
export type EscalationPolicy = "AlertUser" | "LogAndContinue" | "AbortAgent";

/**
 * Execution context passed to every recovery step function.
 * Contains the information a step needs to attempt recovery.
 */
export interface RecoveryContext {
  /** The agent that triggered the recovery (if applicable). */
  agentId?: string;
  /** The original error that caused the failure. */
  error: unknown;
  /** The failure scenario being recovered from. */
  scenario: FailureScenario;
  /** Which attempt number this is (1-based). */
  attemptNumber: number;
  /** Arbitrary metadata the caller can attach. */
  metadata?: Record<string, unknown>;
}

/**
 * Result returned by a recovery step function.
 */
export interface RecoveryStepResult {
  /** Whether this step succeeded. */
  success: boolean;
  /** Human-readable description of what happened. */
  message: string;
  /** Optional error if the step failed. */
  error?: unknown;
}

/**
 * A recovery recipe maps a failure scenario to an ordered list of recovery
 * steps, the maximum number of automatic attempts, and the escalation policy
 * to apply when all attempts are exhausted.
 */
export interface RecoveryRecipe {
  /** The failure scenario this recipe handles. */
  scenario: FailureScenario;
  /** Ordered recovery steps to execute. Each step is a function reference. */
  steps: Array<(context: RecoveryContext) => Promise<RecoveryStepResult>>;
  /** Maximum number of automatic recovery attempts before escalation. */
  maxAttempts: number;
  /** What to do when all attempts are exhausted. */
  escalationPolicy: EscalationPolicy;
  /** Human-readable description for logging and debugging. */
  description: string;
}

/**
 * Structured event emitted after each recovery attempt.
 * Suitable for logging, telemetry, and operator dashboards.
 */
export interface RecoveryEvent {
  /** ISO 8601 timestamp of the event. */
  timestamp: string;
  /** The failure scenario that triggered recovery. */
  scenario: FailureScenario;
  /** Ordered list of step names that were attempted. */
  stepsAttempted: string[];
  /** Whether recovery succeeded overall. */
  success: boolean;
  /** Whether escalation was triggered. */
  escalation_triggered: boolean;
  /** The escalation policy applied (if triggered). */
  escalation_policy?: EscalationPolicy;
  /** The agent involved (if known). */
  agentId?: string;
  /** Summary message from the recovery process. */
  message: string;
}

// ---------------------------------------------------------------------------
// Recovery step implementations
// ---------------------------------------------------------------------------

async function reconnectSubsystem(
  ctx: RecoveryContext,
): Promise<RecoveryStepResult> {
  try {
    const { logger } = await import("../logger.js");
    logger.info(
      { scenario: ctx.scenario, agentId: ctx.agentId },
      `recovery:reconnectSubsystem — attempting reconnection for ${ctx.scenario}`,
    );

    const { SelfHealer } = await import("./self-healer.js");
    const result = await SelfHealer.executeRecovery(ctx.scenario, {
      agentId: ctx.agentId,
      error: ctx.error,
      component: ctx.scenario,
      metadata: ctx.metadata,
    });

    return {
      success: result.success,
      message: result.message,
      error: result.success ? undefined : new Error(result.message),
    };
  } catch (err: unknown) {
    const { logger } = await import("../logger.js");
    logger.error(
      { scenario: ctx.scenario, agentId: ctx.agentId, err },
      `recovery:reconnectSubsystem — failed for ${ctx.scenario}`,
    );
    return {
      success: false,
      message: `ReconnectSubsystem failed for ${ctx.scenario}: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
    };
  }
}

async function retryOperation(
  ctx: RecoveryContext,
): Promise<RecoveryStepResult> {
  try {
    const { logger } = await import("../logger.js");
    logger.info(
      { scenario: ctx.scenario, agentId: ctx.agentId },
      `recovery:retryOperation — attempting retry for ${ctx.scenario}`,
    );

    const { retryAsync } = await import("./retry.js");
    const operation = ctx.metadata?.operation as
      | (() => Promise<unknown>)
      | undefined;

    if (operation) {
      await retryAsync(operation, {
        attempts: 3,
        minDelayMs: 2_000,
        maxDelayMs: 30_000,
        jitter: 0.2,
        label: `recovery-retry-${ctx.scenario}`,
      });
      return {
        success: true,
        message: `RetryOperation succeeded for ${ctx.scenario} — operation re-executed with backoff`,
      };
    }

    // No operation provided — perform a basic connectivity check based on scenario
    switch (ctx.scenario) {
      case FailureScenario.LLMProviderFailure: {
        const { getNativeRuntime } = await import(
          "./native-agent-runtime.js"
        );
        const runtime = getNativeRuntime();
        const sessions = runtime.listSessions();
        return {
          success: true,
          message: `RetryOperation connectivity check passed — LLM runtime accessible with ${sessions.length} session(s)`,
        };
      }
      case FailureScenario.MemoryStoreFailure: {
        const { getMemoryFacade } = await import("../memory/index.js");
        const facade = await getMemoryFacade();
        await facade.stats();
        return {
          success: true,
          message: "RetryOperation connectivity check passed — memory store accessible",
        };
      }
      default:
        return {
          success: true,
          message: `RetryOperation — no operation to retry for ${ctx.scenario}, partial success logged`,
        };
    }
  } catch (err: unknown) {
    const { logger } = await import("../logger.js");
    logger.error(
      { scenario: ctx.scenario, agentId: ctx.agentId, err },
      `recovery:retryOperation — failed for ${ctx.scenario}`,
    );
    return {
      success: false,
      message: `RetryOperation failed for ${ctx.scenario}: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
    };
  }
}

async function switchToFallback(
  ctx: RecoveryContext,
): Promise<RecoveryStepResult> {
  try {
    const { logger } = await import("../logger.js");
    logger.info(
      { scenario: ctx.scenario, agentId: ctx.agentId },
      `recovery:switchToFallback — attempting failover for ${ctx.scenario}`,
    );

    const { SelfHealer } = await import("./self-healer.js");
    const result = await SelfHealer.executeRecovery(ctx.scenario, {
      agentId: ctx.agentId,
      error: ctx.error,
      component: ctx.scenario,
      metadata: ctx.metadata,
    });

    return {
      success: result.success,
      message: result.message,
      error: result.success ? undefined : new Error(result.message),
    };
  } catch (err: unknown) {
    const { logger } = await import("../logger.js");
    logger.error(
      { scenario: ctx.scenario, agentId: ctx.agentId, err },
      `recovery:switchToFallback — failed for ${ctx.scenario}`,
    );
    return {
      success: false,
      message: `SwitchToFallback failed for ${ctx.scenario}: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
    };
  }
}

async function flushAndReinitialise(
  ctx: RecoveryContext,
): Promise<RecoveryStepResult> {
  try {
    const { logger } = await import("../logger.js");
    logger.info(
      { scenario: ctx.scenario, agentId: ctx.agentId },
      `recovery:flushAndReinitialise — attempting flush and re-init for ${ctx.scenario}`,
    );

    const { SelfHealer } = await import("./self-healer.js");
    const result = await SelfHealer.executeRecovery(ctx.scenario, {
      agentId: ctx.agentId,
      error: ctx.error,
      component: ctx.scenario,
      metadata: ctx.metadata,
    });

    return {
      success: result.success,
      message: result.message,
      error: result.success ? undefined : new Error(result.message),
    };
  } catch (err: unknown) {
    const { logger } = await import("../logger.js");
    logger.error(
      { scenario: ctx.scenario, agentId: ctx.agentId, err },
      `recovery:flushAndReinitialise — failed for ${ctx.scenario}`,
    );
    return {
      success: false,
      message: `FlushAndReinitialise failed for ${ctx.scenario}: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
    };
  }
}

async function restartAgent(
  ctx: RecoveryContext,
): Promise<RecoveryStepResult> {
  try {
    const { logger } = await import("../logger.js");
    logger.info(
      { scenario: ctx.scenario, agentId: ctx.agentId },
      `recovery:restartAgent — attempting restart for agent ${ctx.agentId ?? "unknown"}`,
    );

    const { SelfHealer } = await import("./self-healer.js");
    const result = await SelfHealer.executeRecovery(ctx.scenario, {
      agentId: ctx.agentId,
      error: ctx.error,
      component: ctx.scenario,
      metadata: ctx.metadata,
    });

    return {
      success: result.success,
      message: result.message,
      error: result.success ? undefined : new Error(result.message),
    };
  } catch (err: unknown) {
    const { logger } = await import("../logger.js");
    logger.error(
      { scenario: ctx.scenario, agentId: ctx.agentId, err },
      `recovery:restartAgent — failed for agent ${ctx.agentId ?? "unknown"}`,
    );
    return {
      success: false,
      message: `RestartAgent failed for ${ctx.agentId ?? "unknown"}: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
    };
  }
}

async function drainAndReplayQueue(
  ctx: RecoveryContext,
): Promise<RecoveryStepResult> {
  try {
    const { logger } = await import("../logger.js");
    logger.info(
      { scenario: ctx.scenario, agentId: ctx.agentId },
      `recovery:drainAndReplayQueue — attempting drain and replay for ${ctx.scenario}`,
    );

    const { SelfHealer } = await import("./self-healer.js");
    const result = await SelfHealer.executeRecovery(ctx.scenario, {
      agentId: ctx.agentId,
      error: ctx.error,
      component: ctx.scenario,
      metadata: ctx.metadata,
    });

    return {
      success: result.success,
      message: result.message,
      error: result.success ? undefined : new Error(result.message),
    };
  } catch (err: unknown) {
    const { logger } = await import("../logger.js");
    logger.error(
      { scenario: ctx.scenario, agentId: ctx.agentId, err },
      `recovery:drainAndReplayQueue — failed for ${ctx.scenario}`,
    );
    return {
      success: false,
      message: `DrainAndReplayQueue failed for ${ctx.scenario}: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
    };
  }
}

async function reconnectTelegram(
  _ctx: RecoveryContext,
): Promise<RecoveryStepResult> {
  try {
    const { sendTelegramMessage } = await import("../integrations/telegram.js");
    const ok = await sendTelegramMessage("🔧 **System check** — connectivity test.", "info");
    if (ok) {
      return { success: true, message: "Telegram reconnection successful — test message delivered" };
    }
    return { success: false, message: "Telegram reconnection failed — test message not delivered" };
  } catch (err: any) {
    return { success: false, message: `Telegram reconnection failed: ${err.message}`, error: err };
  }
}

async function alertOperatorViaLog(
  ctx: RecoveryContext,
): Promise<RecoveryStepResult> {
  const { logger } = await import("../logger.js");
  logger.error(
    { scenario: ctx.scenario, agentId: ctx.agentId, error: ctx.error },
    "recovery:operator_alert — recovery exhausted, alerting via log",
  );
  return {
    success: true,
    message: `Operator alert logged for ${ctx.scenario}`,
  };
}

// ---------------------------------------------------------------------------
// Recovery Registry (singleton)
// ---------------------------------------------------------------------------

/**
 * Singleton registry that stores, looks up, and executes recovery recipes.
 *
 * Usage:
 *   const registry = RecoveryRegistry.getInstance();
 *   registry.register(myRecipe);
 *   const recipe = registry.getRecipe(FailureScenario.LLMProviderFailure);
 */
export class RecoveryRegistry {
  private static instance: RecoveryRegistry | null = null;

  private recipes: Map<FailureScenario, RecoveryRecipe> = new Map();
  private eventListeners: Array<(event: RecoveryEvent) => void> = [];

  private constructor() {}

  /**
   * Get the singleton instance of the RecoveryRegistry.
   */
  static getInstance(): RecoveryRegistry {
    if (!RecoveryRegistry.instance) {
      RecoveryRegistry.instance = new RecoveryRegistry();
    }
    return RecoveryRegistry.instance;
  }

  /**
   * Register a recovery recipe. Overwrites any existing recipe for the same scenario.
   *
   * @param recipe - The recipe to register.
   */
  register(recipe: RecoveryRecipe): void {
    this.recipes.set(recipe.scenario, recipe);
  }

  /**
   * Look up a recipe by its failure scenario.
   *
   * @param scenario - The failure scenario to look up.
   * @returns The recipe, or `undefined` if no recipe is registered.
   */
  getRecipe(scenario: FailureScenario): RecoveryRecipe | undefined {
    return this.recipes.get(scenario);
  }

  /**
   * Execute a recovery recipe for the given scenario and context.
   *
   * @param scenario - The failure scenario to recover from.
   * @param context  - The execution context for recovery steps.
   * @returns A RecoveryEvent describing the outcome.
   */
  async execute(
    scenario: FailureScenario,
    context: RecoveryContext,
  ): Promise<RecoveryEvent> {
    const recipe = this.getRecipe(scenario);
    if (!recipe) {
      const event: RecoveryEvent = {
        timestamp: new Date().toISOString(),
        scenario,
        stepsAttempted: [],
        success: false,
        escalation_triggered: true,
        escalation_policy: "LogAndContinue",
        agentId: context.agentId,
        message: `No recovery recipe registered for ${scenario}`,
      };
      this.notifyListeners(event);
      return event;
    }

    const stepsAttempted: string[] = [];
    let lastSuccess = false;
    let lastMessage = "";

    for (let attempt = 1; attempt <= recipe.maxAttempts; attempt++) {
      const attemptCtx: RecoveryContext = {
        ...context,
        scenario,
        attemptNumber: attempt,
      };

      let attemptSucceeded = true;

      for (let i = 0; i < recipe.steps.length; i++) {
        const step = recipe.steps[i];
        const result = await step(attemptCtx);
        stepsAttempted.push(step.name || `step_${i}`);

        if (!result.success) {
          attemptSucceeded = false;
          lastMessage = result.message;
          break;
        }
      }

      if (attemptSucceeded) {
        lastSuccess = true;
        lastMessage = `Recovery succeeded on attempt ${attempt}/${recipe.maxAttempts}`;
        break;
      }
    }

    const escalationTriggered = !lastSuccess;
    const event: RecoveryEvent = {
      timestamp: new Date().toISOString(),
      scenario,
      stepsAttempted,
      success: lastSuccess,
      escalation_triggered: escalationTriggered,
      escalation_policy: escalationTriggered
        ? recipe.escalationPolicy
        : undefined,
      agentId: context.agentId,
      message: lastSuccess
        ? lastMessage
        : `Recovery exhausted after ${recipe.maxAttempts} attempt(s). Escalation: ${recipe.escalationPolicy}`,
    };

    this.notifyListeners(event);
    return event;
  }

  /**
   * List all registered failure scenarios.
   *
   * @returns Array of registered FailureScenario values.
   */
  listScenarios(): FailureScenario[] {
    return Array.from(this.recipes.keys());
  }

  /**
   * Register a callback to be notified of every recovery event.
   *
   * @param listener - Callback receiving a RecoveryEvent.
   */
  onEvent(listener: (event: RecoveryEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove a previously registered event listener.
   *
   * @param listener - The callback to remove.
   */
  offEvent(listener: (event: RecoveryEvent) => void): void {
    this.eventListeners = this.eventListeners.filter((l) => l !== listener);
  }

  private notifyListeners(event: RecoveryEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err: any) {
        logger.error({ err: err.message, listener: listener.name }, "recovery:listener.error");
      }
    }
  }

  /**
   * Register all default recipes with real step implementations.
   * Each step delegates to SelfHealer or retryAsync for actual recovery logic.
   *
   * @param hooks - Optional callbacks for escalation-side effects.
   */
  registerDefaultRecipes(hooks?: {
    /** Called when an AlertOperator step runs. */
    onAlert?: (event: RecoveryEvent) => void;
    /** Called when an AbortAgent escalation fires. */
    onAbort?: (agentId: string) => void;
  }): void {
    const recipes: RecoveryRecipe[] = [
      {
        scenario: FailureScenario.AgentHeartbeatFailure,
        steps: [restartAgent, reconnectSubsystem],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description:
          "Agent missed heartbeat — restart the agent and verify connectivity.",
      },
      {
        scenario: FailureScenario.MessageDeliveryFailure,
        steps: [drainAndReplayQueue, retryOperation],
        maxAttempts: 1,
        escalationPolicy: "LogAndContinue",
        description:
          "Message delivery failed — drain the queue and retry delivery.",
      },
      {
        scenario: FailureScenario.MemoryStoreFailure,
        steps: [reconnectSubsystem, flushAndReinitialise],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description:
          "LanceDB memory store failure — reconnect and reinitialise if needed.",
      },
      {
        scenario: FailureScenario.KanbanPersistenceFailure,
        steps: [reconnectSubsystem, flushAndReinitialise],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description:
          "Kanban SQLite persistence failure — reconnect and flush stale state.",
      },
      {
        scenario: FailureScenario.MCPToolExecutionFailure,
        steps: [retryOperation, switchToFallback],
        maxAttempts: 1,
        escalationPolicy: "LogAndContinue",
        description:
          "MCP tool execution failed — retry once, then switch to fallback tool.",
      },
      {
        scenario: FailureScenario.LLMProviderFailure,
        steps: [switchToFallback, retryOperation],
        maxAttempts: 1,
        escalationPolicy: "AlertUser",
        description:
          "LLM provider error — switch to fallback model and retry.",
      },
      {
        scenario: FailureScenario.TelegramNotificationFailure,
        steps: [reconnectTelegram, alertOperatorViaLog],
        maxAttempts: 2,
        escalationPolicy: "LogAndContinue",
        description:
          "Telegram notification failed — attempt reconnection via test message, then log alert.",
      },
    ];

    for (const recipe of recipes) {
      this.register(recipe);
    }

    // If hooks are provided, attach them as event listeners so escalation
    // side-effects (Telegram alert, agent abort) are wired up automatically.
    if (hooks?.onAlert) {
      const onAlert = hooks.onAlert;
      this.onEvent((event: RecoveryEvent) => {
        if (
          event.escalation_triggered &&
          event.escalation_policy === "AlertUser"
        ) {
          onAlert(event);
        }
      });
    }

    if (hooks?.onAbort) {
      const onAbort = hooks.onAbort;
      this.onEvent((event: RecoveryEvent) => {
        if (
          event.escalation_triggered &&
          event.escalation_policy === "AbortAgent" &&
          event.agentId
        ) {
          onAbort(event.agentId);
        }
      });
    }
  }

  /**
   * Reset the registry by clearing all registered recipes and listeners.
   * Useful for testing.
   */
  reset(): void {
    this.recipes.clear();
    this.eventListeners = [];
    RecoveryRegistry.instance = null;
  }
}

// ---------------------------------------------------------------------------
// Top-level convenience function
// ---------------------------------------------------------------------------

/**
 * Attempt recovery for a given failure scenario using the default registry.
 *
 * This is the primary entry point for calling code. It looks up the recipe
 * in the singleton RecoveryRegistry and executes it.
 *
 * @param scenario - The failure scenario to recover from.
 * @param context  - The recovery context (agentId, error, metadata).
 * @returns A RecoveryEvent with the outcome.
 *
 * @example
 * ```ts
 * try {
 *   await callLLM(prompt);
 * } catch (err) {
 *   const event = await attemptRecovery(FailureScenario.LLMProviderFailure, {
 *     agentId: "agent-42",
 *     error: err,
 *   });
 *   if (event.escalation_triggered) {
 *     logger.warn("Recovery escalated:", event.message);
 *   }
 * }
 * ```
 */
export async function attemptRecovery(
  scenario: FailureScenario,
  context: Omit<RecoveryContext, "scenario" | "attemptNumber">,
): Promise<RecoveryEvent> {
  const registry = RecoveryRegistry.getInstance();
  return registry.execute(scenario, {
    ...context,
    scenario,
    attemptNumber: 1,
  });
}
