/**
 * Edict-inspired delegation with anti-deadlock protection.
 *
 * WHY depth limits matter:
 *   Without a hard depth cap, an unbounded delegation chain (A → B → C → D → …)
 *   consumes stack, memory, and wall-clock time with no practical benefit. Each hop
 *   adds latency (agent wake-up, context transfer, acknowledgment) and dilutes the
 *   original instruction. Depth 3 is the sweet spot — enough to route through a
 *   coordinator to a specialist without runaway chains.
 *
 * WHY cycle detection matters:
 *   In a system where 8 C-suite agents can delegate to each other, circular
 *   delegation (A → B → C → A) creates an infinite loop that never terminates,
 *   consuming resources and producing no work. Tracking the full path and rejecting
 *   any target already present in the chain breaks cycles at the first re-entry.
 */

/** Maximum allowed delegation depth. Beyond this, work must be executed directly. */
export const MAX_DELEGATION_DEPTH = 3;

/**
 * Context carried along a delegation chain.
 *
 * `depth` — current hop count (starts at 0 for the originator).
 * `path`  — ordered list of agent IDs that have participated in the chain.
 */
export interface DelegationContext {
  depth: number;
  path: string[];
}

/** Result of a delegation validation check. */
export type DelegationResult = { ok: true } | { ok: false; error: string };

/**
 * Validates that delegating to `targetAgent` from the given context is safe.
 *
 * Two failure modes are checked:
 *   1. Depth limit — rejects if the next hop would exceed MAX_DELEGATION_DEPTH.
 *   2. Circular delegation — rejects if `targetAgent` already appears in the path,
 *      and reports the full cycle (e.g. "agent-a → agent-b → agent-a").
 */
export function validateDelegation(
  ctx: DelegationContext,
  targetAgent: string,
): DelegationResult {
  if (ctx.depth >= MAX_DELEGATION_DEPTH) {
    return {
      ok: false,
      error: `Max delegation depth (${MAX_DELEGATION_DEPTH}) exceeded at depth ${ctx.depth}`,
    };
  }

  if (ctx.path.includes(targetAgent)) {
    const cyclePath = [...ctx.path, targetAgent];
    return {
      ok: false,
      error: `Circular delegation detected: ${cyclePath.join(' → ')}`,
    };
  }

  return { ok: true };
}

/**
 * Creates a new delegation context for the next hop in the chain.
 *
 * If `parentCtx` is provided, depth is incremented by one and `targetAgent`
 * is appended to the path. If omitted, a root context is created (depth 0,
 * empty path) — representing the original delegator before any hop occurs.
 *
 * NOTE: The caller should first validate the delegation with `validateDelegation`
 * before calling this function to create the child context.
 */
export function createDelegationContext(
  parentCtx?: DelegationContext,
  targetAgent?: string,
): DelegationContext {
  if (parentCtx === undefined) {
    return { depth: 0, path: [] };
  }

  return {
    depth: parentCtx.depth + 1,
    path: targetAgent !== undefined ? [...parentCtx.path, targetAgent] : [...parentCtx.path],
  };
}

/**
 * Returns a human-readable representation of the delegation chain.
 *
 * Example: "agent-a → agent-b → agent-c"
 * Returns an empty string for an empty path.
 */
export function getDelegationChain(ctx: DelegationContext): string {
  return ctx.path.join(' → ');
}
