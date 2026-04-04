// Heartbeat Runner — Periodic system event injection for agent proactivity
// Refactored: Uses coalesced event enqueue to prevent stacking.
// Implements active hours window — reduces night-time frequency to every 2 hours.
// Pattern follows OpenClaw: heartbeat → event queue → prompt injection → agent turn

import { logger } from "../logger.js";
import type { StrategosRuntime } from "../types.js";
import { getCoreStaffIds, getStaffById } from "../staff/core-staff.js";
import { SystemEventQueue, ACTIVE_HOURS } from "./system-events.js";

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatRunning = false;

export async function startHeartbeat(rt: StrategosRuntime) {
  const intervalMs = 15 * 60 * 1000; // 15 minutes

  const enqueueForAll = async () => {
    if (!heartbeatRunning) return;
    try {
      // Active hours check — during night, only fire every 8th call (~2 hours)
      if (!SystemEventQueue.shouldFireHeartbeat()) {
        logger.debug("heartbeat:skipped (outside active hours)");
        return;
      }

      const core = getCoreStaffIds();
      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      const dayStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

      for (const agentId of core) {
        // Skip self — CEO processes its own domain work via the executor
        if (agentId === "ceo-strategic") continue;

        // Check if agent is in "sleep mode" from too many consecutive HEARTBEAT_OK
        const ackCount = SystemEventQueue.getAckCount(agentId);
        if (ackCount >= 6) {
          logger.debug({ agentId, ackCount }, "heartbeat:skipped (agent in sleep mode)");
          continue;
        }

        const staff = getStaffById(agentId);
        const title = staff?.title || agentId;

        // COALESCED enqueue — replaces existing heartbeat event instead of stacking
        SystemEventQueue.enqueueCoalesced({
          agentId,
          text: `It's ${timeStr} on ${dayStr}. Time for your domain check. Query your LifeOS databases for anything needing attention in ${title}. Check your Kanban for blocked/overdue items. Review your inbox for pending items. If you find anything that needs CEO attention, send a report to ceo-strategic via message.send. If all clear, reply HEARTBEAT_OK.`,
          contextKey: "heartbeat:domain-check",
          priority: "P3",
        });
      }

      logger.info({ agentCount: core.length - 1 }, "heartbeat:events.enqueued (coalesced)");
    } catch (err: any) {
      logger.error({ err: err.message }, "heartbeat:enqueue.failed");
    }
  };

  // Initial enqueue
  heartbeatRunning = true;
  enqueueForAll();
  // Schedule periodic enqueue
  heartbeatTimer = setInterval(() => {
    if (heartbeatRunning) enqueueForAll();
  }, intervalMs);

  logger.info({ intervalMs, activeHours: `${ACTIVE_HOURS.start}:00-${ACTIVE_HOURS.end}:00`, nightInterval: "every 2h" }, "heartbeat:started (coalesced + active hours)");
}

export function stopHeartbeat() {
  heartbeatRunning = false;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  logger.info("heartbeat:stopped");
}
