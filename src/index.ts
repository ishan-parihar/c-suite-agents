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
// use global fetch; spawn already imported above

// Intentionally do not write to user's OpenCode config

async function main() {
  try {
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
        // wait up to 10s
        const startedAt = Date.now();
        while (Date.now() - startedAt < 10000) {
          if (await health()) { logger.info({ url }, "OpenCode server ready"); break; }
          await new Promise(r => setTimeout(r, 300));
        }
      }
    })();

    // Start Strategos MCP server (stdio transport for OpenCode connection)
    const rt = await startStrategos();
    await startHeartbeat(rt);
    await startTelegram(rt);
    
    // Start autonomous execution (Phase 2)
    await startMessageProcessor(rt.ctx.kanban, rt.ctx.memory);
    await startAgentExecutor(rt.ctx.kanban, rt.ctx.memory);
    await startMeetingScheduler();
    
    // Do not modify user's OpenCode config
    
    logger.info("Strategos boot complete - autonomous agents enabled");
  } catch (err: any) {
    logger.error({ err: err.message }, "Fatal during startup");
    process.exit(1);
  }
}

main();
