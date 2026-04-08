/**
 * Error Aggregator for Strategos.
 *
 * Deduplicates, rate-limits, and aggregates errors from the ErrorBus.
 * Prevents alert storms when the same error fires repeatedly.
 * Provides error histograms for monitoring dashboards.
 *
 * Design principles:
 * - Subscribe to ErrorBus; never duplicate its pub/sub functionality
 * - Listener safety: no throwing from event handlers
 * - Periodic sweep with setInterval (cleared on stop)
 * - Singleton access via exported `ErrorAggregator` constant
 *
 * Usage:
 *   import { ErrorAggregator } from "./runtime/error-aggregator.js";
 *
 *   ErrorAggregator.start();
 *
 *   // Later: inspect aggregated errors
 *   const entries = ErrorAggregator.getAggregated();
 *   const histogram = ErrorAggregator.getHistogram();
 *   const stats = ErrorAggregator.getStats();
 *
 *   // Stop (e.g. on shutdown)
 *   ErrorAggregator.stop();
 *
 * @module error-aggregator
 */

import { ErrorBus, ErrorEventType, ErrorEvent } from "./error-emitter.js";
import { ErrorSeverity } from "./error-types.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

/** Numeric severity ordering for comparison. */
const SEVERITY_LEVELS: Record<ErrorSeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

/** Return true if `a` is at or above `b` in the severity hierarchy. */
function severityAtOrAbove(a: ErrorSeverity, b: ErrorSeverity): boolean {
  return SEVERITY_LEVELS[a] >= SEVERITY_LEVELS[b];
}

// ---------------------------------------------------------------------------
// AggregatedErrorEntry
// ---------------------------------------------------------------------------

/**
 * A deduplicated, aggregated error entry maintained by the ErrorAggregator.
 *
 * Each entry represents one unique error (by dedup key) and tracks how many
 * times it has occurred, when it was first/last seen, and when the last
 * alert was sent (for rate-limiting).
 */
export interface AggregatedErrorEntry {
  /** Dedup key: `${component}:${errorType}:${normalizedMessage}` */
  key: string;
  /** The canonical ErrorEventType. */
  type: ErrorEventType;
  /** The subsystem that emitted this error. */
  component: string;
  /** Human-readable error message. */
  message: string;
  /** Severity level of the error. */
  severity: ErrorSeverity;
  /** How many times this error occurred within the aggregation window. */
  count: number;
  /** Date.now() of first occurrence. */
  firstSeen: number;
  /** Date.now() of most recent occurrence. */
  lastSeen: number;
  /** Which agent is involved, if applicable. */
  agentId?: string;
  /** One sample error object for debugging. */
  sampleError?: unknown;
  /** When last alert was sent (for rate-limiting). */
  lastNotifiedAt?: number;
}

// ---------------------------------------------------------------------------
// AggregatorOptions
// ---------------------------------------------------------------------------

/** Configuration options for the ErrorAggregator. */
export interface AggregatorOptions {
  /** Aggregation window in ms. Entries not seen within this window are swept.
   *  Default: 60000 (1 minute). */
  windowMs?: number;
  /** Maximum number of unique entries in the aggregation map.
   *  Default: 200. */
  maxEntries?: number;
  /** Minimum time (ms) between alerts for the same dedup key.
   *  Default: 300000 (5 minutes). */
  alertCooldownMs?: number;
  /** Only aggregate errors at or above this severity level.
   *  Default: 'warn'. */
  severityThreshold?: ErrorSeverity;
  /** Minimum count before an alert is triggered for a dedup key.
   *  Default: 3. */
  alertThreshold?: number;
}

/** Default option values. */
const DEFAULTS: Required<AggregatorOptions> = {
  windowMs: 60_000,
  maxEntries: 200,
  alertCooldownMs: 300_000,
  severityThreshold: "warn",
  alertThreshold: 3,
};

// ---------------------------------------------------------------------------
// Event types the aggregator subscribes to
// ---------------------------------------------------------------------------

const SUBSCRIBED_EVENTS: Array<ErrorEventType | "*"> = [
  "error:detected",
  "cron:failed",
  "heartbeat:missed",
  "tool:failed",
  "provider:failed",
  "persistence:failed",
  "agent:error",
];

// ---------------------------------------------------------------------------
// Helpers: dedup key generation
// ---------------------------------------------------------------------------

/**
 * Normalize a message for deduplication:
 * - lowercase
 * - trim
 * - strip digits (group similar errors like "failed on call 1" and "failed on call 42")
 * - collapse multiple whitespace
 * - truncate to 100 characters
 */
function normalizeMessage(msg: string): string {
  return msg
    .toLowerCase()
    .trim()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

/**
 * Generate a dedup key from an ErrorEvent.
 * Format: `${component}:${type}:${normalizedFirst100Chars}`
 */
function makeDedupKey(event: ErrorEvent): string {
  const normalized = normalizeMessage(event.message);
  return `${event.component}:${event.type}:${normalized}`;
}

// ---------------------------------------------------------------------------
// ErrorAggregator class
// ---------------------------------------------------------------------------

/**
 * Deduplicates, rate-limits, and aggregates errors from the ErrorBus.
 *
 * - Identical errors (same component + type + normalized message) are merged
 *   into a single AggregatedErrorEntry with an incremented count.
 * - Alerts are rate-limited: an `error:escalated` event is only emitted when
 *   the count reaches `alertThreshold` AND the cooldown has elapsed.
 * - A periodic sweep removes entries whose `lastSeen` is older than
 *   `windowMs`, emitting `error:recovered` for each swept entry.
 */
export class ErrorAggregatorClass {
  private static instance: ErrorAggregatorClass | null = null;

  /** Current aggregated entries keyed by dedup key. */
  private entries: Map<string, AggregatedErrorEntry> = new Map();

  /** Unsubscribe functions from ErrorBus listeners. */
  private unsubscribers: Array<() => void> = [];

  /** setInterval handle for the periodic sweep. */
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** Resolved options (defaults merged with user-provided overrides). */
  private opts: Required<AggregatorOptions>;

  /** Whether the aggregator is currently running. */
  private running = false;

  private constructor(options?: AggregatorOptions) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Get the singleton instance.
   *
   * Options are only applied on first call; subsequent calls ignore them.
   */
  static getInstance(options?: AggregatorOptions): ErrorAggregatorClass {
    if (!ErrorAggregatorClass.instance) {
      ErrorAggregatorClass.instance = new ErrorAggregatorClass(options);
    }
    return ErrorAggregatorClass.instance;
  }

  /**
   * Reset the singleton (useful for testing).
   * Stops the aggregator and clears all state.
   */
  static reset(): void {
    if (ErrorAggregatorClass.instance) {
      ErrorAggregatorClass.instance.stop();
      ErrorAggregatorClass.instance.entries.clear();
      ErrorAggregatorClass.instance = null;
    }
  }

  // -----------------------------------------------------------------------
  // start / stop
  // -----------------------------------------------------------------------

  /**
   * Subscribe to the ErrorBus and begin processing events.
   * Also starts the periodic sweep timer.
   * Idempotent — safe to call multiple times.
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;

    // Subscribe to each relevant event type
    for (const eventType of SUBSCRIBED_EVENTS) {
      const unsub = ErrorBus.on(eventType, (event) =>
        this.handleEvent(event),
      );
      this.unsubscribers.push(unsub);
    }

    // Start periodic sweep
    this.sweepTimer = setInterval(() => this.sweep(), this.opts.windowMs);
    if (this.sweepTimer && typeof this.sweepTimer.unref === "function") this.sweepTimer.unref();

    logger.info(
      { windowMs: this.opts.windowMs, alertThreshold: this.opts.alertThreshold },
      "ErrorAggregator: started",
    );
  }

  /**
   * Unsubscribe from the ErrorBus and stop the sweep timer.
   * Does NOT clear aggregated data — use `reset()` for that.
   * Idempotent — safe to call multiple times.
   */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;

    // Unsubscribe from all ErrorBus listeners
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch (err) {
        logger.warn({ err }, "ErrorAggregator: error during unsubscribe");
      }
    }
    this.unsubscribers = [];

    // Clear sweep timer
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    logger.info("ErrorAggregator: stopped");
  }

  // -----------------------------------------------------------------------
  // Query methods
  // -----------------------------------------------------------------------

  /** Return all current aggregated entries. */
  getAggregated(): AggregatedErrorEntry[] {
    return Array.from(this.entries.values());
  }

  /** Return a specific entry by dedup key, or undefined. */
  getByKey(key: string): AggregatedErrorEntry | undefined {
    return this.entries.get(key);
  }

  /** Return entries at or above the given severity level. */
  getErrorsAboveSeverity(severity: ErrorSeverity): AggregatedErrorEntry[] {
    return Array.from(this.entries.values()).filter((entry) =>
      severityAtOrAbove(entry.severity, severity),
    );
  }

  /**
   * Return entries whose `lastSeen` is within the given window.
   * If no window is provided, uses the configured `windowMs`.
   */
  getRecent(windowMs?: number): AggregatedErrorEntry[] {
    const cutoff = Date.now() - (windowMs ?? this.opts.windowMs);
    return Array.from(this.entries.values()).filter(
      (entry) => entry.lastSeen >= cutoff,
    );
  }

  /**
   * Build a histogram: error type → total occurrence count.
   */
  getHistogram(): Record<string, number> {
    const histogram: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      histogram[entry.type] = (histogram[entry.type] ?? 0) + entry.count;
    }
    return histogram;
  }

  /**
   * Build a histogram: component → total occurrence count.
   */
  getComponentHistogram(): Record<string, number> {
    const histogram: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      histogram[entry.component] =
        (histogram[entry.component] ?? 0) + entry.count;
    }
    return histogram;
  }

  /**
   * Clear all aggregated data. Does NOT affect subscriptions or the sweep timer.
   */
  reset(): void {
    this.entries.clear();
    logger.info("ErrorAggregator: data reset");
  }

  /**
   * Summary statistics for the current aggregation state.
   */
  getStats(): {
    totalUnique: number;
    totalOccurrences: number;
    windowMs: number;
    topError: AggregatedErrorEntry | null;
  } {
    const values = Array.from(this.entries.values());
    let topError: AggregatedErrorEntry | null = null;
    let totalOccurrences = 0;

    for (const entry of values) {
      totalOccurrences += entry.count;
      if (!topError || entry.count > topError.count) {
        topError = entry;
      }
    }

    return {
      totalUnique: values.length,
      totalOccurrences,
      windowMs: this.opts.windowMs,
      topError,
    };
  }

  // -----------------------------------------------------------------------
  // Internal: event handling
  // -----------------------------------------------------------------------

  /**
   * Process a single ErrorEvent from the ErrorBus.
   * Wrapped in try/catch for listener safety.
   */
  private handleEvent(event: ErrorEvent): void {
    try {
      this.processEvent(event);
    } catch (err) {
      logger.error(
        { err, eventType: event.type },
        "ErrorAggregator: unhandled error in event handler",
      );
    }
  }

  /**
   * Core event processing: dedup, aggregate, and decide whether to alert.
   */
  private processEvent(event: ErrorEvent): void {
    // Filter by severity threshold
    if (!severityAtOrAbove(event.severity, this.opts.severityThreshold)) {
      return;
    }

    const key = makeDedupKey(event);
    const now = Date.now();

    let entry = this.entries.get(key);

    if (entry) {
      // Update existing entry
      entry.count += 1;
      entry.lastSeen = now;
      // Keep the most severe severity if it changes
      if (severityAtOrAbove(event.severity, entry.severity)) {
        entry.severity = event.severity;
      }
      if (event.agentId && !entry.agentId) {
        entry.agentId = event.agentId;
      }
    } else {
      // Enforce max entries: evict the oldest entry if at capacity
      if (this.entries.size >= this.opts.maxEntries) {
        this.evictOldest();
      }

      // Create new entry
      entry = {
        key,
        type: event.type,
        component: event.component,
        message: event.message,
        severity: event.severity,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        agentId: event.agentId,
        sampleError: event.error,
      };
      this.entries.set(key, entry);
    }

    // Decide whether to trigger an alert
    this.maybeAlert(entry);
  }

  /**
   * Emit an `error:escalated` event if the entry meets alert criteria:
   * - count >= alertThreshold
   * - cooldown has elapsed since last alert
   * - severity >= severityThreshold
   */
  private maybeAlert(entry: AggregatedErrorEntry): void {
    if (entry.count < this.opts.alertThreshold) {
      return;
    }

    if (
      entry.lastNotifiedAt !== undefined &&
      Date.now() - entry.lastNotifiedAt < this.opts.alertCooldownMs
    ) {
      return; // Still in cooldown
    }

    if (!severityAtOrAbove(entry.severity, this.opts.severityThreshold)) {
      return;
    }

    // Update lastNotifiedAt
    entry.lastNotifiedAt = Date.now();

    try {
      ErrorBus.emit({
        type: "error:escalated",
        severity: entry.severity,
        component: "error-aggregator",
        error: entry.sampleError,
        message: `Error escalated: ${entry.key} (count: ${entry.count})`,
        agentId: entry.agentId,
        context: {
          dedupKey: entry.key,
          count: entry.count,
          firstSeen: entry.firstSeen,
          lastSeen: entry.lastSeen,
        },
      });
    } catch (err) {
      logger.error(
        { err, dedupKey: entry.key },
        "ErrorAggregator: failed to emit error:escalated",
      );
    }
  }

  // -----------------------------------------------------------------------
  // Internal: sweep
  // -----------------------------------------------------------------------

  /**
   * Sweep expired entries: remove entries whose `lastSeen` is older than
   * `windowMs` ago. For each swept entry, emit an `error:recovered` event.
   */
  private sweep(): void {
    const cutoff = Date.now() - this.opts.windowMs;
    const swept: AggregatedErrorEntry[] = [];

    for (const [key, entry] of this.entries) {
      if (entry.lastSeen < cutoff) {
        swept.push(entry);
        this.entries.delete(key);
      }
    }

    if (swept.length === 0) {
      return;
    }

    logger.info(
      { sweptCount: swept.length },
      "ErrorAggregator: swept expired entries",
    );

    // Emit error:recovered for each swept entry
    for (const entry of swept) {
      try {
        ErrorBus.emit({
          type: "error:recovered",
          severity: entry.severity,
          component: "error-aggregator",
          error: entry.sampleError,
          message: `Error recovered: ${entry.key} (was seen ${entry.count} times)`,
          agentId: entry.agentId,
          context: {
            dedupKey: entry.key,
            count: entry.count,
            firstSeen: entry.firstSeen,
            lastSeen: entry.lastSeen,
          },
        });
      } catch (err) {
        logger.error(
          { err, dedupKey: entry.key },
          "ErrorAggregator: failed to emit error:recovered",
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal: eviction
  // -----------------------------------------------------------------------

  /**
   * Evict the oldest entry (by firstSeen) when the map is at capacity.
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.firstSeen < oldestTime) {
        oldestTime = entry.firstSeen;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.entries.delete(oldestKey);
      logger.debug(
        { evictedKey: oldestKey },
        "ErrorAggregator: evicted oldest entry (maxEntries reached)",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Ready-to-use singleton instance of the ErrorAggregatorClass.
 *
 * Import this directly:
 * ```ts
 * import { ErrorAggregator } from "./runtime/error-aggregator.js";
 * ErrorAggregator.start();
 * ```
 */
export const ErrorAggregator = ErrorAggregatorClass.getInstance();
