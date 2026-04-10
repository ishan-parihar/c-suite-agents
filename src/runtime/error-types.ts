/**
 * Custom Error classes for the Operant self-healing system.
 *
 * This is the foundation for error classification, aggregation, and automated recovery.
 * All error-domain-specific classes extend OperantError, enabling the error classifier,
 * aggregator, and self-healer to distinguish error types programmatically instead of
 * relying on fragile string matching.
 *
 * Design principles:
 * - Every class extends OperantError with a unique `code` prefix
 * - Constructor accepts (message, options) with full `cause` support
 * - No business logic — types only
 * - Utility functions map errors to FailureScenario and classify recoverability
 *
 * @module error-types
 */

import { logger } from "../logger.js";
import { FailureScenario } from "./recovery.js";

// ---------------------------------------------------------------------------
// Re-exported / replicated types (avoid circular deps with model-fallback.ts)
// ---------------------------------------------------------------------------

/**
 * Reason for LLM provider failover.
 * Mirrors FailoverReason from model-fallback.ts to avoid circular imports.
 */
export type FailoverReason =
  | "timeout"
  | "model_not_found"
  | "rate_limit"
  | "api_error"
  | "context_overflow"
  | "auth"
  | "overloaded"
  | "unknown";

// ---------------------------------------------------------------------------
// Base Error Class
// ---------------------------------------------------------------------------

/** Severity levels for Operant errors. */
export type ErrorSeverity = "info" | "warn" | "error" | "critical";

/**
 * Base error class for all Operant errors.
 *
 * Every error in the system should extend this class so that the classifier,
 * aggregator, and self-healer can uniformly inspect `code`, `component`,
 * `severity`, and `metadata`.
 */
export class OperantError extends Error {
  readonly code: string;
  readonly component: string;
  readonly severity: ErrorSeverity;
  readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code: string;
      component: string;
      severity?: ErrorSeverity;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.code = options.code;
    this.component = options.component;
    this.severity = options.severity ?? "error";
    this.metadata = options.metadata;
  }
}

// ---------------------------------------------------------------------------
// ProviderError — LLM provider / API errors
// ---------------------------------------------------------------------------

export class ProviderError extends OperantError {
  readonly failoverReason: FailoverReason;
  readonly provider?: string;
  readonly model?: string;
  readonly httpStatus?: number;
  readonly errorCode?: string;

  constructor(
    message: string,
    options: {
      failoverReason: FailoverReason;
      provider?: string;
      model?: string;
      httpStatus?: number;
      errorCode?: string;
      component?: string;
      severity?: ErrorSeverity;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: options.errorCode ?? "PROVIDER_ERROR",
      component: options.component ?? "llm-provider",
      severity: options.severity ?? deriveProviderSeverity(options.failoverReason),
      metadata: options.metadata,
      cause: options.cause,
    });
    this.failoverReason = options.failoverReason;
    this.provider = options.provider;
    this.model = options.model;
    this.httpStatus = options.httpStatus;
    this.errorCode = options.errorCode;
  }
}

/** Map a failover reason to a default severity level. */
function deriveProviderSeverity(reason: FailoverReason): ErrorSeverity {
  switch (reason) {
    case "rate_limit":
    case "overloaded":
      return "warn";
    case "auth":
    case "model_not_found":
      return "error";
    case "timeout":
    case "api_error":
      return "error";
    case "context_overflow":
      return "warn";
    default:
      return "error";
  }
}

// ---------------------------------------------------------------------------
// ToolExecutionError — MCP / native tool execution failures
// ---------------------------------------------------------------------------

export type ToolType = "native" | "mcp";

export class ToolExecutionError extends OperantError {
  readonly toolName: string;
  readonly toolType: ToolType;
  readonly mcpServer?: string;
  readonly round?: number;

  constructor(
    message: string,
    options: {
      toolName: string;
      toolType: ToolType;
      mcpServer?: string;
      round?: number;
      component?: string;
      severity?: ErrorSeverity;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "TOOL_EXECUTION_ERROR",
      component: options.component ?? "tool-executor",
      severity: options.severity ?? "error",
      metadata: options.metadata,
      cause: options.cause,
    });
    this.toolName = options.toolName;
    this.toolType = options.toolType;
    this.mcpServer = options.mcpServer;
    this.round = options.round;
  }
}

// ---------------------------------------------------------------------------
// PersistenceError — storage layer failures (Memory, Kanban, Sessions)
// ---------------------------------------------------------------------------

export type PersistenceSubsystem =
  | "memory"
  | "kanban"
  | "session"
  | "scheduler"
  | "messaging";

export class PersistenceError extends OperantError {
  readonly subsystem: PersistenceSubsystem;
  readonly operation: string;

  constructor(
    message: string,
    options: {
      subsystem: PersistenceSubsystem;
      operation: string;
      component?: string;
      severity?: ErrorSeverity;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "PERSISTENCE_ERROR",
      component: options.component ?? `persistence-${options.subsystem}`,
      severity: options.severity ?? "critical",
      metadata: options.metadata,
      cause: options.cause,
    });
    this.subsystem = options.subsystem;
    this.operation = options.operation;
  }
}

// ---------------------------------------------------------------------------
// HeartbeatError — heartbeat system failures
// ---------------------------------------------------------------------------

export class HeartbeatError extends OperantError {
  readonly agentId?: string;
  readonly missedCount?: number;
  readonly lastHeartbeatAt?: number;

  constructor(
    message: string,
    options: {
      agentId?: string;
      missedCount?: number;
      lastHeartbeatAt?: number;
      component?: string;
      severity?: ErrorSeverity;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "HEARTBEAT_ERROR",
      component: options.component ?? "heartbeat",
      severity: options.severity ?? "warn",
      metadata: options.metadata,
      cause: options.cause,
    });
    this.agentId = options.agentId;
    this.missedCount = options.missedCount;
    this.lastHeartbeatAt = options.lastHeartbeatAt;
  }
}

// ---------------------------------------------------------------------------
// CronJobError — scheduled task failures
// ---------------------------------------------------------------------------

export class CronJobError extends OperantError {
  readonly jobId: string;
  readonly jobName?: string;
  readonly agentId?: string;
  readonly failCount: number;
  readonly lastError?: string;

  constructor(
    message: string,
    options: {
      jobId: string;
      jobName?: string;
      agentId?: string;
      failCount: number;
      lastError?: string;
      component?: string;
      severity?: ErrorSeverity;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "CRON_JOB_ERROR",
      component: options.component ?? "scheduler",
      severity:
        options.severity ??
        (options.failCount >= 3 ? "critical" : "warn"),
      metadata: options.metadata,
      cause: options.cause,
    });
    this.jobId = options.jobId;
    this.jobName = options.jobName;
    this.agentId = options.agentId;
    this.failCount = options.failCount;
    this.lastError = options.lastError;
  }
}

// ---------------------------------------------------------------------------
// GatewayError — MCP server/client, HTTP server errors
// ---------------------------------------------------------------------------

export type GatewayType =
  | "mcp-server"
  | "mcp-client"
  | "health-server"
  | "webhook-server"
  | "telegram";

export class GatewayError extends OperantError {
  readonly gatewayType: GatewayType;
  readonly port?: number;
  readonly url?: string;

  constructor(
    message: string,
    options: {
      gatewayType: GatewayType;
      port?: number;
      url?: string;
      component?: string;
      severity?: ErrorSeverity;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "GATEWAY_ERROR",
      component: options.component ?? `gateway-${options.gatewayType}`,
      severity: options.severity ?? "error",
      metadata: options.metadata,
      cause: options.cause,
    });
    this.gatewayType = options.gatewayType;
    this.port = options.port;
    this.url = options.url;
  }
}

// ---------------------------------------------------------------------------
// AgentError — agent lifecycle errors
// ---------------------------------------------------------------------------

export type AgentLifecyclePhase =
  | "init"
  | "session"
  | "execution"
  | "shutdown";

export class AgentError extends OperantError {
  readonly agentId: string;
  readonly lifecyclePhase: AgentLifecyclePhase;

  constructor(
    message: string,
    options: {
      agentId: string;
      lifecyclePhase: AgentLifecyclePhase;
      component?: string;
      severity?: ErrorSeverity;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "AGENT_ERROR",
      component: options.component ?? `agent-${options.agentId}`,
      severity: options.severity ?? "error",
      metadata: options.metadata,
      cause: options.cause,
    });
    this.agentId = options.agentId;
    this.lifecyclePhase = options.lifecyclePhase;
  }
}

// ---------------------------------------------------------------------------
// Utility: classifyError
// ---------------------------------------------------------------------------

/**
 * Inspects an error and returns a classification with severity and
 * recoverability assessment.
 *
 * Works with OperantError instances (reads typed properties) and
 * falls back to heuristic classification for arbitrary Error / unknown values.
 */
export function classifyError(
  err: unknown,
): { severity: ErrorSeverity; isRecoverable: boolean } {
  // Typed OperantError — use declared properties directly
  if (err instanceof OperantError) {
    return {
      severity: err.severity,
      isRecoverable: isRecoverableByType(err),
    };
  }

  // Standard Error — classify by message / name heuristics
  if (err instanceof Error) {
    return classifyPlainError(err);
  }

  // Unknown value — conservative classification
  logger.warn({ err }, "classifyError: received non-Error value");
  return { severity: "error", isRecoverable: false };
}

/** Determine recoverability from typed OperantError properties. */
function isRecoverableByType(err: OperantError): boolean {
  // Critical-severity errors are generally not auto-recoverable
  if (err.severity === "critical") {
    return false;
  }

  // ProviderError: rate limits and timeouts are transient → recoverable
  if (err instanceof ProviderError) {
    const transientReasons: FailoverReason[] = [
      "timeout",
      "rate_limit",
      "overloaded",
    ];
    return transientReasons.includes(err.failoverReason);
  }

  // ToolExecutionError: single failures are usually recoverable
  if (err instanceof ToolExecutionError) {
    return true;
  }

  // PersistenceError: storage failures are critical → not auto-recoverable
  if (err instanceof PersistenceError) {
    return false;
  }

  // HeartbeatError: often recoverable by restarting the agent
  if (err instanceof HeartbeatError) {
    return true;
  }

  // CronJobError: depends on fail count
  if (err instanceof CronJobError) {
    return err.failCount < 3;
  }

  // GatewayError: server errors may be recoverable by restart
  if (err instanceof GatewayError) {
    return true;
  }

  // AgentError: depends on lifecycle phase
  if (err instanceof AgentError) {
    // init and shutdown failures may need manual intervention
    return (
      err.lifecyclePhase === "session" || err.lifecyclePhase === "execution"
    );
  }

  // Unknown OperantError subclass — conservative
  return true;
}

/** Heuristic classification for plain Error objects. */
function classifyPlainError(err: Error): {
  severity: ErrorSeverity;
  isRecoverable: boolean;
} {
  const msg = err.message.toLowerCase();
  const name = err.name.toLowerCase();

  // Timeout / rate-limit patterns → warn, recoverable
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("etimedout") ||
    msg.includes("econnaborted")
  ) {
    return { severity: "warn", isRecoverable: true };
  }

  // Context overflow → warn, NOT recoverable by retry
  if (
    msg.includes("context length") ||
    msg.includes("context_overflow") ||
    msg.includes("token limit") ||
    msg.includes("too many tokens")
  ) {
    return { severity: "warn", isRecoverable: false };
  }

  // Connection refused / network → error, may be recoverable
  if (
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset")
  ) {
    return { severity: "error", isRecoverable: true };
  }

  // Auth failures → error, NOT recoverable without config change
  if (
    msg.includes("auth") ||
    msg.includes("unauthorized") ||
    msg.includes("401") ||
    msg.includes("forbidden") ||
    msg.includes("403")
  ) {
    return { severity: "error", isRecoverable: false };
  }

  // 5xx server errors → error, may be recoverable
  if (/status\s*(code)?\s*5\d{2}|5\d{2}\s*error/i.test(msg)) {
    return { severity: "error", isRecoverable: true };
  }

  // AbortError (user cancelled) → info, not recoverable
  if (name.includes("abort") || msg.includes("abort")) {
    return { severity: "info", isRecoverable: false };
  }

  // Default → error, not recoverable (conservative)
  return { severity: "error", isRecoverable: false };
}

// ---------------------------------------------------------------------------
// Utility: toFailureScenario
// ---------------------------------------------------------------------------

/**
 * Maps an error to a FailureScenario from the recovery system.
 *
 * Uses typed properties when available (OperantError subclasses),
 * falls back to message / name heuristics for plain Error objects.
 * Returns `undefined` if the error cannot be mapped to any known scenario.
 */
export function toFailureScenario(
  err: unknown,
): FailureScenario | undefined {
  if (err instanceof OperantError) {
    return mapTypedErrorToScenario(err);
  }

  if (err instanceof Error) {
    return mapPlainErrorToScenario(err);
  }

  return undefined;
}

/** Map a typed OperantError to a FailureScenario. */
function mapTypedErrorToScenario(
  err: OperantError,
): FailureScenario | undefined {
  if (err instanceof ProviderError) {
    return FailureScenario.LLMProviderFailure;
  }

  if (err instanceof ToolExecutionError) {
    return FailureScenario.MCPToolExecutionFailure;
  }

  if (err instanceof PersistenceError) {
    switch (err.subsystem) {
      case "memory":
        return FailureScenario.MemoryStoreFailure;
      case "kanban":
        return FailureScenario.KanbanPersistenceFailure;
      case "session":
      case "scheduler":
      case "messaging":
        return FailureScenario.MessageDeliveryFailure;
    }
  }

  if (err instanceof HeartbeatError) {
    return FailureScenario.AgentHeartbeatFailure;
  }

  if (err instanceof CronJobError) {
    // Cron failures are typically agent-related or message delivery issues
    return err.agentId
      ? FailureScenario.AgentHeartbeatFailure
      : FailureScenario.MessageDeliveryFailure;
  }

  if (err instanceof GatewayError) {
    if (err.gatewayType === "telegram") {
      return FailureScenario.TelegramNotificationFailure;
    }
    if (err.gatewayType === "mcp-server" || err.gatewayType === "mcp-client") {
      return FailureScenario.MCPToolExecutionFailure;
    }
    return undefined;
  }

  if (err instanceof AgentError) {
    return FailureScenario.AgentHeartbeatFailure;
  }

  return undefined;
}

/** Heuristic mapping for plain Error objects. */
function mapPlainErrorToScenario(err: Error): FailureScenario | undefined {
  const msg = err.message.toLowerCase();

  // Heartbeat patterns
  if (
    msg.includes("heartbeat") ||
    msg.includes("missed heartbeat")
  ) {
    return FailureScenario.AgentHeartbeatFailure;
  }

  // LLM / provider patterns
  if (
    msg.includes("provider") ||
    msg.includes("llm") ||
    msg.includes("openai") ||
    msg.includes("completion") ||
    msg.includes("chat completion")
  ) {
    return FailureScenario.LLMProviderFailure;
  }

  // Memory / LanceDB patterns
  if (
    msg.includes("lancedb") ||
    msg.includes("vector store") ||
    msg.includes("memory store") ||
    msg.includes("embedding")
  ) {
    return FailureScenario.MemoryStoreFailure;
  }

  // Kanban patterns
  if (
    msg.includes("kanban") ||
    msg.includes("board") ||
    msg.includes("sqlite") ||
    msg.includes("better-sqlite3")
  ) {
    return FailureScenario.KanbanPersistenceFailure;
  }

  // MCP / tool patterns
  if (
    msg.includes("mcp") ||
    msg.includes("tool") ||
    msg.includes("tool execution")
  ) {
    return FailureScenario.MCPToolExecutionFailure;
  }

  // Telegram patterns
  if (
    msg.includes("telegram") ||
    msg.includes("telegraf") ||
    msg.includes("bot")
  ) {
    return FailureScenario.TelegramNotificationFailure;
  }

  // Message delivery patterns
  if (
    msg.includes("message") &&
    (msg.includes("deliver") || msg.includes("send"))
  ) {
    return FailureScenario.MessageDeliveryFailure;
  }

  return undefined;
}
