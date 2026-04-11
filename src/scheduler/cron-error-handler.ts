/**
 * CronErrorHandler — watches cron job failures from the AgentScheduler,
 * fires `cron:failed` events via ErrorBus, and triggers recovery when
 * consecutive failures exceed thresholds.
 *
 * Design principles:
 * - Subscribes to ErrorBus for `cron:failed` and `cron:success` events (loose coupling)
 * - Tracks per-job state: consecutiveFailures, totalFailures, timestamps
 * - Fires enriched `cron:failed` events when failureThreshold is exceeded
 * - Triggers SelfHealer recovery when autoRecover is enabled
 * - Emits `error:escalated` when maxFailuresBeforeDisable is reached
 * - Resets consecutiveFailures on `cron:success` events
 * - Listener safety: no throwing from event handlers
 * - Cooldown enforcement to prevent alert spam
 *
 * Usage:
 *   import { CronErrorHandler } from "./scheduler/cron-error-handler";
 *   CronErrorHandler.start();
 *
 * @module cron-error-handler
 */

import { logger } from "../logger";
import { ErrorBus } from "../runtime/error-emitter";
import type { ErrorEvent } from "../runtime/error-emitter";
import { CronJobError } from "../runtime/error-types";
import { SelfHealer } from "../runtime/self-healer";
import { FailureScenario } from "../runtime/recovery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration options for the CronErrorHandler. */
export interface CronErrorHandlerOptions {
  /** Alert after N consecutive failures. Default: 3. */
  failureThreshold?: number;
  /** Auto-disable job after N failures. Default: 10. */
  maxFailuresBeforeDisable?: number;
  /** Min time (ms) between alerts for same job. Default: 300000 (5 min). */
  cooldownMs?: number;
  /** Trigger SelfHealer recovery when threshold exceeded. Default: true. */
  autoRecover?: boolean;
  /** Auto-disable chronically failing jobs. Default: false. */
  autoDisable?: boolean;
}

/** Internal tracking state for a single cron job. */
export interface CronJobState {
  /** The unique job identifier. */
  jobId: string;
  /** Number of consecutive failures without an intervening success. */
  consecutiveFailures: number;
  /** Total failures recorded since tracking began. */
  totalFailures: number;
  /** Epoch milliseconds of the most recent failure. */
  lastFailureAt?: number;
  /** Epoch milliseconds of the most recent success. */
  lastSuccessAt?: number;
  /** Epoch milliseconds of the last alert emitted for this job. */
  lastAlertAt?: number;
  /** Epoch milliseconds when the current failure streak started. */
  firstFailureAt?: number;
  /** Error message from the most recent failure. */
  lastErrorMessage?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: Required<CronErrorHandlerOptions> = {
  failureThreshold: 3,
  maxFailuresBeforeDisable: 10,
  cooldownMs: 5 * 60 * 1000, // 5 minutes
  autoRecover: true,
  autoDisable: false,
};

// ---------------------------------------------------------------------------
// CronErrorHandler Class
// ---------------------------------------------------------------------------

/**
 * Monitors cron job failures and manages failure state, alerting, and recovery.
 *
 * On `cron:failed` event received via ErrorBus:
 * 1. Increments consecutiveFailures for this jobId
 * 2. Updates lastFailureAt, firstFailureAt (if first), lastErrorMessage
 * 3. If consecutiveFailures >= failureThreshold AND cooldown elapsed:
 *    a. Emits enriched `cron:failed` via ErrorBus
 *    b. If autoRecover, triggers SelfHealer recovery
 * 4. If consecutiveFailures >= maxFailuresBeforeDisable AND autoDisable:
 *    a. Logs warning that job should be disabled
 *    b. Emits `error:escalated` via ErrorBus
 *
 * On `cron:success` event:
 * - Resets consecutiveFailures to 0
 * - Updates lastSuccessAt
 */
export class CronErrorHandlerClass {
  private static instance: CronErrorHandlerClass | null = null;

  /** Per-job failure tracking state. */
  private jobStates: Map<string, CronJobState> = new Map();

  /** Unsubscribe functions from ErrorBus listeners. */
  private unsubscribers: Array<() => void> = [];

  /** Whether the handler is currently active. */
  private running = false;

  /** Resolved configuration options. */
  private options: Required<CronErrorHandlerOptions>;

  private constructor(options?: CronErrorHandlerOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    logger.info(
      {
        failureThreshold: this.options.failureThreshold,
        maxFailuresBeforeDisable: this.options.maxFailuresBeforeDisable,
        cooldownMs: this.options.cooldownMs,
        autoRecover: this.options.autoRecover,
        autoDisable: this.options.autoDisable,
      },
      "CronErrorHandler: initialized",
    );
  }

  /** Get the singleton instance. */
  static getInstance(
    options?: CronErrorHandlerOptions,
  ): CronErrorHandlerClass {
    if (!CronErrorHandlerClass.instance) {
      CronErrorHandlerClass.instance = new CronErrorHandlerClass(options);
    }
    return CronErrorHandlerClass.instance;
  }

  /** Reset the singleton (useful for testing). */
  static reset(): void {
    if (CronErrorHandlerClass.instance) {
      CronErrorHandlerClass.instance.stop();
      CronErrorHandlerClass.instance.jobStates.clear();
      CronErrorHandlerClass.instance = null;
    }
  }

  // -----------------------------------------------------------------------
  // start / stop
  // -----------------------------------------------------------------------

  /**
   * Begin monitoring cron job failures via ErrorBus subscriptions.
   * Idempotent — safe to call multiple times.
   */
  start(): void {
    if (this.running) {
      logger.warn("CronErrorHandler: already running");
      return;
    }
    this.running = true;

    const unsubFailed = ErrorBus.on("cron:failed", (event) =>
      this.handleCronFailed(event),
    );
    this.unsubscribers.push(unsubFailed);

    const unsubSuccess = ErrorBus.on("cron:success", (event) =>
      this.handleCronSuccess(event),
    );
    this.unsubscribers.push(unsubSuccess);

    logger.info(
      { subscriptions: this.unsubscribers.length },
      "CronErrorHandler: started — subscribed to ErrorBus",
    );
  }

  /**
   * Stop monitoring and unsubscribe from ErrorBus.
   * Idempotent — safe to call multiple times.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch (err) {
        logger.warn(
          { err },
          "CronErrorHandler: error during unsubscribe",
        );
      }
    }
    this.unsubscribers = [];

    this.cleanup();

    logger.info("CronErrorHandler: stopped");
  }

  /**
   * Sweep stale entries from the jobStates Map.
   * Removes jobs with zero consecutive failures and lastSuccessAt older than 7 days.
   * Idempotent — safe to call at any time.
   */
  cleanup(): void {
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;
    for (const [jobId, state] of this.jobStates) {
      if (state.consecutiveFailures === 0 && state.lastSuccessAt && (now - state.lastSuccessAt) > ONE_WEEK) {
        this.jobStates.delete(jobId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info({ cleaned }, "CronErrorHandler: stale job states cleaned");
    }
  }

  // -----------------------------------------------------------------------
  // recordFailure / recordSuccess (direct method calls)
  // -----------------------------------------------------------------------

  /**
   * Record a cron job failure. Called directly by AgentScheduler or
   * triggered via ErrorBus subscription.
   *
   * @param jobId - Unique identifier for the cron job.
   * @param jobName - Human-readable name of the job.
   * @param agentId - The agent this job runs under.
   * @param errorMessage - Description of the failure.
   */
  recordFailure(
    jobId: string,
    jobName: string,
    agentId: string,
    errorMessage: string,
  ): void {
    try {
      const state = this.getOrCreateState(jobId);
      const now = Date.now();

      state.consecutiveFailures++;
      state.totalFailures++;
      state.lastFailureAt = now;
      state.lastErrorMessage = errorMessage;

      if (!state.firstFailureAt) {
        state.firstFailureAt = now;
      }

      logger.debug(
        {
          jobId,
          jobName,
          agentId,
          consecutiveFailures: state.consecutiveFailures,
          totalFailures: state.totalFailures,
        },
        "CronErrorHandler: failure recorded",
      );

      // Check if threshold exceeded and cooldown elapsed
      this.checkThresholds(state, jobName, agentId);
    } catch (err) {
      logger.error(
        { err, jobId, jobName, agentId },
        "CronErrorHandler: recordFailure threw",
      );
    }
  }

  /**
   * Record a cron job success. Resets consecutive failure counter.
   *
   * @param jobId - Unique identifier for the cron job.
   */
  recordSuccess(jobId: string): void {
    try {
      const state = this.getOrCreateState(jobId);
      const now = Date.now();

      state.consecutiveFailures = 0;
      state.lastSuccessAt = now;

      logger.debug(
        { jobId, totalFailures: state.totalFailures },
        "CronErrorHandler: success recorded — consecutive failures reset",
      );
    } catch (err) {
      logger.error(
        { err, jobId },
        "CronErrorHandler: recordSuccess threw",
      );
    }
  }

  // -----------------------------------------------------------------------
  // State queries
  // -----------------------------------------------------------------------

  /**
   * Get the current failure state for a specific job.
   *
   * @param jobId - Unique identifier for the cron job.
   * @returns The job's state, or undefined if not tracked.
   */
  getJobState(jobId: string): CronJobState | undefined {
    return this.jobStates.get(jobId);
  }

  /**
   * Get all tracked job states.
   *
   * @returns Array of all CronJobState objects.
   */
  getAllStates(): CronJobState[] {
    return Array.from(this.jobStates.values());
  }

  /**
   * Get summary statistics across all tracked jobs.
   *
   * @returns Object with totalJobsTracked, jobsWithFailures, totalConsecutiveFailures.
   */
  getStats(): {
    totalJobsTracked: number;
    jobsWithFailures: number;
    totalConsecutiveFailures: number;
  } {
    let jobsWithFailures = 0;
    let totalConsecutiveFailures = 0;

    for (const state of this.jobStates.values()) {
      if (state.totalFailures > 0) {
        jobsWithFailures++;
      }
      totalConsecutiveFailures += state.consecutiveFailures;
    }

    return {
      totalJobsTracked: this.jobStates.size,
      jobsWithFailures,
      totalConsecutiveFailures,
    };
  }

  // -----------------------------------------------------------------------
  // Internal: Event handling
  // -----------------------------------------------------------------------

  /**
   * Handle a `cron:failed` event from ErrorBus.
   * Extracts jobId, jobName, agentId from the event and calls recordFailure.
   */
  private handleCronFailed(event: ErrorEvent): void {
    try {
      const jobId =
        (event.context?.jobId as string) ??
        (event.agentId ? `cron:${event.agentId}` : undefined);

      if (!jobId) {
        logger.warn(
          { eventId: event.id, component: event.component },
          "CronErrorHandler: cron:failed event missing jobId — skipping",
        );
        return;
      }

      const jobName = (event.context?.jobName as string) ?? jobId;
      const agentId = event.agentId ?? "unknown";
      const errorMessage = event.message ?? "Unknown error";

      this.recordFailure(jobId, jobName, agentId, errorMessage);
    } catch (err) {
      logger.error(
        { err, eventId: event.id },
        "CronErrorHandler: handleCronFailed threw",
      );
    }
  }

  /**
   * Handle a `cron:success` event from ErrorBus.
   * Extracts jobId and calls recordSuccess.
   */
  private handleCronSuccess(event: ErrorEvent): void {
    try {
      const jobId =
        (event.context?.jobId as string) ??
        (event.agentId ? `cron:${event.agentId}` : undefined);

      if (!jobId) {
        logger.debug(
          { eventId: event.id },
          "CronErrorHandler: cron:success event missing jobId — skipping",
        );
        return;
      }

      this.recordSuccess(jobId);
    } catch (err) {
      logger.error(
        { err, eventId: event.id },
        "CronErrorHandler: handleCronSuccess threw",
      );
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Threshold checking and alerting
  // -----------------------------------------------------------------------

  /**
   * Check if the job's failure count has exceeded thresholds and take action.
   */
  private checkThresholds(
    state: CronJobState,
    jobName: string,
    agentId: string,
  ): void {
    const now = Date.now();

    // Check alert threshold
    if (state.consecutiveFailures >= this.options.failureThreshold) {
      const cooldownElapsed =
        state.lastAlertAt === undefined ||
        now - state.lastAlertAt >= this.options.cooldownMs;

      if (cooldownElapsed) {
        this.emitAlert(state, jobName, agentId);
        state.lastAlertAt = now;
      } else {
        logger.debug(
          {
            jobId: state.jobId,
            consecutiveFailures: state.consecutiveFailures,
            timeSinceLastAlertMs: now - (state.lastAlertAt ?? 0),
            cooldownMs: this.options.cooldownMs,
          },
          "CronErrorHandler: alert cooldown active — skipping alert",
        );
      }

      // Trigger self-healing recovery if enabled
      if (this.options.autoRecover) {
        this.triggerRecovery(state, jobName, agentId);
      }
    }

    // Check max-failures-before-disable threshold
    if (
      this.options.autoDisable &&
      state.consecutiveFailures >= this.options.maxFailuresBeforeDisable
    ) {
      this.emitEscalation(state, jobName, agentId);
    }
  }

  /**
   * Emit an enriched `cron:failed` event via ErrorBus when threshold is exceeded.
   */
  private emitAlert(
    state: CronJobState,
    jobName: string,
    agentId: string,
  ): void {
    const cronError = new CronJobError(
      `Cron job "${jobName}" has failed ${state.consecutiveFailures} consecutive times`,
      {
        jobId: state.jobId,
        jobName,
        agentId,
        failCount: state.consecutiveFailures,
        lastError: state.lastErrorMessage,
        severity:
          state.consecutiveFailures >= this.options.maxFailuresBeforeDisable
            ? "critical"
            : "error",
        metadata: {
          totalFailures: state.totalFailures,
          firstFailureAt: state.firstFailureAt,
          lastFailureAt: state.lastFailureAt,
          consecutiveFailures: state.consecutiveFailures,
        },
      },
    );

    try {
      ErrorBus.emit({
        type: "cron:failed",
        severity: cronError.severity,
        component: "cron-error-handler",
        error: cronError,
        message: cronError.message,
        agentId,
        context: {
          jobId: state.jobId,
          jobName,
          consecutiveFailures: state.consecutiveFailures,
          totalFailures: state.totalFailures,
          firstFailureAt: state.firstFailureAt,
          lastFailureAt: state.lastFailureAt,
          lastErrorMessage: state.lastErrorMessage,
          alertType: "threshold-exceeded",
        },
        recoverable:
          state.consecutiveFailures < this.options.maxFailuresBeforeDisable,
      });

      logger.warn(
        {
          jobId: state.jobId,
          jobName,
          agentId,
          consecutiveFailures: state.consecutiveFailures,
        },
        "CronErrorHandler: alert emitted — failure threshold exceeded",
      );
    } catch (err) {
      logger.error(
        { err, jobId: state.jobId },
        "CronErrorHandler: emitAlert threw",
      );
    }
  }

  /**
   * Emit `error:escalated` when a job has failed too many times and should
   * potentially be disabled.
   */
  private emitEscalation(
    state: CronJobState,
    jobName: string,
    agentId: string,
  ): void {
    logger.error(
      {
        jobId: state.jobId,
        jobName,
        agentId,
        consecutiveFailures: state.consecutiveFailures,
        maxFailuresBeforeDisable: this.options.maxFailuresBeforeDisable,
      },
      "CronErrorHandler: job should be disabled — max failures exceeded",
    );

    try {
      ErrorBus.emit({
        type: "error:escalated",
        severity: "critical",
        component: "cron-error-handler",
        error: new CronJobError(
          `Cron job "${jobName}" has failed ${state.consecutiveFailures} consecutive times and should be disabled`,
          {
            jobId: state.jobId,
            jobName,
            agentId,
            failCount: state.consecutiveFailures,
            severity: "critical",
          },
        ),
        message: `Cron job "${jobName}" (${state.jobId}) should be disabled: ${state.consecutiveFailures} consecutive failures`,
        agentId,
        context: {
          jobId: state.jobId,
          jobName,
          consecutiveFailures: state.consecutiveFailures,
          totalFailures: state.totalFailures,
          recommendation: "disable-job",
        },
        recoverable: false,
      });
    } catch (err) {
      logger.error(
        { err, jobId: state.jobId },
        "CronErrorHandler: emitEscalation threw",
      );
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Recovery
  // -----------------------------------------------------------------------

  /**
   * Trigger SelfHealer recovery for a failing cron job.
   */
  private triggerRecovery(
    state: CronJobState,
    jobName: string,
    agentId: string,
  ): void {
    // Map to the most relevant failure scenario
    const scenario = agentId
      ? FailureScenario.AgentHeartbeatFailure
      : FailureScenario.MessageDeliveryFailure;

    logger.info(
      {
        jobId: state.jobId,
        jobName,
        agentId,
        consecutiveFailures: state.consecutiveFailures,
        scenario,
      },
      "CronErrorHandler: triggering self-healing recovery",
    );

    SelfHealer.executeRecovery(scenario, {
      agentId,
      component: "cron-error-handler",
      metadata: {
        jobId: state.jobId,
        jobName,
        consecutiveFailures: state.consecutiveFailures,
        totalFailures: state.totalFailures,
        triggeredBy: "cron-error-handler",
        lastErrorMessage: state.lastErrorMessage,
      },
    }).catch((err) => {
      logger.error(
        { err, jobId: state.jobId },
        "CronErrorHandler: recovery execution failed",
      );
    });
  }

  // -----------------------------------------------------------------------
  // Internal: State management
  // -----------------------------------------------------------------------

  /**
   * Get existing state or create a new one for the given jobId.
   */
  private getOrCreateState(jobId: string): CronJobState {
    let state = this.jobStates.get(jobId);
    if (!state) {
      state = {
        jobId,
        consecutiveFailures: 0,
        totalFailures: 0,
      };
      this.jobStates.set(jobId, state);
      logger.debug({ jobId }, "CronErrorHandler: new job state created");
    }
    return state;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Ready-to-use singleton instance of the CronErrorHandlerClass.
 *
 * Import this directly:
 * ```ts
 * import { CronErrorHandler } from "./scheduler/cron-error-handler";
 * CronErrorHandler.start();
 * ```
 */
export const CronErrorHandler = CronErrorHandlerClass.getInstance();
