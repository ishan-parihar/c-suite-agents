import "dotenv/config";
import { spawn } from "child_process";
import { startStrategos } from "./mcp/server.js";
import { startHeartbeat } from "./scheduler/heartbeat.js";
import { startTelegram } from "./integrations/telegram.js";
import { startMessageProcessor } from "./scheduler/message-processor.js";
import { startAgentExecutor } from "./scheduler/agent-executor.js";
import { startMeetingScheduler } from "./scheduler/meeting-scheduler.js";
import { logger } from "./logger.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { writeFileSync } from "fs";
import { createServer } from "http";
// use global fetch; spawn already imported above

// Health check HTTP server (for systemd + external monitoring)
const HEALTH_PORT = parseInt(process.env.HEALTH_CHECK_PORT || "4097", 10);
let healthStatus = { ready: false, uptime: 0, telegram: false, opencode: false };
const startTime = Date.now();

createServer((req, res) => {
  healthStatus.uptime = Math.floor((Date.now() - startTime) / 1000);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(healthStatus));
}).listen(HEALTH_PORT, "127.0.0.1", () => {
  logger.info({ port: HEALTH_PORT }, "Health check server started");
});

// Keepalive for systemd watchdog
setInterval(() => {
  if (process.env.NOTIFY_SOCKET) {
    // systemd notify protocol
    const dgram = require("dgram").createSocket("unixgram");
    dgram.send("WATCHDOG=1", process.env.NOTIFY_SOCKET, () => dgram.close());
  }
}, 30000);

async function main() {
  try {
    // Write PID file for systemd tracking
    const pidFile = join(homedir(), ".local/run/strategos.pid");
    await mkdir(join(homedir(), ".local/run"), { recursive: true });
    await writeFile(pidFile, process.pid.toString());
    logger.info({ pid: process.pid }, "PID file written");

    // Ensure OpenCode ACP headless server is running
    await (async function ensureOpenCode() {
      const url = process.env.OPENCODE_SERVER_URL || "http://localhost:4096";
      const health = async () => {
        try {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 1000);
          const r = await fetch(`${url}/global/health`, { signal: controller.signal });
          clearTimeout(t);
          return r.ok;
        } catch { return false; }
      };
      if (!(await health())) {
        logger.warn({ url }, "OpenCode not reachable, starting headless server");
        const host = process.env.OPENCODE_SERVER_HOST || "127.0.0.1";
        const port = process.env.OPENCODE_SERVER_PORT || "4096";
        const proc = spawn("opencode", ["serve", "--hostname", host, "--port", port], { stdio: "ignore", detached: false });
        const startedAt = Date.now();
        while (Date.now() - startedAt < 10000) {
          if (await health()) { logger.info({ url }, "OpenCode server ready"); break; }
          await new Promise(r => setTimeout(r, 300));
        }
      }
      healthStatus.opencode = await health();
    })();

    // Start Strategos MCP server (stdio transport for OpenCode connection)
    const rt = await startStrategos();
    await startHeartbeat(rt);
    const telegramBot = await startTelegram(rt);
    healthStatus.telegram = !!telegramBot;
    
    // Start autonomous execution (Phase 2)
    await startMessageProcessor(rt.ctx.kanban, rt.ctx.memory);
    await startAgentExecutor(rt.ctx.kanban, rt.ctx.memory);
    await startMeetingScheduler();
    
    // Mark as ready
    healthStatus.ready = true;
    logger.info("Strategos boot complete - autonomous agents enabled");
    
    // Keep process alive (prevent exit after main completes)
    process.on("SIGTERM", () => {
      logger.info("SIGTERM received, graceful shutdown");
      process.exit(0);
    });
    
    // Prevent unhandled rejections from crashing the process
    process.on("unhandledRejection", (err: any) => {
      logger.error({ err: err?.message || err }, "Unhandled rejection - continuing");
    });
    
    process.on("uncaughtException", (err: Error) => {
      logger.error({ err: err.message }, "Uncaught exception - continuing");
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Fatal during startup");
    process.exit(1);
  }
}

main();
