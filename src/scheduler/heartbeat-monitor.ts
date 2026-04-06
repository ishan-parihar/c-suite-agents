/**
 * Heartbeat Monitor — watches for silent agents by polling the AgentHealthRegistry,
 * fires `heartbeat:missed` events via ErrorBus when agents go silent, and triggers
 * self-healing recovery.
 *
 * Design principles:
 * - Periodic polling with configurable interval
 * - Smart detection: only fire heartbeat:missed on FIRST detection of silence
 * - Recovery notification: fire heartbeat:ok when a previously-silent agent recovers
 * - Bounded check history (max 50 entries)
 * - Listener safety: no throwing from check loop
 * - Debug logging per cycle
 *
 * Usage:
 *   import { HeartbeatMonitor } from "./scheduler/heartbeat-monitor.js";
 *   HeartbeatMonitor.start();
 *
 * @module heartbeat-monitor
 */

import { logger } from "../logger.js";
import { ErrorBus } from "../runtime/error-emitter.js";
import { HeartbeatError } from "../runtime/error-types.js";
import { SelfHealer } from "../runtime/self-healer.js";
import { FailureScenario } from "../runtime/recovery.js";
import { getCoreStaffIds } from "../staff/core-staff.js";
import { getAgentHealthRegistry, type AgentHealth } from "./agent-health.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration options for the HeartbeatMonitor. */
export interface HeartbeatMonitorOptions {
  /** How often to check all agents (ms). Default: 60000 (1 min). */
  checkIntervalMs?: number;
  /** Time before an agent is considered silent (ms). Default: 1800000 (30 min). */
  silentThresholdMs?: number;
  /** Time before an agent is considered degraded (ms). Default: 900000 (15 min). */
  degradedThresholdMs?: number;
  /** Trigger SelfHealer recovery for silent agents. Default: true. */
  autoRecoverSilent?: boolean;
}

/** Result of a single health check cycle. */
export interface CheckResult {
  /** Epoch milliseconds when the check ran. */
  timestamp: number;
  /** Agents that are silent (no heartbeat AND no response beyond threshold). */
  silent: string[];
  /** Agents that are degraded (slow heartbeat or response). */
  degraded: string[];
  /** Agents in error state (consecutive failures >= 3). */
  errors: string[];
  /** Agents that are healthy. */
  healthy: string[];
}

/** History entry stored for each check cycle (without healthy list). */
export interface CheckHistoryEntry {
  timestamp: number;
  silent: string[];
  degraded: string[];
  errors: string[];
}

/** Tracks when an agent first went silent and whether it has been reported. */
interface SilentTracking {
  /** Epoch milliseconds when the agent first went silent in the current streak. */
  firstSilentAt: number;
  /** Whether a heartbeat:missed event has already been fired for this streak. */
  reported: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: Required<HeartbeatMonitorOptions> = {
  checkIntervalMs: 60_000, // 1 minute
  silentThresholdMs: 30 * 60 * 1000, // 30 minutes
  degradedThresholdMs: 15 * 60 * 1000, // 15 minutes
  autoRecoverSilent: true,
};

const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// HeartbeatMonitor Class
// ---------------------------------------------------------------------------

/**
 * Monitors agent health by periodically polling the AgentHealthRegistry.
 *
 * On each check cycle:
 * 1. Gets all core staff agent IDs
 * 2. Classifies each agent as silent, degraded, error, or healthy
 * 3. Fires heartbeat:missed events for newly-silent agents (once per streak)
 * 4. Fires heartbeat:ok events for healthy agents (with recovery metadata on rejoin)
 * 5. Triggers SelfHealer recovery for silent agents if autoRecoverSilent is enabled
 * 6. Stores the check result in bounded history
 */
export class HeartbeatMonitorClass {
  private static instance: HeartbeatMonitorClass | null = null;

  /** Timer handle from setInterval. */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Whether the monitor is currently running. */
  private running = false;

  /** Monitor configuration. */
  private options: Required<HeartbeatMonitorOptions>;

  /** Bounded check history (newest first). */
  private history: CheckHistoryEntry[] = [];

  /** Per-agent silence tracking for deduplication. */
  private silenceTracking: Map<string, SilentTracking> = new Map();

  private constructor(options?: HeartbeatMonitorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Get the singleton instance. */
  static getInstance(options?: HeartbeatMonitorOptions): HeartbeatMonitorClass {
    if (!HeartbeatMonitorClass.instance) {
      HeartbeatMonitorClass.instance = new HeartbeatMonitorClass(options);
    }
    return HeartbeatMonitorClass.instance;
  }

  /** Reset the singleton (useful for testing). */
  static reset(): void {
    if (HeartbeatMonitorClass.instance) {
      HeartbeatMonitorClass.instance.stop();
      HeartbeatMonitorClass.instance.history = [];
      HeartbeatMonitorClass.instance.silenceTracking.clear();
      HeartbeatMonitorClass.instance = null;
    }
  }

  // -----------------------------------------------------------------------
  // start / stop
  // -----------------------------------------------------------------------

  /**
   * Begin periodic health checks.
   * Idempotent — safe to call multiple times.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.timer = setInterval(() => {
      this.checkLoop();
    }, this.options.checkIntervalMs);

    // Ensure timer doesn't prevent process exit
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }

    logger.info(
      {
        checkIntervalMs: this.options.checkIntervalMs,
        silentThresholdMs: this.options.silentThresholdMs,
        degradedThresholdMs: this.options.degradedThresholdMs,
        autoRecoverSilent: this.options.autoRecoverSilent,
      },
      "HeartbeatMonitor: started",
    );
  }

  /**
   * Stop monitoring.
   * Idempotent — safe to call multiple times.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    logger.info("HeartbeatMonitor: stopped");
  }

  // -----------------------------------------------------------------------
  // checkNow
  // -----------------------------------------------------------------------

  /**
   * Run a manual health check immediately.
   *
   * @returns Classification of all agents.
   */
  async checkNow(): Promise<{
    silent: string[];
    degraded: string[];
    healthy: string[];
    errors: string[];
  }> {
    return this.runCheck();
  }

  // -----------------------------------------------------------------------
  // getCheckHistory
  // -----------------------------------------------------------------------

  /**
   * Retrieve recent check results.
   *
   * @param limit - Maximum number of entries to return (default: all).
   * @returns Check history entries, newest first.
   */
  getCheckHistory(limit?: number): CheckHistoryEntry[] {
    if (limit === undefined) return [...this.history];
    return this.history.slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // Internal: check loop
  // -----------------------------------------------------------------------

  /**
   * The periodic check loop. Wrapped in try/catch for listener safety —
   * no throwing from the interval callback.
   */
  private checkLoop(): void {
    try {
      this.runCheck().catch((err) => {
        logger.error(
          { err },
          "HeartbeatMonitor: checkLoop async error",
        );
      });
    } catch (err) {
      // Synchronous safety net
      logger.error(
        { err },
        "HeartbeatMonitor: checkLoop sync error",
      );
    }
  }

  /**
   * Core check logic: classify all agents, emit events, trigger recovery.
   */
  private async runCheck(): Promise<{
    silent: string[];
    degraded: string[];
    healthy: string[];
    errors: string[];
  }> {
    const now = Date.now();
    const registry = getAgentHealthRegistry();
    const agentIds = getCoreStaffIds();

    const silent: string[] = [];
    const degraded: string[] = [];
    const healthy: string[] = [];
    const errors: string[] = [];

    for (const agentId of agentIds) {
      const health = registry.getStatus(agentId);
      if (!health) {
        // Agent not yet registered — skip
        continue;
      }

      const classification = this.classifyAgent(health, now);

      switch (classification) {
        case "error":
          errors.push(agentId);
          break;
        case "silent":
          silent.push(agentId);
          break;
        case "degraded":
          degraded.push(agentId);
          break;
        case "healthy":
          healthy.push(agentId);
          break;
      }
    }

    // Process state transitions and emit events
    this.processTransitions(silent, healthy, now);

    // Trigger self-healing for silent agents
    if (this.options.autoRecoverSilent && silent.length > 0) {
      for (const agentId of silent) {
        this.triggerRecovery(agentId);
      }
    }

    // Store in bounded history
    const entry: CheckHistoryEntry = {
      timestamp: now,
      silent,
      degraded,
      errors,
    };
    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.pop();
    }

    logger.debug(
      {
        silent,
        degraded,
        healthy,
        errors,
        total: agentIds.length,
      },
      "HeartbeatMonitor: check cycle complete",
    );

    return { silent, degraded, healthy, errors };
  }

  // -----------------------------------------------------------------------
  // Internal: classification
  // -----------------------------------------------------------------------

  /**
   * Classify a single agent based on its health data.
   *
   * Priority order (highest to lowest):
   * 1. error: consecutiveFailures >= 3
   * 2. silent: lastResponse > silentThresholdMs AND lastHeartbeat > silentThresholdMs
   * 3. degraded: lastResponse > degradedThresholdMs OR lastHeartbeat > degradedThresholdMs
   * 4. healthy: everything else
   */
  private classifyAgent(health: AgentHealth, now: number): "error" | "silent" | "degraded" | "healthy" {
    // Error takes priority
    if (health.consecutiveFailures >= 3) {
      return "error";
    }

    const timeSinceResponse = now - health.lastResponse;
    const timeSinceHeartbeat = now - health.lastHeartbeat;

    // Silent: both response AND heartbeat are beyond silent threshold
    if (
      timeSinceResponse > this.options.silentThresholdMs &&
      timeSinceHeartbeat > this.options.silentThresholdMs
    ) {
      return "silent";
    }

    // Degraded: either response OR heartbeat is beyond degraded threshold
    if (
      timeSinceResponse > this.options.degradedThresholdMs ||
      timeSinceHeartbeat > this.options.degradedThresholdMs
    ) {
      return "degraded";
    }

    return "healthy";
  }

  // -----------------------------------------------------------------------
  // Internal: state transitions and event emission
  // -----------------------------------------------------------------------

  /**
   * Process transitions between check cycles.
   *
   * - Newly silent agents: fire heartbeat:missed (once per streak)
   * - Recovered agents (were silent, now healthy): fire heartbeat:ok with recovery metadata
   * - Currently healthy agents: fire heartbeat:ok (observability)
   * - Agents no longer silent (degraded/error): clear stale tracking
   */
  private processTransitions(
    silent: string[],
    healthy: string[],
    now: number,
  ): void {
    const silentSet = new Set(silent);

    // --- Handle agents that are currently silent ---
    for (const agentId of silent) {
      let tracking = this.silenceTracking.get(agentId);

      if (tracking === undefined) {
        // Agent just went silent — start tracking
        tracking = {
          firstSilentAt: now,
          reported: false,
        };
        this.silenceTracking.set(agentId, tracking);
      }

      // Fire heartbeat:missed only on first detection of this streak
      if (!tracking.reported) {
        const health = getAgentHealthRegistry().getStatus(agentId);
        const silentDuration = now - tracking.firstSilentAt;

        const err = new HeartbeatError(
          `Agent ${agentId} has been silent for ${Math.round(silentDuration / 1000)}s`,
          {
            agentId,
            missedCount: Math.floor(
              silentDuration / this.options.checkIntervalMs,
            ),
            lastHeartbeatAt: health?.lastHeartbeat,
            severity: "warn",
            metadata: {
              silentDurationMs: silentDuration,
              firstSilentAt: tracking.firstSilentAt,
            },
          },
        );

        ErrorBus.emit({
          type: "heartbeat:missed",
          severity: "warn",
          component: "heartbeat-monitor",
          error: err,
          message: `Heartbeat missed for agent ${agentId}`,
          agentId,
          context: {
            silentDurationMs: silentDuration,
            firstSilentAt: tracking.firstSilentAt,
          },
        });

        tracking.reported = true;
      }
    }

    // --- Handle agents that are currently healthy ---
    for (const agentId of healthy) {
      const tracking = this.silenceTracking.get(agentId);

      if (tracking !== undefined) {
        // Agent recovered from silence — emit one-time recovery event
        const silentDuration = now - tracking.firstSilentAt;

        ErrorBus.emit({
          type: "heartbeat:ok",
          severity: "info",
          component: "heartbeat-monitor",
          error: null,
          message: `Agent ${agentId} recovered from silence after ${Math.round(silentDuration / 1000)}s`,
          agentId,
          context: {
            recovered: true,
            silentDurationMs: silentDuration,
            firstSilentAt: tracking.firstSilentAt,
          },
        });

        // Clear the silence tracking
        this.silenceTracking.delete(agentId);
      } else {
        // Agent is healthy and was not silent — regular observability event
        ErrorBus.emit({
          type: "heartbeat:ok",
          severity: "info",
          component: "heartbeat-monitor",
          error: null,
          message: `Agent ${agentId} heartbeat ok`,
          agentId,
        });
      }
    }

    // --- Clear stale tracking for agents no longer silent ---
    // Agents in degraded or error state: remove tracking so a return to
    // silent triggers a fresh heartbeat:missed event.
    for (const [agentId, tracking] of this.silenceTracking.entries()) {
      if (!silentSet.has(agentId)) {
        // Agent left the silent state (became degraded or error)
        // Fire a recovery note if the agent had been reported
        if (tracking.reported) {
          const silentDuration = now - tracking.firstSilentAt;
          ErrorBus.emit({
            type: "heartbeat:ok",
            severity: "info",
            component: "heartbeat-monitor",
            error: null,
            message: `Agent ${agentId} left silent state (now degraded/error) after ${Math.round(silentDuration / 1000)}s`,
            agentId,
            context: {
              recovered: false,
              silentDurationMs: silentDuration,
              firstSilentAt: tracking.firstSilentAt,
              reason: "state-changed",
            },
          });
        }
        this.silenceTracking.delete(agentId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal: recovery
  // -----------------------------------------------------------------------

  /**
   * Trigger self-healing recovery for a silent agent.
   * Uses the SelfHealer's AgentHeartbeatFailure plan.
   */
  private triggerRecovery(agentId: string): void {
    const tracking = this.silenceTracking.get(agentId);
    const silentDuration =
      tracking !== undefined
        ? Date.now() - tracking.firstSilentAt
        : undefined;

    logger.warn(
      { agentId, silentDurationMs: silentDuration },
      "HeartbeatMonitor: triggering self-healing recovery for silent agent",
    );

    SelfHealer.executeRecovery(FailureScenario.AgentHeartbeatFailure, {
      agentId,
      component: `agent-${agentId}`,
      metadata: {
        triggeredBy: "heartbeat-monitor",
        silentDurationMs: silentDuration,
        firstSilentAt: tracking?.firstSilentAt,
      },
    }).catch((err) => {
      logger.error(
        { err, agentId },
        "HeartbeatMonitor: recovery execution failed",
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Ready-to-use singleton instance of the HeartbeatMonitorClass.
 *
 * Import this directly:
 * ```ts
 * import { HeartbeatMonitor } from "./scheduler/heartbeat-monitor.js";
 * HeartbeatMonitor.start();
 * ```
 */
export const HeartbeatMonitor = HeartbeatMonitorClass.getInstance();
