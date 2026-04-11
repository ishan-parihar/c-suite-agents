import { getAgentPolicy, assertAgentCan, type EntityType } from '@/lib/agent-permissions';

export type AgentHeaders = {
  agentId?: string;
  action: 'read' | 'write' | 'delete';
  entityType: EntityType;
};

export function authenticateAgent(agentId: string | undefined): { ok: true; agentId: string } | { ok: false; error: string; status: number } {
  if (!agentId || agentId.trim() === '') {
    return { ok: false, error: 'Missing x-agent-id header', status: 401 };
  }
  const policy = getAgentPolicy(agentId);
  if (!policy) {
    return { ok: false, error: `Unknown agent: ${agentId}`, status: 403 };
  }
  return { ok: true, agentId };
}

export function getAgentIdentity(agentId: string) {
  return getAgentPolicy(agentId);
}

export function authenticateAndAuthorize(headers: AgentHeaders): void {
  const auth = authenticateAgent(headers.agentId);
  if (!auth.ok) {
    const err = new Error(auth.error) as Error & { status: number };
    err.status = auth.status;
    throw err;
  }
  assertAgentCan(headers.agentId!, headers.action, headers.entityType);
}
