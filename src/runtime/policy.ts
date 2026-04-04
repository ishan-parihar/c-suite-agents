// Policy Engine — rule-based operational decisions replacing hardcoded logic
// Evaluates conditions against operational state and returns prioritised actions
//
// Design:
// - Conditions support atomic checks (agent_status, card_age, memory_count, etc.)
//   and combinator checks (and, or) for arbitrary nesting
// - Actions support atomic operations (escalate, notify, reassign, compact, abort)
//   and chain for sequential multi-action execution
// - Rules are priority-ordered; evaluate() returns matching actions sorted by priority
// - Self-contained: no external dependencies, no circular imports

// ── PolicyCondition ─────────────────────────────────────────────────

/**
 * Atomic condition: checks if the agent's current status matches a value.
 * Valid values include "active", "idle", "blocked", "stale", "error".
 */
export interface ConditionAgentStatus {
  type: "agent_status";
  status: string;
}

/**
 * Atomic condition: checks if any card has been in a column for longer than
 * the given number of hours.
 */
export interface ConditionCardAge {
  type: "card_age";
  hours: number;
}

/**
 * Atomic condition: checks if the agent's memory count exceeds a threshold.
 */
export interface ConditionMemoryCount {
  type: "memory_count";
  threshold: number;
}

/**
 * Atomic condition: checks if the unread message backlog exceeds a threshold.
 */
export interface ConditionMessageBacklog {
  type: "message_backlog";
  threshold: number;
}

/**
 * Atomic condition: checks if the agent has failed N consecutive heartbeats.
 */
export interface ConditionConsecutiveFailures {
  type: "consecutive_failures";
  count: number;
}

/**
 * Atomic condition: checks if the session token count exceeds a threshold.
 */
export interface ConditionSessionTokenCount {
  type: "session_token_count";
  threshold: number;
}

/**
 * Combinator: all child conditions must match (logical AND).
 */
export interface ConditionAnd {
  type: "and";
  conditions: PolicyCondition[];
}

/**
 * Combinator: at least one child condition must match (logical OR).
 */
export interface ConditionOr {
  type: "or";
  conditions: PolicyCondition[];
}

/**
 * A condition that can be evaluated against a LaneContext.
 * Atomic conditions check a single operational metric;
 * combinator conditions nest multiple conditions.
 */
export type PolicyCondition =
  | ConditionAgentStatus
  | ConditionCardAge
  | ConditionMemoryCount
  | ConditionMessageBacklog
  | ConditionConsecutiveFailures
  | ConditionSessionTokenCount
  | ConditionAnd
  | ConditionOr;

// ── PolicyAction ────────────────────────────────────────────────────

/**
 * Escalate an issue to a manager or user with a reason string.
 */
export interface ActionEscalate {
  type: "escalate";
  reason: string;
  target?: string; // manager agent ID or "user"
}

/**
 * Send a notification via a specified channel.
 */
export interface ActionNotify {
  type: "notify";
  channel: "telegram" | "message";
  message: string;
}

/**
 * Reassign a card or task from one agent to another.
 */
export interface ActionReassign {
  type: "reassign";
  cardId: string;
  fromAgent: string;
  toAgent: string;
}

/**
 * Trigger session compaction for the given agent.
 */
export interface ActionCompact {
  type: "compact";
  reason: string;
}

/**
 * Abort the current agent execution.
 */
export interface ActionAbort {
  type: "abort";
  reason: string;
}

/**
 * Execute multiple actions in sequence.
 */
export interface ActionChain {
  type: "chain";
  actions: PolicyAction[];
}

/**
 * An action returned by the policy engine when a rule matches.
 * Atomic actions perform a single operation; chain actions nest multiple.
 */
export type PolicyAction =
  | ActionEscalate
  | ActionNotify
  | ActionReassign
  | ActionCompact
  | ActionAbort
  | ActionChain;

// ── PolicyRule ──────────────────────────────────────────────────────

/**
 * A single policy rule: when the condition matches the LaneContext,
 * the associated action(s) fire. Rules are ordered by priority
 * (lower number = higher priority).
 */
export interface PolicyRule {
  name: string;
  condition: PolicyCondition;
  action: PolicyAction;
  priority: number;
  enabled: boolean;
}

// ── LaneContext ─────────────────────────────────────────────────────

/**
 * Operational state of a single agent lane at a point in time.
 * The policy engine evaluates conditions against this snapshot.
 */
export interface LaneContext {
  /** Agent identifier (e.g., "ceo", "coo") */
  agentId: string;
  /** Current status: "active", "idle", "blocked", "stale", "error" */
  agentStatus: string;
  /** Number of cards on the agent's board */
  cardCount: number;
  /** Age in hours of the oldest card on the board */
  oldestCardHours: number;
  /** Total number of memories stored for this agent */
  memoryCount: number;
  /** Number of unread messages in the agent's inbox */
  unreadMessages: number;
  /** Consecutive failed heartbeats */
  consecutiveFailures: number;
  /** Total tokens consumed in the current session */
  sessionTokenCount: number;
}

// ── PolicyEngine ────────────────────────────────────────────────────

/**
 * Rule-based policy engine for operational decisions.
 *
 * Register rules with {@link register}, then call {@link evaluate} with a
 * LaneContext to get all matching actions sorted by priority (ascending).
 *
 * ```ts
 * const engine = new PolicyEngine();
 * engine.register({
 *   name: "stale-card-escalation",
 *   condition: { type: "card_age", hours: 48 },
 *   action: { type: "escalate", reason: "Card stale > 48h" },
 *   priority: 1,
 *   enabled: true,
 * });
 *
 * const actions = engine.evaluate({
 *   agentId: "coo",
 *   agentStatus: "active",
 *   cardCount: 5,
 *   oldestCardHours: 50,
 *   memoryCount: 200,
 *   unreadMessages: 3,
 *   consecutiveFailures: 0,
 *   sessionTokenCount: 50000,
 * });
 * // => [{ type: "escalate", reason: "Card stale > 48h" }]
 * ```
 */
export class PolicyEngine {
  private rules: Map<string, PolicyRule> = new Map();

  /**
   * Register a rule. Overwrites any existing rule with the same name.
   */
  register(rule: PolicyRule): void {
    this.rules.set(rule.name, rule);
  }

  /**
   * Evaluate all enabled rules against the given LaneContext.
   * Returns matching actions sorted by priority (ascending — lower number fires first).
   */
  evaluate(ctx: LaneContext): PolicyAction[] {
    const enabledRules = Array.from(this.rules.values())
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority);

    const matched: PolicyAction[] = [];
    for (const rule of enabledRules) {
      if (this.matchCondition(rule.condition, ctx)) {
        matched.push(rule.action);
      }
    }
    return matched;
  }

  /**
   * Return all registered rules (including disabled ones).
   */
  listRules(): PolicyRule[] {
    return Array.from(this.rules.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Enable a rule by name. No-op if the rule does not exist.
   */
  enableRule(name: string): void {
    const rule = this.rules.get(name);
    if (rule) rule.enabled = true;
  }

  /**
   * Disable a rule by name. No-op if the rule does not exist.
   */
  disableRule(name: string): void {
    const rule = this.rules.get(name);
    if (rule) rule.enabled = false;
  }

  // ── Condition Matching ─────────────────────────────────────────────

  private matchCondition(condition: PolicyCondition, ctx: LaneContext): boolean {
    switch (condition.type) {
      case "agent_status":
        return ctx.agentStatus === condition.status;

      case "card_age":
        return ctx.oldestCardHours > condition.hours;

      case "memory_count":
        return ctx.memoryCount > condition.threshold;

      case "message_backlog":
        return ctx.unreadMessages > condition.threshold;

      case "consecutive_failures":
        return ctx.consecutiveFailures >= condition.count;

      case "session_token_count":
        return ctx.sessionTokenCount > condition.threshold;

      case "and":
        return condition.conditions.every((c) => this.matchCondition(c, ctx));

      case "or":
        return condition.conditions.some((c) => this.matchCondition(c, ctx));

      default: {
        const _exhaustive: never = condition;
        return false;
      }
    }
  }
}

// ── Pre-built Policies ──────────────────────────────────────────────

/**
 * Return a set of pre-built policy rules relevant to Strategos operations.
 * These cover common operational scenarios: stale cards, message backlogs,
 * consecutive failures, and session compaction.
 *
 * Register all of them with:
 * ```ts
 * const engine = new PolicyEngine();
 * for (const rule of getPrebuiltPolicies()) {
 *   engine.register(rule);
 * }
 * ```
 */
export function getPrebuiltPolicies(): PolicyRule[] {
  return [
    {
      name: "stale-card-escalation",
      condition: { type: "card_age", hours: 48 },
      action: {
        type: "escalate",
        reason: "Card has been idle for more than 48 hours",
      },
      priority: 1,
      enabled: true,
    },
    {
      name: "message-backlog-notify",
      condition: { type: "message_backlog", threshold: 10 },
      action: {
        type: "notify",
        channel: "telegram",
        message: "Agent has more than 10 unread messages",
      },
      priority: 2,
      enabled: true,
    },
    {
      name: "consecutive-failure-escalate",
      condition: { type: "consecutive_failures", count: 3 },
      action: {
        type: "escalate",
        reason: "Agent has failed 3 or more consecutive heartbeats",
        target: "user",
      },
      priority: 1,
      enabled: true,
    },
    {
      name: "session-compact",
      condition: { type: "session_token_count", threshold: 100000 },
      action: {
        type: "compact",
        reason: "Session token count exceeds 100k — compaction needed",
      },
      priority: 3,
      enabled: true,
    },
  ];
}
