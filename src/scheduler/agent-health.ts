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
  errorTimestamps: number[];
  status: "healthy" | "degraded" | "silent" | "error";
}

const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const SILENT_THRESHOLD_MS = 30 * 60 * 1000;
const DEGRADED_THRESHOLD_MS = 15 * 60 * 1000;
const MAX_HEALTH_ENTRIES = 50;
const HEALTH_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

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
        errorTimestamps: [],
        status: "healthy",
      });
    }
  }

  private getOrInit(agentId: string): AgentHealth {
    let h = this.health.get(agentId);
    if (!h) {
      if (this.health.size >= MAX_HEALTH_ENTRIES) {
        this.evictOldest();
      }
      h = {
        agentId,
        lastHeartbeat: 0,
        lastResponse: 0,
        lastError: 0,
        consecutiveFailures: 0,
        consecutiveHeartbeatOk: 0,
        pendingMessages: 0,
        errorCount24h: 0,
        errorTimestamps: [],
        status: "healthy",
      };
      this.health.set(agentId, h);
    }
    return h;
  }

  /** Remove entries not in core staff whose lastHeartbeat is older than 24h. */
  cleanup(): void {
    const coreIds = new Set(getCoreStaffIds());
    const now = Date.now();
    for (const [agentId, h] of this.health.entries()) {
      if (!coreIds.has(agentId) && (now - h.lastHeartbeat) > HEALTH_ENTRY_TTL_MS) {
        this.health.delete(agentId);
      }
    }
  }

  /** Evict the single entry with the oldest lastHeartbeat (used when map is at capacity). */
  private evictOldest(): void {
    const coreIds = new Set(getCoreStaffIds());
    let oldestId: string | undefined;
    let oldestTime = Infinity;
    for (const [agentId, h] of this.health.entries()) {
      if (!coreIds.has(agentId) && h.lastHeartbeat < oldestTime) {
        oldestTime = h.lastHeartbeat;
        oldestId = agentId;
      }
    }
    if (oldestId) {
      this.health.delete(oldestId);
    }
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
    h.errorTimestamps.push(Date.now());
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
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    h.errorTimestamps = h.errorTimestamps.filter(ts => ts > oneDayAgo);
    h.errorCount24h = h.errorTimestamps.length;

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
