/**
 * Agent Permission Matrix — Edict-inspired authorization layer.
 *
 * DESIGN RATIONALE:
 * Borrowed from edict's AGENT_POLICY pattern (EDICT-PATTERNS-TRANSFER.md §4),
 * this module defines a static permission matrix for Operant's 8 C-suite agents.
 * Each agent is assigned a role (coordinator, executor, observer) and explicit
 * allowlists for read, write, delete, and dispatch operations against entity types.
 *
 * KEY PRINCIPLES:
 * - Explicit allowlists: permissions are granted, not denied. An entity type not
 *   in an agent's canRead/canWrite/canDelete arrays is implicitly forbidden.
 * - Unknown agents pass silently: forward compatibility for new or auxiliary
 *   agents that aren't yet in the policy. The middleware layer should decide
 *   whether to reject unknown agents; this module only checks known policies.
 * - Coordinator agents can dispatch; executors and observers cannot (with the
 *   exception that coordinators dispatch to specific subordinates, not all).
 * - No authentication: this is purely authorization. Identity comes from the
 *   X-Agent-Id header and is assumed to be verified upstream.
 *
 * USAGE:
 * Call assertAgentCan(agentId, action, entityType) at the API boundary before
 * performing the operation. It throws PermissionError on violation or returns
 * silently on success (including for unknown agents).
 */

// ── Agent Roles ──────────────────────────────────────────────────────────────

export const AgentRole = {
  Coordinator: 'coordinator',
  Executor: 'executor',
  Observer: 'observer',
} as const;

export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

// ── Entity Types ─────────────────────────────────────────────────────────────

export type EntityType =
  | 'goal'
  | 'task'
  | 'meeting'
  | 'journal'
  | 'project'
  | 'campaign'
  | 'content'
  | 'person'
  | 'financial'
  | 'report'
  | 'session'
  | 'kanban'
  | 'message'
  | 'account'
  | 'note';

// ── Agent Policy ─────────────────────────────────────────────────────────────

export interface AgentPolicy {
  role: AgentRole;
  canRead: EntityType[];
  canWrite: EntityType[];
  canDelete: EntityType[];
  canDispatch: string[];
}

export const AGENT_POLICY: Record<string, AgentPolicy> = {
  // ── CEO-Strategic ───────────────────────────────────────────────────────
  // Top-level coordinator. Reads everything, writes strategic entities,
  // dispatches all other C-suite agents.
  'ceo-strategic': {
    role: 'coordinator',
    canRead: ['goal', 'task', 'meeting', 'journal', 'project', 'campaign', 'content', 'person', 'financial', 'report', 'session', 'kanban', 'message', 'account', 'note'],
    canWrite: ['goal', 'project', 'campaign', 'note'],
    canDelete: [],
    canDispatch: ['coo-productivity', 'cpo-psychologist', 'cro-relational', 'cfo-financial', 'cmo-content', 'cio-intelligence', 'physician'],
  },

  // ── COO-Productivity ────────────────────────────────────────────────────
  // Operations coordinator. Manages tasks and projects, dispatches Physician.
  'coo-productivity': {
    role: 'coordinator',
    canRead: ['task', 'project', 'goal'],
    canWrite: ['task', 'project'],
    canDelete: ['task'],
    canDispatch: ['physician'],
  },

  // ── CPO-Psychologist ────────────────────────────────────────────────────
  // Executor for journal analysis and mental pattern detection.
  'cpo-psychologist': {
    role: 'executor',
    canRead: ['journal', 'task'],
    canWrite: ['journal'],
    canDelete: [],
    canDispatch: [],
  },

  // ── CRO-Relational ──────────────────────────────────────────────────────
  // Executor for relationship tracking and people management.
  'cro-relational': {
    role: 'executor',
    canRead: ['person', 'journal'],
    canWrite: ['person'],
    canDelete: [],
    canDispatch: [],
  },

  // ── CFO-Financial ───────────────────────────────────────────────────────
  // Executor for financial data, accounts, and transactions.
  'cfo-financial': {
    role: 'executor',
    canRead: ['financial', 'account', 'task'],
    canWrite: ['financial'],
    canDelete: [],
    canDispatch: [],
  },

  // ── CMO-Content ─────────────────────────────────────────────────────────
  // Executor for content creation and campaign management.
  'cmo-content': {
    role: 'executor',
    canRead: ['content', 'campaign'],
    canWrite: ['content', 'campaign', 'note'],
    canDelete: [],
    canDispatch: [],
  },

  // ── CIO-Intelligence ────────────────────────────────────────────────────
  // Observer with read-everything access. Writes reports only.
  'cio-intelligence': {
    role: 'observer',
    canRead: ['goal', 'task', 'meeting', 'journal', 'project', 'campaign', 'content', 'person', 'financial', 'report', 'session', 'kanban', 'message', 'account', 'note'],
    canWrite: ['report'],
    canDelete: [],
    canDispatch: [],
  },

  // ── Physician ───────────────────────────────────────────────────────────
  // Advisory executor for health, diet, and exercise tracking. Reports to COO.
  'physician': {
    role: 'executor',
    canRead: ['task', 'journal'],
    canWrite: ['journal'],
    canDelete: [],
    canDispatch: [],
  },
};

// ── PermissionError ──────────────────────────────────────────────────────────

export class PermissionError extends Error {
  public readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
    this.code = 'PERMISSION_DENIED';
  }
}

// ── Permission Check Functions ───────────────────────────────────────────────

/**
 * Get the policy for a given agent. Returns null for unknown agents
 * (forward compatibility pattern).
 */
export function getAgentPolicy(agentId: string): AgentPolicy | null {
  const policy = AGENT_POLICY[agentId];
  return policy ?? null;
}

/**
 * Assert that an agent can perform an action on an entity type.
 *
 * Silently allows unknown agents (forward compatibility).
 * Throws PermissionError with code 'PERMISSION_DENIED' on violation.
 */
export function assertAgentCan(
  agentId: string,
  action: 'read' | 'write' | 'delete',
  entityType: EntityType,
): void {
  const policy = AGENT_POLICY[agentId];
  if (!policy) {
    throw new PermissionError(`Unknown agent: ${agentId}`);
  }

  const actionMap: Record<string, EntityType[]> = {
    read: policy.canRead,
    write: policy.canWrite,
    delete: policy.canDelete,
  };

  const allowed = actionMap[action];
  if (!allowed || !allowed.includes(entityType)) {
    throw new PermissionError(
      `${agentId} cannot ${action} ${entityType}`,
    );
  }
}

/**
 * Check if one agent can dispatch work to another agent.
 *
 * Returns false for unknown fromAgent (forward compatibility).
 * Returns true only if toAgentId is in fromAgent's canDispatch array.
 */
export function canAgentDispatch(
  fromAgentId: string,
  toAgentId: string,
): boolean {
  const policy = AGENT_POLICY[fromAgentId];
  if (!policy) return false; // Unknown agents denied

  return policy.canDispatch.includes(toAgentId);
}
