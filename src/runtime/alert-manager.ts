/**
 * Alert Manager for Strategos.
 *
 * Smart alerting with consecutive failure counting, cooldown periods,
 * and escalation tiers. Subscribes to the ErrorBus and sends Telegram
 * notifications when errors persist beyond configured thresholds.
 *
 * Design principles:
 * - Never spam: consecutive failure counting + cooldown periods
 * - Escalate progressively: log → warn → notify → critical
 * - User-safe messages: never leak API keys, tokens, or stack traces
 * - Listener safety: no throwing from event handlers
 * - Singleton access via exported `AlertManagerInstance` constant
 *
 * Usage:
 *   import { AlertManagerInstance } from "./runtime/alert-manager.js";
 *
 *   AlertManagerInstance.start();
 *
 *   // Add custom rules
 *   AlertManagerInstance.addRule({
 *     component: "my-component",
 *     consecutiveThreshold: 2,
 *     cooldownMs: 60000,
 *     tier: "warn",
 *   });
 *
 *   // After recovery, reset the counter
 *   AlertManagerInstance.resetCounter("llm-provider:ceo-strategic");
 *
 *   // Stop on shutdown
 *   AlertManagerInstance.stop();
 *
 * @module alert-manager
 */

import { ErrorBus, ErrorEventType, ErrorEvent } from "./error-emitter.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// AlertTier
// ---------------------------------------------------------------------------

/**
 * Escalation tiers for alerting.
 *
 * - `log`     — logger.error (already done by ErrorBus, effectively a no-op for AlertManager)
 * - `warn`    — logger.warn + emit `error:escalated` via ErrorBus
 * - `notify`  — send Telegram message with formatted alert
 * - `critical` — send Telegram + logger.error + emit `error:escalated`
 */
export type AlertTier = "log" | "warn" | "notify" | "critical";

// ---------------------------------------------------------------------------
// AlertRule
// ---------------------------------------------------------------------------

/**
 * A rule that determines when and how to alert for a given component.
 *
 * Rules are matched in order of specificity:
 * 1. Exact component + agentId match
 * 2. Exact component match (any agent)
 * 3. Wildcard component + agentId match
 * 4. Wildcard component match (any agent)
 * 5. Catch-all (`*`) rule
 */
export interface AlertRule {
  /** Which component this rule applies to. Use `'*'` for all components.
   *  Supports glob-style wildcards: `'persistence-*'`, `'gateway-*'`. */
  component: string;
  /** Optional: only apply this rule for a specific agent. */
  agentId?: string;
  /** Alert after N consecutive failures from this component. */
  consecutiveThreshold: number;
  /** Minimum milliseconds between alerts for the same component. */
  cooldownMs: number;
  /** The escalation tier for this rule (base tier before escalation). */
  tier: AlertTier;
  /** Override the default alert message template. */
  customMessage?: string;
}

// ---------------------------------------------------------------------------
// AlertState
// ---------------------------------------------------------------------------

/**
 * Internal tracking state for a component's alert status.
 *
 * One AlertState exists per unique `${component}:${agentId || 'global'}` key.
 */
export interface AlertState {
  /** Composite key: `${component}:${agentId || 'global'}`. */
  key: string;
  /** The subsystem that emitted errors. */
  component: string;
  /** The agent involved, if known. */
  agentId?: string;
  /** Current count of consecutive failures (reset on recovery). */
  consecutiveFailures: number;
  /** Timestamp of the last alert sent (for cooldown enforcement). */
  lastAlertAt?: number;
  /** Timestamp of the most recent error event. */
  lastEventAt?: number;
  /** Timestamp when the current failure streak began. */
  firstFailureAt?: number;
  /** Current escalation tier. */
  tier: AlertTier;
  /** Total number of alerts sent for this component since last reset. */
  totalAlertsSent: number;
}

// ---------------------------------------------------------------------------
// AlertManagerOptions
// ---------------------------------------------------------------------------

/** Configuration options for the AlertManager. */
export interface AlertManagerOptions {
  /** Override the default Telegram chat ID. */
  telegramChatId?: string;
  /** Default consecutive failures before alerting. Default: 3. */
  defaultThreshold?: number;
  /** Default cooldown between alerts in ms. Default: 300000 (5 min). */
  defaultCooldownMs?: number;
  /** Cap escalation at this tier. Default: 'critical'. */
  maxTier?: AlertTier;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 300_000; // 5 minutes
const DEFAULT_MAX_TIER: AlertTier = "critical";

/** Tier ordering for escalation comparison. */
const TIER_LEVELS: Record<AlertTier, number> = {
  log: 0,
  warn: 1,
  notify: 2,
  critical: 3,
};

/** Return true if tier `a` is at or above tier `b`. */
function tierAtOrAbove(a: AlertTier, b: AlertTier): boolean {
  return TIER_LEVELS[a] >= TIER_LEVELS[b];
}

/** Return the higher of two tiers. */
function maxTier(a: AlertTier, b: AlertTier): AlertTier {
  return tierAtOrAbove(a, b) ? a : b;
}

/** Cap a tier at the given maximum. */
function capTier(tier: AlertTier, max: AlertTier): AlertTier {
  return tierAtOrAbove(tier, max) ? max : tier;
}

// ---------------------------------------------------------------------------
// Default Alert Rules
// ---------------------------------------------------------------------------

const DEFAULT_RULES: AlertRule[] = [
  // LLM provider — alert after 3 failures, 5min cooldown
  {
    component: "llm-provider",
    consecutiveThreshold: 3,
    cooldownMs: 300_000,
    tier: "warn",
  },
  // Heartbeat — alert after 2 missed, 10min cooldown
  {
    component: "heartbeat",
    consecutiveThreshold: 2,
    cooldownMs: 600_000,
    tier: "notify",
  },
  // Tool execution — alert after 5 failures, 15min cooldown
  {
    component: "tool-executor",
    consecutiveThreshold: 5,
    cooldownMs: 900_000,
    tier: "warn",
  },
  // Persistence — alert after 1 failure (critical), 5min cooldown
  {
    component: "persistence-*",
    consecutiveThreshold: 1,
    cooldownMs: 300_000,
    tier: "critical",
  },
  // Gateway — alert after 2 failures, 5min cooldown
  {
    component: "gateway-*",
    consecutiveThreshold: 2,
    cooldownMs: 300_000,
    tier: "notify",
  },
];

// ---------------------------------------------------------------------------
// Helpers: component matching
// ---------------------------------------------------------------------------

/**
 * Check if a component name matches a rule's component pattern.
 *
 * Supports:
 * - Exact match: `"llm-provider"` matches `"llm-provider"`
 * - Wildcard suffix: `"persistence-*"` matches `"persistence-memory"`
 * - Catch-all: `"*"` matches everything
 */
function componentMatches(pattern: string, component: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("-*")) {
    const prefix = pattern.slice(0, -1); // "persistence-*" → "persistence-"
    return component.startsWith(prefix);
  }
  return pattern === component;
}

// ---------------------------------------------------------------------------
// Helpers: user-safe message sanitization
// ---------------------------------------------------------------------------

/** Patterns that indicate sensitive data in error messages. */
const SENSITIVE_PATTERNS: RegExp[] = [
  // API keys, tokens, secrets
  /[a-zA-Z0-9_-]*[aA]pi[_-]?[kK]ey["']?\s*[:=]\s*["']?[^\s"']+/g,
  /[a-zA-Z0-9_-]*[sS]ecret["']?\s*[:=]\s*["']?[^\s"']+/g,
  /[a-zA-Z0-9_-]*[tT]oken["']?\s*[:=]\s*["']?[^\s"']+/g,
  /[bB]earer\s+[A-Za-z0-9_\-\.]+/g,
  // Stack traces
  /\n\s*at\s+[^\n]+/g,
  // File paths that might contain secrets
  /(\/home\/[a-zA-Z0-9_-]+\/\.[a-zA-Z0-9_-]+\/[^\s]+)/g,
  // URLs with query parameters (may contain tokens)
  /(https?:\/\/[^\s]+\?[^\s]*token[^\s]*)/gi,
  // JSON-like key-value pairs with sensitive keys
  /"(?:apiKey|api_key|secret|token|password|auth|credential|Authorization)"\s*:\s*"[^"]+"/gi,
];

/**
 * Sanitize an error message to remove sensitive data.
 *
 * Strips API keys, tokens, passwords, secrets, stack traces,
 * and file paths that might contain credentials.
 */
function sanitizeMessage(message: string): string {
  let sanitized = message;

  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }

  // Truncate very long messages
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 497) + "...";
  }

  return sanitized.trim();
}

/**
 * Extract a user-safe, actionable description from an error.
 * Uses known component types to generate helpful messages.
 */
function describeError(event: ErrorEvent): string {
  const component = event.component;
  const msg = event.message;

  // Known component patterns → helpful descriptions
  if (component === "llm-provider" || componentMatches("gateway-mcp-*", component)) {
    if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("timed out")) {
      return "LLM provider request timed out";
    }
    if (msg.toLowerCase().includes("rate limit") || msg.includes("429")) {
      return "API rate limit reached";
    }
    if (msg.toLowerCase().includes("context") || msg.toLowerCase().includes("token")) {
      return "Context window or token limit exceeded";
    }
    if (msg.toLowerCase().includes("auth") || msg.includes("401") || msg.includes("403")) {
      return "Authentication or authorization issue detected";
    }
    if (msg.toLowerCase().includes("5") && /status\s*(5\d{2})|5\d{2}/.test(msg)) {
      return "Provider returned a server error";
    }
    return sanitizeMessage(msg);
  }

  if (component === "heartbeat") {
    return `Agent heartbeat missed — agent may be unresponsive`;
  }

  if (component === "tool-executor") {
    return `Tool execution failed — tool may be unavailable or misconfigured`;
  }

  if (component.startsWith("persistence-")) {
    return `Storage subsystem failure — data persistence may be compromised`;
  }

  if (component.startsWith("gateway-")) {
    return `Gateway service failure — connectivity may be disrupted`;
  }

  // Fallback: sanitize and truncate
  return sanitizeMessage(msg);
}

/**
 * Suggest a user action based on the component and error type.
 */
function suggestAction(component: string, consecutiveFailures: number): string {
  if (component === "llm-provider") {
    if (consecutiveFailures >= 5) {
      return "All model fallbacks exhausted. Check API key balance, provider status, or network connectivity.";
    }
    if (consecutiveFailures >= 3) {
      return "Check API key balance or provider status. Model fallback chain may be activating.";
    }
    return "Monitor for continued failures. Fallback models may handle subsequent requests.";
  }

  if (component === "heartbeat") {
    if (consecutiveFailures >= 3) {
      return "Agent appears unresponsive. Check agent logs and consider manual restart.";
    }
    return "Agent may be temporarily overloaded. Monitor for recovery.";
  }

  if (component === "tool-executor") {
    return "Check MCP server status and tool availability. Review tool configuration.";
  }

  if (component.startsWith("persistence-")) {
    return "CRITICAL: Check disk space and database connectivity. Data integrity may be at risk.";
  }

  if (component.startsWith("gateway-")) {
    return "Check service connectivity and port availability. Restart may be required.";
  }

  return `Investigate ${component} logs for root cause. Consider manual intervention if failures persist.`;
}

// ---------------------------------------------------------------------------
// Helpers: duration formatting
// ---------------------------------------------------------------------------

/** Format a duration in ms to a human-readable string. */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainingMin = minutes % 60;
    return remainingMin > 0 ? `${hours}h ${remainingMin}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

// ---------------------------------------------------------------------------
// Helpers: alert message formatting
// ---------------------------------------------------------------------------

/** Emoji indicators for each tier. */
const TIER_EMOJI: Record<AlertTier, string> = {
  log: "📝",
  warn: "🟡",
  notify: "🔵",
  critical: "🔴",
};

/** Human-readable tier labels. */
const TIER_LABELS: Record<AlertTier, string> = {
  log: "Log",
  warn: "Warning",
  notify: "Notification",
  critical: "Critical",
};

/**
 * Format a user-safe alert message for Telegram.
 *
 * Never includes raw error messages that might contain API keys,
 * tokens, or stack traces. Uses emoji indicators and keeps
 * messages under 4000 characters (Telegram limit).
 *
 * Example:
 * ```
 * 🔴 **Strategos Alert: LLM Provider Failure**
 *
 * Agent: CEO (ceo-strategic)
 * Component: llm-provider
 * Failures: 3 consecutive (started 5 min ago)
 * Status: All model fallbacks exhausted
 * Action Required: Check API key balance or provider status
 * ```
 */
export function formatAlertMessage(
  event: ErrorEvent,
  state: AlertState,
  tier: AlertTier,
): string {
  const emoji = TIER_EMOJI[tier];
  const label = TIER_LABELS[tier];

  // Component display name
  const componentName = event.component
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Agent display
  const agentPart = event.agentId
    ? `\nAgent: ${event.agentId}`
    : "";

  // Time since first failure
  const duration = state.firstFailureAt
    ? formatDuration(Date.now() - state.firstFailureAt)
    : "just now";

  // Error description (user-safe)
  const description = describeError(event);

  // Suggested action
  const action = suggestAction(event.component, state.consecutiveFailures);

  // Build message
  const parts: string[] = [
    `${emoji} **Strategos Alert: ${componentName}**`,
    "",
    `Tier: ${label}`,
    `Component: ${event.component}`,
    ...(agentPart ? [agentPart] : []),
    `Failures: ${state.consecutiveFailures} consecutive (started ${duration} ago)`,
    `Status: ${description}`,
    "",
    `Action Required: ${action}`,
  ];

  let message = parts.join("\n");

  // Enforce Telegram's 4000-character limit
  if (message.length > 4000) {
    // Truncate the description and action fields
    const maxDesc = 200;
    const maxAction = 300;
    const truncatedDesc =
      description.length > maxDesc
        ? description.slice(0, maxDesc - 3) + "..."
        : description;
    const truncatedAction =
      action.length > maxAction
        ? action.slice(0, maxAction - 3) + "..."
        : action;

    parts[parts.findIndex((p) => p.startsWith("Status:"))] = `Status: ${truncatedDesc}`;
    parts[parts.findIndex((p) => p.startsWith("Action Required:"))] = `Action Required: ${truncatedAction}`;
    message = parts.join("\n");
  }

  return message;
}

/**
 * Format a recovery notification message.
 */
function formatRecoveryMessage(event: ErrorEvent): string {
  const componentName = event.component
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const agentPart = event.agentId ? `\nAgent: ${event.agentId}` : "";

  return `✅ **Strategos Recovered: ${componentName}**${agentPart}\n\nThe ${event.component} subsystem has recovered. Consecutive failure counter has been reset.`;
}

// ---------------------------------------------------------------------------
// AlertManager class
// ---------------------------------------------------------------------------

/**
 * Smart alerting with consecutive failure counting, cooldown periods,
 * and escalation tiers.
 *
 * Subscribes to the ErrorBus for error and recovery events.
 * Tracks consecutive failures per component and sends Telegram
 * notifications when thresholds are exceeded.
 */
export class AlertManagerClass {
  private static instance: AlertManagerClass | null = null;

  /** Registered alert rules. */
  private rules: AlertRule[] = [];

  /** Per-component alert state. */
  private states: Map<string, AlertState> = new Map();

  /** Unsubscribe functions from ErrorBus listeners. */
  private unsubscribers: Array<() => void> = [];

  /** Whether the alert manager is currently running. */
  private running = false;

  /** Promise guarding concurrent start() calls. */
  private startPromise: Promise<void> | null = null;

  /** Resolved options. */
  private opts: {
    telegramChatId?: string;
    defaultThreshold: number;
    defaultCooldownMs: number;
    maxTier: AlertTier;
  };

  private constructor(options?: AlertManagerOptions) {
    this.opts = {
      telegramChatId: options?.telegramChatId,
      defaultThreshold: options?.defaultThreshold ?? DEFAULT_THRESHOLD,
      defaultCooldownMs: options?.defaultCooldownMs ?? DEFAULT_COOLDOWN_MS,
      maxTier: options?.maxTier ?? DEFAULT_MAX_TIER,
    };

    // Register default rules
    for (const rule of DEFAULT_RULES) {
      this.rules.push(rule);
    }

    logger.info(
      { ruleCount: this.rules.length },
      "AlertManager: initialized with default rules",
    );
  }

  /**
   * Get the singleton instance.
   *
   * Options are only applied on first call; subsequent calls ignore them.
   */
  static getInstance(options?: AlertManagerOptions): AlertManagerClass {
    if (!AlertManagerClass.instance) {
      AlertManagerClass.instance = new AlertManagerClass(options);
    }
    return AlertManagerClass.instance;
  }

  /**
   * Reset the singleton (useful for testing).
   * Stops the manager and clears all state.
   */
  static reset(): void {
    if (AlertManagerClass.instance) {
      AlertManagerClass.instance.stop();
      AlertManagerClass.instance.rules = [];
      AlertManagerClass.instance.states.clear();
      AlertManagerClass.instance = null;
    }
  }

  // -----------------------------------------------------------------------
  // start / stop / cleanup
  // -----------------------------------------------------------------------

  /**
   * Subscribe to the ErrorBus and begin monitoring for errors.
   *
   * Idempotent — safe to call multiple times.
   */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      if (this.running) return;
      this.running = true;

      const errorTypes: Array<ErrorEventType | "*"> = [
        "error:detected",
        "cron:failed",
        "heartbeat:missed",
        "tool:failed",
        "provider:failed",
        "persistence:failed",
        "agent:error",
        "gateway:down",
      ];

      for (const eventType of errorTypes) {
        const unsub = ErrorBus.on(eventType, (event) =>
          this.handleErrorEvent(event),
        );
        this.unsubscribers.push(unsub);
      }

      const recoveryUnsub = ErrorBus.on("error:recovered", (event) =>
        this.handleRecoveryEvent(event),
      );
      this.unsubscribers.push(recoveryUnsub);

      logger.info("AlertManager: started — monitoring error bus");
    })();
    return this.startPromise;
  }

  /**
   * Sweep stale entries from the states Map.
   * Removes entries with zero consecutive failures and lastEventAt older than 24 hours.
   * Idempotent — safe to call at any time.
   */
  cleanup(): void {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;
    for (const [key, state] of this.states) {
      if (state.consecutiveFailures === 0 && state.lastEventAt && (now - state.lastEventAt) > ONE_DAY) {
        this.states.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info({ cleaned }, "AlertManager: stale states cleaned");
    }
  }

  /**
   * Unsubscribe from the ErrorBus and stop monitoring.
   *
   * Does NOT clear alert state — use `reset()` for that.
   * Calls cleanup() to prune stale entries before stopping.
   * Idempotent — safe to call multiple times.
   */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;

    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch (err) {
        logger.warn({ err }, "AlertManager: error during unsubscribe");
      }
    }
    this.unsubscribers = [];

    this.cleanup();

    logger.info("AlertManager: stopped");
  }

  // -----------------------------------------------------------------------
  // Rule management
  // -----------------------------------------------------------------------

  /**
   * Add a custom alert rule.
   *
   * Rules are appended to the end of the rule list and evaluated
   * in order (first match wins).
   */
  addRule(rule: AlertRule): void {
    this.rules.push(rule);
    logger.info(
      { component: rule.component, tier: rule.tier, threshold: rule.consecutiveThreshold },
      "AlertManager: rule added",
    );
  }

  /**
   * Remove a rule by component and optional tier.
   *
   * If tier is specified, only removes rules matching both component and tier.
   * If tier is omitted, removes all rules for the component.
   */
  removeRule(component: string, tier?: AlertTier): void {
    const before = this.rules.length;
    this.rules = this.rules.filter(
      (r) =>
        !(
          r.component === component &&
          (tier === undefined || r.tier === tier)
        ),
    );
    const removed = before - this.rules.length;
    if (removed > 0) {
      logger.info(
        { component, tier, removed },
        "AlertManager: rule(s) removed",
      );
    }
  }

  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------

  /**
   * Reset the consecutive failure counter for a specific key.
   *
   * Called by the self-healer after successful recovery.
   *
   * @param key - The alert state key (`${component}:${agentId || 'global'}`).
   */
  resetCounter(key: string): void {
    const state = this.states.get(key);
    if (state) {
      state.consecutiveFailures = 0;
      state.firstFailureAt = undefined;
      logger.info({ key }, "AlertManager: counter reset");
    }
  }

  /**
   * Get the current alert state for a specific key.
   */
  getState(key: string): AlertState | undefined {
    return this.states.get(key);
  }

  /**
   * Get all current alert states.
   */
  getAllStates(): AlertState[] {
    return Array.from(this.states.values());
  }

  // -----------------------------------------------------------------------
  // Public: formatAlertMessage (exposed for external use)
  // -----------------------------------------------------------------------

  /**
   * Format a user-safe alert message.
   *
   * This is the public wrapper around the module-level `formatAlertMessage`
   * function, bound to this instance's maxTier setting.
   */
  formatAlertMessage(
    event: ErrorEvent,
    state: AlertState,
    tier: AlertTier,
  ): string {
    const cappedTier = capTier(tier, this.opts.maxTier);
    return formatAlertMessage(event, state, cappedTier);
  }

  // -----------------------------------------------------------------------
  // Internal: event handling
  // -----------------------------------------------------------------------

  /**
   * Handle an error event from the ErrorBus.
   * Wrapped in try/catch for listener safety.
   */
  private handleErrorEvent(event: ErrorEvent): void {
    try {
      this.processErrorEvent(event);
    } catch (err) {
      logger.error(
        { err, eventType: event.type, component: event.component },
        "AlertManager: unhandled error in event handler",
      );
    }
  }

  /**
   * Handle a recovery event from the ErrorBus.
   * Wrapped in try/catch for listener safety.
   */
  private handleRecoveryEvent(event: ErrorEvent): void {
    try {
      this.processRecoveryEvent(event);
    } catch (err) {
      logger.error(
        { err, eventType: event.type, component: event.component },
        "AlertManager: unhandled error in recovery handler",
      );
    }
  }

  /**
   * Core error event processing:
   * 1. Look up or create AlertState for component+agentId
   * 2. Increment consecutiveFailures
   * 3. Find matching AlertRule
   * 4. If threshold met and cooldown elapsed, escalate and alert
   */
  private processErrorEvent(event: ErrorEvent): void {
    const component = event.component;
    const agentId = event.agentId;
    const key = `${component}:${agentId || "global"}`;
    const now = Date.now();

    // Get or create state
    let state = this.states.get(key);
    if (!state) {
      state = {
        key,
        component,
        agentId,
        consecutiveFailures: 0,
        lastEventAt: now,
        tier: "log",
        totalAlertsSent: 0,
      };
      this.states.set(key, state);
    }

    // Increment consecutive failures
    state.consecutiveFailures += 1;
    state.lastEventAt = now;

    // Track when the failure streak started
    if (!state.firstFailureAt) {
      state.firstFailureAt = now;
    }

    // Find the matching rule
    const rule = this.findMatchingRule(component, agentId);
    if (!rule) {
      // No rule for this component — just track state
      return;
    }

    // Check if we should alert
    const thresholdMet = state.consecutiveFailures >= rule.consecutiveThreshold;
    const cooldownElapsed =
      !state.lastAlertAt || now - state.lastAlertAt >= rule.cooldownMs;

    if (thresholdMet && cooldownElapsed) {
      this.executeAlert(event, state, rule);
    }
  }

  /**
   * Core recovery event processing:
   * 1. Reset consecutiveFailures for the recovered component
   * 2. Emit error:recovered via ErrorBus
   */
  private processRecoveryEvent(event: ErrorEvent): void {
    const component = event.component;

    // Reset all states for this component (recovery likely fixes the root cause)
    let resetCount = 0;
    for (const [key, state] of this.states) {
      if (state.component === component) {
        state.consecutiveFailures = 0;
        state.firstFailureAt = undefined;
        resetCount++;
      }
    }

    if (resetCount > 0) {
      logger.info(
        { component, resetCount },
        "AlertManager: recovery — counters reset",
      );

      // Emit recovery notification via ErrorBus
      ErrorBus.emit({
        type: "error:recovered",
        severity: "info",
        component: "alert-manager",
        error: null,
        message: `Alert counters reset for ${component} (${resetCount} key(s))`,
        agentId: event.agentId,
        context: {
          resetCount,
          component,
          originalEventId: event.id,
        },
      });
    }
  }

  /**
   * Execute an alert based on the current state and rule.
   *
   * Determines the escalation tier, formats a user-safe message,
   * and executes the appropriate alert action.
   */
  private executeAlert(
    event: ErrorEvent,
    state: AlertState,
    rule: AlertRule,
  ): void {
    const now = Date.now();

    // Determine escalation tier based on totalAlertsSent:
    // 0 → warn, 1 → notify, 2+ → critical
    let tier: AlertTier;
    if (state.totalAlertsSent === 0) {
      tier = "warn";
    } else if (state.totalAlertsSent === 1) {
      tier = "notify";
    } else {
      tier = "critical";
    }

    // Ensure tier is at least the rule's configured tier
    tier = maxTier(tier, rule.tier);

    // Cap at maxTier
    tier = capTier(tier, this.opts.maxTier);

    // Update state
    state.lastAlertAt = now;
    state.totalAlertsSent += 1;
    state.tier = tier;

    // Format user-safe message
    const message = this.formatAlertMessage(event, state, tier);

    // Execute alert action based on tier
    this.executeTierAction(tier, event, state, message);

    logger.info(
      {
        component: state.component,
        agentId: state.agentId,
        tier,
        consecutiveFailures: state.consecutiveFailures,
        totalAlertsSent: state.totalAlertsSent,
      },
      `AlertManager: alert sent [${tier}]`,
    );
  }

  /**
   * Execute the alert action for a given tier.
   *
   * - 'log': no-op (ErrorBus already logs)
   * - 'warn': logger.warn + emit error:escalated
   * - 'notify': send Telegram message
   * - 'critical': send Telegram + logger.error + emit error:escalated
   */
  private executeTierAction(
    tier: AlertTier,
    event: ErrorEvent,
    state: AlertState,
    message: string,
  ): void {
    switch (tier) {
      case "log":
        // ErrorBus already logs every event — nothing extra needed
        break;

      case "warn":
        logger.warn(
          {
            component: state.component,
            agentId: state.agentId,
            consecutiveFailures: state.consecutiveFailures,
          },
          message,
        );
        this.emitEscalated(event, state, message);
        break;

      case "notify":
        this.sendTelegram(message).catch((err) => {
          logger.error(
            { err, component: state.component },
            "AlertManager: Telegram send failed, falling back to log",
          );
          logger.error(
            { component: state.component, agentId: state.agentId },
            message,
          );
          this.emitEscalated(event, state, message);
        });
        break;

      case "critical":
        logger.error(
          {
            component: state.component,
            agentId: state.agentId,
            consecutiveFailures: state.consecutiveFailures,
            totalAlertsSent: state.totalAlertsSent,
          },
          message,
        );
        this.sendTelegram(message).catch((err) => {
          logger.error(
            { err, component: state.component },
            "AlertManager: Telegram send failed for CRITICAL alert",
          );
        });
        this.emitEscalated(event, state, message);
        break;
    }
  }

  /**
   * Emit an error:escalated event via ErrorBus.
   */
  private emitEscalated(
    event: ErrorEvent,
    state: AlertState,
    message: string,
  ): void {
    try {
      ErrorBus.emit({
        type: "error:escalated",
        severity: "critical",
        component: "alert-manager",
        error: event.error,
        message: `Alert escalated [${state.tier}]: ${state.component} (${state.consecutiveFailures} consecutive failures)`,
        agentId: state.agentId,
        context: {
          alertTier: state.tier,
          consecutiveFailures: state.consecutiveFailures,
          totalAlertsSent: state.totalAlertsSent,
          originalEventId: event.id,
          originalMessage: event.message,
          alertMessage: message,
        },
      });
    } catch (err) {
      logger.error(
        { err, component: state.component },
        "AlertManager: failed to emit error:escalated",
      );
    }
  }

  /**
   * Send a message via Telegram.
   *
   * Uses dynamic import to avoid circular dependencies.
   * Falls back to logger.error if Telegram is unavailable.
   */
  private async sendTelegram(message: string): Promise<void> {
    try {
      const { sendTelegramMessage } = await import(
        "../integrations/telegram.js"
      );
      const ok = await sendTelegramMessage(message, "urgent");
      if (!ok) {
        logger.warn(
          "AlertManager: Telegram send returned false — bot may not be initialized",
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: msg },
        "AlertManager: Telegram dynamic import or send failed",
      );
      throw err; // Re-throw so the caller can fall back to logging
    }
  }

  /**
   * Find the best matching AlertRule for a component and optional agentId.
   *
   * Matching priority (highest to lowest):
   * 1. Exact component + exact agentId
   * 2. Exact component (any agent)
   * 3. Wildcard component + exact agentId
   * 4. Wildcard component (any agent)
   * 5. Catch-all (`*`) rule
   */
  private findMatchingRule(
    component: string,
    agentId?: string,
  ): AlertRule | undefined {
    let bestMatch: AlertRule | undefined;
    let bestScore = -1;

    for (const rule of this.rules) {
      if (!componentMatches(rule.component, component)) {
        continue;
      }

      let score = 0;

      // Wildcard component gets lower score than exact match
      if (rule.component === "*") {
        score = 1;
      } else if (rule.component.endsWith("-*")) {
        score = 10;
      } else {
        score = 100; // Exact component match
      }

      // AgentId match adds bonus
      if (rule.agentId === agentId) {
        score += 50;
      } else if (rule.agentId && agentId) {
        continue; // Rule specifies agentId but doesn't match
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = rule;
      }
    }

    return bestMatch;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Ready-to-use singleton instance of the AlertManagerClass.
 *
 * Import this directly:
 * ```ts
 * import { AlertManagerInstance } from "./runtime/alert-manager.js";
 * AlertManagerInstance.start();
 * ```
 *
 * To customize options, call getInstance() before the singleton is accessed:
 * ```ts
 * import { AlertManagerClass } from "./runtime/alert-manager.js";
 * AlertManagerClass.getInstance({ defaultThreshold: 5 });
 * ```
 */
export const AlertManagerInstance = AlertManagerClass.getInstance();
