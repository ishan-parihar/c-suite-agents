/**
 * Centralized Error Event Bus for Operant.
 *
 * Every subsystem (LLM provider, tools, scheduler, heartbeat, MCP, Telegram,
 * memory, Kanban) emits errors here instead of just calling `logger.error()`.
 * This enables monitoring, aggregation, and self-healing.
 *
 * Usage:
 *   import { ErrorBus, createErrorEvent } from "./runtime/error-emitter.js";
 *
 *   // Emit an error event
 *   ErrorBus.emit({
 *     type: "provider:failed",
 *     severity: "error",
 *     component: "llm-provider",
 *     error: err,
 *     message: "OpenAI API returned 500",
 *     agentId: "ceo-strategic",
 *   });
 *
 *   // Subscribe to events
 *   const unsub = ErrorBus.on("provider:failed", (evt) => {
 *     logger.warn({ evt }, "Provider failure detected");
 *   });
 *
 *   // Subscribe to ALL events
 *   ErrorBus.on("*", (evt) => {
 *     telemetry.record(evt);
 *   });
 *
 *   // Get recent history
 *   const recent = ErrorBus.history({ limit: 20 });
 *
 *   // Create a typed event from an Error object
 *   const event = createErrorEvent("tool:failed", err, {
 *     component: "tool-executor",
 *     agentId: "coo-productivity",
 *   });
 *
 * @module error-emitter
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import {
  OperantError,
  ErrorSeverity,
  classifyError,
} from "./error-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of events retained in the in-memory ring buffer. */
export const MAX_HISTORY = 500;

// ---------------------------------------------------------------------------
// ErrorEvent types
// ---------------------------------------------------------------------------

/**
 * Canonical event types emitted by the error bus.
 *
 * Subsystems should use these types so the aggregator, alert-manager,
 * and self-healer can filter and route events correctly.
 */
export type ErrorEventType =
  | "error:detected"
  | "error:recovered"
  | "error:escalated"
  | "health:changed"
  | "cron:failed"
  | "cron:success"
  | "heartbeat:missed"
  | "heartbeat:ok"
  | "tool:failed"
  | "provider:failed"
  | "gateway:down"
  | "gateway:restored"
  | "persistence:failed"
  | "agent:error"
  | "message:failed";

/**
 * A structured error event emitted by any subsystem into the error bus.
 */
export interface ErrorEvent {
  /** Unique identifier for this event (UUID v4). */
  id: string;
  /** Epoch milliseconds when the event was created. */
  timestamp: number;
  /** The canonical event type. */
  type: ErrorEventType;
  /** Severity level of the event. */
  severity: ErrorSeverity;
  /** Which subsystem emitted this event. */
  component: string;
  /** The original error object (Error, OperantError, or unknown). */
  error: unknown;
  /** Human-readable summary. */
  message: string;
  /** Which agent is involved, if applicable. */
  agentId?: string;
  /** Additional metadata for downstream consumers. */
  context?: Record<string, unknown>;
  /** Whether this error is considered auto-recoverable. */
  recoverable?: boolean;
}

// ---------------------------------------------------------------------------
// ErrorEmitter (singleton)
// ---------------------------------------------------------------------------

/**
 * Centralized error event bus backed by Node.js EventEmitter.
 *
 * Features:
 * - Typed event emission with automatic id/timestamp generation
 * - Wildcard `*` listener for observing all events
 * - In-memory ring buffer for event history (configurable via MAX_HISTORY)
 * - Per-listener error isolation (one listener crash won't affect others)
 * - Backward-compatible logging via Pino on every emit
 * - Statistics computed from the ring buffer
 *
 * Singleton access: `ErrorBus`
 */
export class ErrorEmitter {
  private static instance: ErrorEmitter | null = null;

  /** Node.js EventEmitter used as the underlying pub/sub mechanism. */
  private emitter: EventEmitter;

  /** Ring buffer: newest events at index 0, capped at MAX_HISTORY. */
  private historyBuffer: ErrorEvent[];

  /** Map of one-shot listeners so we can clean up after they fire. */
  private onceWrappers: Map<
    (event: ErrorEvent) => void,
    (event: ErrorEvent) => void
  >;

  private constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
    this.emitter.on("error", (err: unknown) => {
      logger.error({ err }, "ErrorBus: unhandled error event");
    });
    this.historyBuffer = [];
    this.onceWrappers = new Map();
  }

  /**
   * Get the singleton instance of the ErrorEmitter.
   */
  static getInstance(): ErrorEmitter {
    if (!ErrorEmitter.instance) {
      ErrorEmitter.instance = new ErrorEmitter();
    }
    return ErrorEmitter.instance;
  }

  /**
   * Reset the singleton (useful for testing).
   */
  static reset(): void {
    if (ErrorEmitter.instance) {
      ErrorEmitter.instance.emitter.removeAllListeners();
      ErrorEmitter.instance.historyBuffer = [];
      ErrorEmitter.instance.onceWrappers.clear();
      ErrorEmitter.instance = null;
    }
  }

  // -----------------------------------------------------------------------
  // emit
  // -----------------------------------------------------------------------

  /**
   * Emit an error event into the bus.
   *
   * The `id` and `timestamp` fields are generated automatically.
   * The event is logged via Pino at a level matching its severity
   * for backward compatibility with existing `logger.error()` calls.
   *
   * @param event - The error event payload (without id/timestamp).
   * @returns The fully-constructed ErrorEvent with generated id and timestamp.
   */
  emit(event: Omit<ErrorEvent, "id" | "timestamp">): ErrorEvent {
    const fullEvent: ErrorEvent = {
      id: uuidv4(),
      timestamp: Date.now(),
      ...event,
    };

    // --- Ring buffer update (unshift + pop) ---
    this.historyBuffer.unshift(fullEvent);
    if (this.historyBuffer.length > MAX_HISTORY) {
      this.historyBuffer.pop();
    }

    // --- Backward-compatible logging ---
    this.logEvent(fullEvent);

    // --- Notify typed listeners ---
    this.notifyListeners(fullEvent.type, fullEvent);

    // --- Notify wildcard listeners ---
    this.notifyListeners("*", fullEvent);

    return fullEvent;
  }

  // -----------------------------------------------------------------------
  // on
  // -----------------------------------------------------------------------

  /**
   * Subscribe to error events of a given type, or all events with `'*'`.
   *
   * @param type     - The event type to listen for, or `'*'` for all events.
   * @param listener - Callback invoked for each matching event.
   * @returns An unsubscribe function.
   */
  on(
    type: ErrorEventType | "*",
    listener: (event: ErrorEvent) => void,
  ): () => void {
    const safeListener = this.wrapListener(listener, type);
    this.emitter.on(type, safeListener);

    return () => {
      this.emitter.off(type, safeListener);
    };
  }

  // -----------------------------------------------------------------------
  // off
  // -----------------------------------------------------------------------

  /**
   * Unsubscribe a previously registered listener.
   *
   * @param type     - The event type the listener was registered for.
   * @param listener - The original callback (or the one returned by `on`).
   */
  off(type: ErrorEventType | "*", listener: (event: ErrorEvent) => void): void {
    this.emitter.off(type, listener);
  }

  // -----------------------------------------------------------------------
  // once
  // -----------------------------------------------------------------------

  /**
   * Subscribe for exactly one event of the given type.
   *
   * @param type     - The event type to listen for.
   * @param listener - Callback invoked once for the next matching event.
   * @returns An unsubscribe function (also works before the event fires).
   */
  once(
    type: ErrorEventType,
    listener: (event: ErrorEvent) => void,
  ): () => void {
    const wrapper = (event: ErrorEvent) => {
      this.onceWrappers.delete(listener);
      listener(event);
    };
    this.onceWrappers.set(listener, wrapper);
    const safeWrapper = this.wrapListener(wrapper, type);
    this.emitter.once(type, safeWrapper);

    return () => {
      this.emitter.off(type, safeWrapper);
      this.onceWrappers.delete(listener);
    };
  }

  // -----------------------------------------------------------------------
  // history
  // -----------------------------------------------------------------------

  /**
   * Retrieve recent events from the in-memory ring buffer.
   *
   * @param options - Optional filters:
   *   - `type`   — only return events of this type.
   *   - `limit`  — maximum number of events to return (default: all).
   *   - `since`  — only return events with timestamp >= this value.
   * @returns Matching events, ordered newest-first.
   */
  history(options?: {
    type?: ErrorEventType;
    limit?: number;
    since?: number;
  }): ErrorEvent[] {
    let result = this.historyBuffer;

    if (options?.type) {
      result = result.filter((e) => e.type === options.type);
    }
    if (options?.since !== undefined) {
      result = result.filter((e) => e.timestamp >= options.since!);
    }

    const limit = options?.limit ?? result.length;
    return result.slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // clearHistory
  // -----------------------------------------------------------------------

  /**
   * Clear all events from the ring buffer.
   * Does not affect active listeners.
   */
  clearHistory(): void {
    this.historyBuffer = [];
  }

  // -----------------------------------------------------------------------
  // stats
  // -----------------------------------------------------------------------

  /**
   * Compute statistics from the current ring buffer.
   *
   * @returns An object with total count and breakdowns by type, severity,
   *          and component.
   */
  stats(): {
    totalEmitted: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    byComponent: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byComponent: Record<string, number> = {};

    for (const event of this.historyBuffer) {
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
      byComponent[event.component] =
        (byComponent[event.component] ?? 0) + 1;
    }

    return {
      totalEmitted: this.historyBuffer.length,
      byType,
      bySeverity,
      byComponent,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Wrap a listener in try/catch so one listener's crash does not prevent
   * other listeners from receiving the event.
   */
  private wrapListener(
    listener: (event: ErrorEvent) => void,
    type: string,
  ): (event: ErrorEvent) => void {
    return (event: ErrorEvent) => {
      try {
        listener(event);
      } catch (err) {
        logger.error(
          { err, eventType: type, eventId: event.id },
          "ErrorBus: listener threw an error",
        );
      }
    };
  }

  /**
   * Dispatch an event to all listeners registered for a given type,
   * catching per-listener errors.
   */
  private notifyListeners(type: string, event: ErrorEvent): void {
    // Use rawListeners so we can iterate safely even if a listener
    // modifies the emitter's listener list during iteration.
    const listeners = this.emitter.rawListeners(type);
    for (const raw of listeners) {
      if (typeof raw === "function") {
        try {
          (raw as (event: ErrorEvent) => void)(event);
        } catch (err) {
          logger.error(
            { err, eventType: type, eventId: event.id },
            "ErrorBus: listener threw during dispatch",
          );
        }
      }
    }
  }

  /**
   * Log an event via Pino at a level matching its severity.
   */
  private logEvent(event: ErrorEvent): void {
    const logData = {
      eventId: event.id,
      type: event.type,
      component: event.component,
      agentId: event.agentId,
      recoverable: event.recoverable,
    };

    switch (event.severity) {
      case "critical":
        logger.error(logData, `CRITICAL: ${event.message}`);
        break;
      case "error":
        logger.error(logData, event.message);
        break;
      case "warn":
        logger.warn(logData, event.message);
        break;
      case "info":
        logger.info(logData, event.message);
        break;
      default:
        logger.error(logData, event.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Ready-to-use singleton instance of the ErrorEmitter.
 *
 * Import this directly instead of calling `getInstance()`:
 * ```ts
 * import { ErrorBus } from "./runtime/error-emitter.js";
 * ErrorBus.on("provider:failed", (evt) => { ... });
 * ```
 */
export const ErrorBus = ErrorEmitter.getInstance();

// ---------------------------------------------------------------------------
// createErrorEvent helper
// ---------------------------------------------------------------------------

/**
 * Construct an ErrorEvent from a plain Error or OperantError.
 *
 * - If `error` is a OperantError, extracts `code`, `component`, `severity`,
 *   and `metadata` from its typed properties.
 * - If `error` is a plain Error, uses `classifyError()` heuristics to
 *   determine severity and recoverability.
 * - Generates a UUID for the event id and sets timestamp to Date.now().
 *
 * @param type    - The canonical event type.
 * @param error   - The original error (Error, OperantError, or unknown).
 * @param context - Optional metadata: component name, agentId, and arbitrary
 *                  key-value pairs.
 * @returns A fully-constructed ErrorEvent ready to emit or log.
 */
export function createErrorEvent(
  type: ErrorEventType,
  error: unknown,
  context?: {
    component?: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
  },
): ErrorEvent {
  let severity: ErrorSeverity;
  let recoverable: boolean;
  let component = context?.component ?? "unknown";
  let message: string;

  if (error instanceof OperantError) {
    severity = error.severity;
    recoverable = classifyError(error).isRecoverable;
    component = error.component ?? component;
    message = error.message;
  } else if (error instanceof Error) {
    const classification = classifyError(error);
    severity = classification.severity;
    recoverable = classification.isRecoverable;
    message = error.message;
  } else {
    // Unknown error value — conservative classification
    severity = "error";
    recoverable = false;
    message =
      typeof error === "string"
        ? error
        : error != null
          ? String(error)
          : "Unknown error";
  }

  const metadata = context?.metadata;
  const contextRecord: Record<string, unknown> | undefined = metadata
    ? { ...metadata }
    : undefined;

  return {
    id: uuidv4(),
    timestamp: Date.now(),
    type,
    severity,
    component,
    error,
    message,
    agentId: context?.agentId,
    context: contextRecord,
    recoverable,
  };
}
