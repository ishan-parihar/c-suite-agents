// Agent Health Registry — Real-time team health tracking
// Each agent reports health metrics on heartbeat, execution, and error events.
// Provides team-wide visibility into agent status, workload, and silent detection.

import { logger } from "../logger.js";
import { getCoreStaffIds, getStaffById } from "../staff/core-staff.js";

export interface AgentHealth {
  agentId: string;
  lastHeartbeat: number;
  lastResponse: number;
  lastError: number;
  consecutiveFailures: number;
  consecutiveHeartbeatOk: number;
  pendingMessages: number;
  errorCount24h: number;
  status: "healthy" | "degraded" | "silent" | "error";
}

const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const SILENT_THRESHOLD_MS = 30 * 60 * 1000;
const DEGRADED_THRESHOLD_MS = 15 * 60 * 1000;

class AgentHealthRegistry {
  private health: Map<string, AgentHealth> = new Map();

  constructor() {
    for (const agentId of getCoreStaffIds()) {
      this.health.set(agentId, {
        agentId,
        lastHeartbeat: Date.now(),
        lastResponse: Date.now(),
        lastError: 0,
        consecutiveFailures: 0,
        consecutiveHeartbeatOk: 0,
        pendingMessages: 0,
        errorCount24h: 0,
        status: "healthy",
      });
    }
  }

  private getOrInit(agentId: string): AgentHealth {
    let h = this.health.get(agentId);
    if (!h) {
      h = {
        agentId,
        lastHeartbeat: 0,
        lastResponse: 0,
        lastError: 0,
        consecutiveFailures: 0,
        consecutiveHeartbeatOk: 0,
        pendingMessages: 0,
        errorCount24h: 0,
        status: "healthy",
      };
      this.health.set(agentId, h);
    }
    return h;
  }

  recordHeartbeat(agentId: string, ok: boolean) {
    const h = this.getOrInit(agentId);
    h.lastHeartbeat = Date.now();
    if (ok) {
      h.consecutiveFailures = 0;
      h.consecutiveHeartbeatOk++;
    } else {
      h.consecutiveFailures++;
      h.consecutiveHeartbeatOk = 0;
    }
    this.recalcStatus(h);
  }

  recordResponse(agentId: string) {
    const h = this.getOrInit(agentId);
    h.lastResponse = Date.now();
    h.consecutiveFailures = 0;
    this.recalcStatus(h);
  }

  recordError(agentId: string) {
    const h = this.getOrInit(agentId);
    h.lastError = Date.now();
    h.consecutiveFailures++;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (h.lastError > oneDayAgo) h.errorCount24h++;
    this.recalcStatus(h);
  }

  updatePendingMessages(agentId: string, count: number) {
    const h = this.getOrInit(agentId);
    h.pendingMessages = count;
  }

  getStatus(agentId: string): AgentHealth | null {
    return this.health.get(agentId) || null;
  }

  getTeamStatus(): Array<AgentHealth & { name: string; title: string; avatar: string }> {
    const results: Array<AgentHealth & { name: string; title: string; avatar: string }> = [];
    for (const agentId of getCoreStaffIds()) {
      const h = this.health.get(agentId);
      const staff = getStaffById(agentId);
      if (h && staff) {
        results.push({ ...h, name: staff.name, title: staff.title, avatar: staff.avatar });
      }
    }
    return results;
  }

  getSilentAgents(): string[] {
    const now = Date.now();
    const silent: string[] = [];
    for (const [agentId, h] of this.health.entries()) {
      const timeSinceLastResponse = now - h.lastResponse;
      const timeSinceLastHeartbeat = now - h.lastHeartbeat;
      if (timeSinceLastResponse > SILENT_THRESHOLD_MS && timeSinceLastHeartbeat > SILENT_THRESHOLD_MS) {
        silent.push(agentId);
      }
    }
    return silent;
  }

  private recalcStatus(h: AgentHealth) {
    const now = Date.now();
    const timeSinceResponse = now - h.lastResponse;
    const timeSinceHeartbeat = now - h.lastHeartbeat;

    if (h.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      h.status = "error";
    } else if (timeSinceResponse > SILENT_THRESHOLD_MS && timeSinceHeartbeat > SILENT_THRESHOLD_MS) {
      h.status = "silent";
    } else if (timeSinceResponse > DEGRADED_THRESHOLD_MS || timeSinceHeartbeat > DEGRADED_THRESHOLD_MS) {
      h.status = "degraded";
    } else {
      h.status = "healthy";
    }
  }
}

let registry: AgentHealthRegistry | null = null;

export function getAgentHealthRegistry(): AgentHealthRegistry {
  if (!registry) registry = new AgentHealthRegistry();
  return registry;
}
