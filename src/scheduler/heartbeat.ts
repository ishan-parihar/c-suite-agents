import { logger } from "../logger.js";
import type { StrategosRuntime } from "../types.js";
import { getCoreStaffIds } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";

export async function startHeartbeat(rt: StrategosRuntime) {
  const intervalMs = 15 * 60 * 1000; // 15 minutes per requirements

  // Kick off immediately, then every interval
  const pingAll = async () => {
    try {
      const messaging = await getMessagingSystem();
      const core = getCoreStaffIds();
      const nowIso = new Date().toISOString();
      await Promise.all(core.map(async (agentId) => {
        try {
          await messaging.send({
            from: "strategos",
            to: agentId,
            subject: `Heartbeat — ${nowIso}`,
            content: `Automated heartbeat ping at ${nowIso}. Report status, blockers, and urgent items if any.`,
            priority: "P4",
            requires_response: false,
            tags: ["heartbeat"]
          });
          logger.debug({ agentId }, "heartbeat.ping.sent");
        } catch (e: any) {
          logger.warn({ agentId, err: e?.message }, "heartbeat.ping.failed");
        }
      }));
    } catch (err) {
      logger.error({ err }, "heartbeat batch failed");
    }
  };

  // Initial ping
  pingAll();
  // Schedule
  setInterval(pingAll, intervalMs);
}
