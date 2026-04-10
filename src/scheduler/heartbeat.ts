// Heartbeat Runner — Periodic system event injection for agent proactivity
// Implements active hours window — reduces night-time frequency to every 2 hours.
// Pattern follows OpenClaw: heartbeat → event queue → prompt injection → agent turn
// Role-based: only agents with heartbeat enabled in config receive heartbeats.

import { logger } from "../logger.js";
import type { OperantRuntime } from "../types.js";
import { getCoreStaffIds, getStaffById } from "../staff/core-staff.js";
import { SystemEventQueue, ACTIVE_HOURS } from "./system-events.js";
import { loadConfig } from "../config/loader.js";
import { getAgentHealthRegistry } from "./agent-health.js";

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatRunning = false;

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

interface HeartbeatAgentConfig {
  enabled: boolean;
  intervalMs: number;
}

function resolveHeartbeatConfig(): {
  mode: "selective" | "all";
  defaultAgent: string;
  agentConfigs: Map<string, HeartbeatAgentConfig>;
} {
  const config = loadConfig();
  const hb = config.agents?.heartbeat;
  const mode = hb?.mode ?? "selective";
  const defaultAgent = hb?.defaultAgent ?? "ceo-strategic";
  const agentOverrides = hb?.agents ?? {};

  const agentConfigs = new Map<string, HeartbeatAgentConfig>();

  const hasExplicitOverrides = Object.keys(agentOverrides).length > 0;

  for (const agentId of getCoreStaffIds()) {
    const override = agentOverrides[agentId];
    let enabled: boolean;
    if (override) {
      enabled = override.enabled;
    } else if (mode === "all") {
      enabled = true;
    } else if (hasExplicitOverrides) {
      enabled = false;
    } else {
      enabled = agentId === defaultAgent;
    }
    const intervalMs = override?.intervalMs ?? DEFAULT_INTERVAL_MS;
    agentConfigs.set(agentId, { enabled, intervalMs });
  }

  return { mode, defaultAgent, agentConfigs };
}

export async function startHeartbeat(rt: OperantRuntime) {
  const { defaultAgent, agentConfigs } = resolveHeartbeatConfig();

  const enabledAgents = getCoreStaffIds().filter(
    (id) => agentConfigs.get(id)?.enabled ?? false,
  );

  const disabledAgents = getCoreStaffIds().filter(
    (id) => !agentConfigs.get(id)?.enabled,
  );

  if (enabledAgents.length === 0) {
    logger.info("heartbeat:disabled (no agents enabled in config)");
    return;
  }

  logger.info(
    { enabled: enabledAgents, disabled: disabledAgents, defaultAgent },
    "heartbeat:started (role-based selective mode)",
  );

  const enqueueForEnabled = async () => {
    if (!heartbeatRunning) return;
    try {
      if (!await SystemEventQueue.shouldFireHeartbeat()) {
        logger.debug("heartbeat:skipped (outside active hours)");
        return;
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const dayStr = now.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });

      let enqueued = 0;
      const health = getAgentHealthRegistry();

      // Build per-agent work items (filter out sleep-mode agents)
      const workItems = enabledAgents
        .map((agentId) => {
          const ackCount = SystemEventQueue.getAckCount(agentId);
          if (ackCount >= 6) {
            logger.debug(
              { agentId, ackCount },
              "heartbeat:skipped (agent in sleep mode)",
            );
            health.recordHeartbeat(agentId, true);
            return null;
          }
          return agentId;
        })
        .filter((id): id is string => id !== null);

      // Parallel enqueue with per-agent error handling
      const results = await Promise.allSettled(
        workItems.map(async (agentId) => {
          const staff = getStaffById(agentId);
          const title = staff?.title || agentId;

          await SystemEventQueue.enqueueCoalesced({
            agentId,
            text: `It's ${timeStr} on ${dayStr}. Time for your domain check. Query your Operant databases for anything needing attention in ${title}. Check your Kanban for blocked/overdue items. Review your inbox for pending items. If anything needs attention, take action internally — update your Kanban, send messages to other agents, store findings in memory. If all clear, reply HEARTBEAT_OK.`,
            contextKey: "heartbeat:domain-check",
            priority: "P3",
          });
        }),
      );

      // Process results: count successes and log failures
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === "fulfilled") {
          enqueued++;
          health.recordHeartbeat(workItems[i], true);
        } else {
          const agentId = workItems[i];
          logger.error(
            { agentId, err: (results[i] as PromiseRejectedResult).reason },
            "heartbeat:agent.enqueue.failed",
          );
          health.recordHeartbeat(agentId, false);
        }
      }

      if (enqueued > 0) {
        logger.info(
          { agentCount: enqueued },
          "heartbeat:events.enqueued (coalesced)",
        );
      }
    } catch (err: any) {
      logger.error({ err: err.message }, "heartbeat:enqueue.failed");
    }
  };

  heartbeatRunning = true;
  enqueueForEnabled();
  heartbeatTimer = setInterval(() => {
    if (heartbeatRunning) enqueueForEnabled();
  }, DEFAULT_INTERVAL_MS);
  if (heartbeatTimer && typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
}

export function stopHeartbeat() {
  heartbeatRunning = false;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  logger.info("heartbeat:stopped");
}

export { resolveHeartbeatConfig };
