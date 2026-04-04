import "dotenv/config";
import { startStrategos, toolImpls } from "./mcp/server.js";
import { startHeartbeat, stopHeartbeat } from "./scheduler/heartbeat.js";
import { startTelegram } from "./integrations/telegram.js";
import { startMessageProcessor } from "./scheduler/message-processor.js";
import { startAgentExecutor } from "./scheduler/agent-executor.js";
import { startMeetingScheduler } from "./scheduler/meeting-scheduler.js";
import { startAgentScheduler, getAgentScheduler } from "./scheduler/agent-scheduler.js";
import { getMemoryFacade } from "./memory/index.js";
import type { DecayConfig } from "./memory/index.js";
import { getCoreStaffIds } from "./staff/core-staff.js";
import { logger } from "./logger.js";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { writeFileSync } from "fs";
import { createServer } from "http";
import { initWorkspace, initAllWorkspaces } from "./agents/workspace-manager.js";
import { initNativeRuntime } from "./runtime/native-agent-runtime.js";
import { loadConfig, getConfigPath } from "./config/loader.js";
import { setLogLevel } from "./logger.js";
import { connectAllMcpServers, type McpServerConnection } from "./mcp/client.js";
import { createBridge } from "./mcp/bridge.js";
import { getMeetingScheduler } from "./scheduler/meeting-scheduler.js";
import { getMessageProcessor } from "./scheduler/message-processor.js";
import { getAgentExecutor } from "./scheduler/agent-executor.js";

// Load config early (defaults < .env < ~/.strategos/config.json)
const config = loadConfig();
if (config.logging?.level) setLogLevel(config.logging.level);
logger.info({ path: getConfigPath(), level: config.logging?.level }, "Strategos config loaded");

// Health check HTTP server (for systemd + external monitoring)
const HEALTH_PORT = parseInt(process.env.HEALTH_CHECK_PORT || "4097", 10);
let healthStatus = { ready: false, uptime: 0, telegram: false, runtime: false };
const startTime = Date.now();
const healthServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: healthStatus.ready ? "ok" : "starting" }));
});
healthServer.listen(HEALTH_PORT, "127.0.0.1", () => {
  logger.info({ port: HEALTH_PORT }, "Health check server started");
});

// Keepalive for systemd watchdog
const watchdogTimer = setInterval(() => {
  if (process.env.NOTIFY_SOCKET) {
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

    // ── NATIVE RUNTIME: Initialize all agent workspaces ──
    logger.info("Initializing agent workspaces (native runtime)...");
    const workspaces = initAllWorkspaces();
    logger.info({ count: workspaces.size }, "Agent workspaces initialized");

    // ── NATIVE RUNTIME: Initialize LLM runtime ──
    const llmCfg = config.llm!;
    const nativeRuntime = initNativeRuntime({
      llm: {
        provider: llmCfg.provider,
        apiKey: llmCfg.apiKey,
        baseUrl: llmCfg.baseUrl,
        model: llmCfg.model,
        maxTokens: llmCfg.maxTokens,
        temperature: llmCfg.temperature,
        timeoutMs: llmCfg.timeoutMs,
      },
      maxMessages: config.context?.maxMessages,
      maxContextTokens: config.context?.maxContextTokens,
    });
    healthStatus.runtime = true;
    logger.info("Native agent runtime initialized");

    // Start Strategos MCP server (provides native tool implementations)
    const rt = await startStrategos();

    // ── CONNECT MCP BRIDGE: External servers + native tools ──
    const mcpConfig = (config as any).mcp || {};
    const mcpToolMap = new Map<string, { conn: McpServerConnection; toolName: string }>();
    const onReconnect = (serverName: string, newConn: McpServerConnection) => {
      for (const [toolName, entry] of mcpToolMap) {
        if (entry.conn.serverName === serverName) {
          mcpToolMap.set(toolName, { conn: newConn, toolName: newConn.tools.find(t => t.toolName === entry.toolName)?.toolName ?? entry.toolName });
        }
      }
      logger.info({ server: serverName }, "Bridge updated with reconnected MCP server");
    };
    const mcpConnections = Object.keys(mcpConfig).length > 0
      ? await connectAllMcpServers(mcpConfig, onReconnect)
      : [];
    for (const conn of mcpConnections) {
      for (const tool of conn.tools) {
        mcpToolMap.set(tool.name, { conn, toolName: tool.toolName });
      }
    }
    logger.info({ serverCount: mcpConnections.length }, "MCP servers connected");

    // ── PER-AGENT TOOL SCOPING ──
    const toolScoping = (config.agents as any)?.toolScoping || {};
    const mcpServerTools: Record<string, McpServerConnection> = {};
    for (const conn of mcpConnections) {
      mcpServerTools[conn.serverName] = conn;
    }

    // Build per-agent tool lists: all native tools + scoped MCP tools
    const nativeToolNames = [
      // Memory
      "memory.search", "memory.recall", "memory.upsert", "memory.forget", "memory.consolidate", "memory.stats",
      // Kanban
      "board.get", "board.addCard", "board.moveCard", "board.viewReports", "board.reassign", "board.escalate",
      // Messaging
      "message.send", "message.reply", "message.getThread", "message.getThreads", "message.search",
      "message.markRead", "message.escalate", "message.getUnread",
      // Agent
      "agent.inbox", "agent.call", "agent.handoff", "agent.meeting", "agent.wake",
      "agent.create", "agent.spawn", "agent.list",
      // Organization
      "org.chart", "staff.list", "staff.get",
      // Meetings
      "meeting.propose", "meeting.vote", "meeting.get", "meeting.recordMinutes",
      // Delegation
      "hire.create", "hire.fire", "hire.getTeam",
      "delegate.to", "delegate.accept", "delegate.reject", "delegate.update", "delegate.get",
      // Reports
      "reports.save", "reports.getLatest",
      // Notifications
      "notify.telegram",
      // Heartbeat
      "heartbeat.runNow",
      // Task
      "task.get",
      // Media
      "image.analyze", "image.generate", "tts.synthesize",
    ];

    // Build scoped tool sets per agent
    const agentToolScopes: Record<string, string[]> = {};
    const allMcpToolNames = new Set<string>();

    for (const conn of mcpConnections) {
      for (const tool of conn.tools) {
        allMcpToolNames.add(tool.name);
      }
    }

    // Default: all agents get all tools (backward compat)
    const allToolNames = [...nativeToolNames, ...Array.from(allMcpToolNames)];
    const bridge = createBridge(toolImpls, mcpConnections, nativeToolNames, mcpToolMap);

    nativeRuntime.setToolExecutor(bridge.executor, allToolNames);
    logger.info(
      { nativeCount: nativeToolNames.length, mcpCount: allMcpToolNames.size, totalCount: allToolNames.length },
      "Tool executor wired (native + MCP bridge)",
    );

    // Configure per-agent tool scoping
    const coreStaffIds = getCoreStaffIds();
    for (const agentId of coreStaffIds) {
      const scope = toolScoping[agentId];
      if (scope && Array.isArray(scope.mcpServers)) {
        const scopedTools = [...nativeToolNames];
        for (const serverName of scope.mcpServers) {
          const serverConn = mcpServerTools[serverName];
          if (serverConn) {
            for (const tool of serverConn.tools) {
              scopedTools.push(tool.name);
            }
            logger.info({ agentId, server: serverName, toolCount: serverConn.tools.length }, "MCP server scoped to agent");
          } else {
            logger.warn({ agentId, server: serverName }, "Scoped MCP server not connected — skipping");
          }
        }
        agentToolScopes[agentId] = scopedTools;
        nativeRuntime.setAgentToolScope(agentId, scopedTools);
        logger.info(
          { agentId, toolCount: scopedTools.length, mcpTools: scopedTools.length - nativeToolNames.length },
          "Agent tool scope configured",
        );
      }
    }

    // Log summary
    if (Object.keys(agentToolScopes).length > 0) {
      for (const [agentId, tools] of Object.entries(agentToolScopes)) {
        logger.info({ agentId, total: tools.length, mcp: tools.length - nativeToolNames.length }, "Scoped tool count (vs global)");
      }
    }

    // Start services
    await startHeartbeat(rt);
    const telegramBot = await startTelegram(rt);
    healthStatus.telegram = !!telegramBot;

    // Start autonomous execution
    await startMessageProcessor(rt.ctx.kanban, rt.ctx.memory);
    await startAgentExecutor(rt.ctx.kanban, rt.ctx.memory);
    await startMeetingScheduler();
    await startAgentScheduler();

    // Start memory lifecycle jobs
    const memoryFacade = rt.ctx.memoryFacade!;
    const decayConfig: DecayConfig = {
      half_life_hours: 168,
      min_importance: 0.05,
      archive_threshold: 0.02,
    };

    const decayTimer = setInterval(async () => {
      try {
        const result = await memoryFacade.runDecay(decayConfig);
        logger.info(result, "Memory decay run");
      } catch (err: any) {
        logger.error({ err: err.message }, "Memory decay job failed");
      }
    }, 24 * 3600000);

    const consolidateTimer = setInterval(async () => {
      try {
        for (const agentId of getCoreStaffIds()) {
          for (const tag of ["proactive-work", "scheduled-task", "domain-check"]) {
            const id = await memoryFacade.consolidate("personal", agentId, tag);
            if (id) logger.info({ id, agentId, tag }, "Memory consolidated");
          }
        }
      } catch (err: any) {
        logger.error({ err: err.message }, "Memory consolidation job failed");
      }
    }, 6 * 3600000);

    logger.info("Memory lifecycle jobs started (decay: daily, consolidation: 6h)");

    // Mark as ready
    healthStatus.ready = true;
    logger.info("Strategos boot complete — NATIVE AGENT RUNTIME (no external dependencies)");

    // Graceful shutdown
    let shuttingDown = false;
    async function gracefulShutdown(signal: string) {
      if (shuttingDown) return;
      shuttingDown = true;

      logger.info({ signal }, "Graceful shutdown initiated");

      try {
        // Stop schedulers first (prevent new work)
        getMessageProcessor()?.stop();
        getAgentExecutor()?.stop();
        getMeetingScheduler()?.stop();
        (await getAgentScheduler()).stop();
        stopHeartbeat();

        // Clear all lifecycle timers
        clearInterval(decayTimer);
        clearInterval(consolidateTimer);
        clearInterval(watchdogTimer);

        // Close kanban database
        if (rt.ctx.kanban) { await rt.ctx.kanban.close(); logger.info("Kanban database closed"); }

        // Close messaging system
        try { const messaging = await import("./organic/messaging.js"); await messaging.getMessagingSystem().then(m => m.close?.()); logger.info("Messaging system closed"); } catch { /* ignore */ }

        // Clear session registry
        try { const { getSessionRegistry } = await import("./scheduler/session-registry.js"); const sr = getSessionRegistry(); await sr.close?.(); logger.info("Session registry closed"); } catch { /* ignore */ }

        // Close MCP connections
        for (const conn of mcpConnections) { try { await conn.dispose(); } catch { /* ignore */ } }
        logger.info({ count: mcpConnections.length }, "MCP connections closed");

        // Stop Telegram bot
        if (telegramBot) {
          telegramBot.stop(signal);
          logger.info("Telegram bot stopped");
        }

        // Close health check server
        await new Promise<void>((resolve) => healthServer.close(() => resolve()));
        logger.info("Health check server closed");

        // Clean up PID file
        const pidFile = join(homedir(), ".local/run/strategos.pid");
        try { await unlink(pidFile); logger.info("PID file removed"); } catch { /* ignore */ }

        logger.info("Graceful shutdown complete");
      } catch (err: any) {
        logger.error({ err: err.message }, "Error during graceful shutdown");
      } finally {
        process.exit(0);
      }
    }

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

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
