import "dotenv/config";
import { startStrategos, toolImpls } from "./mcp/server.js";
import { startHeartbeat, stopHeartbeat } from "./scheduler/heartbeat.js";
import { startTelegram, sendTelegramMessage, getTelegramBot, flushChatState } from "./integrations/telegram.js";
import { startMessageProcessor } from "./scheduler/message-processor.js";
import { startAgentExecutor } from "./scheduler/agent-executor.js";
import { startMeetingScheduler } from "./scheduler/meeting-scheduler.js";
import { startAgentScheduler, getAgentScheduler } from "./scheduler/agent-scheduler.js";
import { getWebhookHandler } from "./scheduler/webhooks.js";
import { startBoardMeetingScheduler, getBoardMeetingScheduler } from "./scheduler/board-meeting-scheduler.js";
import { getMemoryFacade } from "./memory/index.js";
import type { DecayConfig } from "./memory/index.js";
import { getCoreStaffIds } from "./staff/core-staff.js";
import { getAgentToolScope } from "./staff/tool-scoping.js";
import { logger } from "./logger.js";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { writeFileSync } from "fs";
import { createServer } from "http";
import { initWorkspace, initAllWorkspaces } from "./agents/workspace-manager.js";
import { initNativeRuntime, getNativeRuntime } from "./runtime/native-agent-runtime.js";
import { getSessionRegistry } from "./scheduler/session-registry.js";
import { loadConfig, getConfigPath } from "./config/loader.js";
import { setLogLevel } from "./logger.js";
import { connectAllMcpServers, type McpServerConnection } from "./mcp/client.js";
import { createBridge } from "./mcp/bridge.js";
import { getMeetingScheduler } from "./scheduler/meeting-scheduler.js";
import { getMessageProcessor } from "./scheduler/message-processor.js";
import { getAgentExecutor } from "./scheduler/agent-executor.js";
import {
  registerComponent,
  markHealthy,
  markDegraded,
  markError,
  markStopped,
  healthResponse,
  getComponent,
} from "./health.js";
import { discoverAndLoadPlugins, listPlugins, getPluginHealth } from "./runtime/plugin-registry.js";
import { ErrorBus } from "./runtime/error-emitter.js";
import { ErrorAggregator } from "./runtime/error-aggregator.js";
import { AlertManagerInstance as AlertManager } from "./runtime/alert-manager.js";
import { SelfHealer } from "./runtime/self-healer.js";
import { HeartbeatMonitor } from "./scheduler/heartbeat-monitor.js";
import { CronErrorHandler } from "./scheduler/cron-error-handler.js";

// Load config early (defaults < .env < ~/.strategos/config.json)
const config = loadConfig();
if (config.logging?.level) setLogLevel(config.logging.level);
logger.info({ path: getConfigPath(), level: config.logging?.level }, "Strategos config loaded");

// Health check HTTP server — exposes multi-component health status
const HEALTH_PORT = parseInt(process.env.HEALTH_CHECK_PORT || "4097", 10);
const healthServer = createServer(async (req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  const body = await healthResponse();
  res.end(JSON.stringify(body));
});
healthServer.listen(HEALTH_PORT, "127.0.0.1", () => {
  logger.info({ port: HEALTH_PORT }, "Health check server started");
});

// Register all components for health tracking
registerComponent("runtime");
registerComponent("telegram");
registerComponent("heartbeat");
registerComponent("mcp");
    registerComponent("kanban");
    registerComponent("memory");
    registerComponent("board-meeting");
registerComponent("webhook");
registerComponent("plugins");

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "4098", 10);
const webhookHandler = getWebhookHandler();

const webhookServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/webhook/")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const webhookPath = pathname.slice("/webhook/".length);
  const method = req.method || "GET";

  let body: unknown = null;
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] || "";
    try {
      if (contentType.includes("application/json")) {
        body = JSON.parse(raw.toString("utf-8"));
      } else {
        body = raw.toString("utf-8");
      }
    } catch {
      body = raw.toString("utf-8");
    }
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  try {
    const result = await webhookHandler.handleRequest(webhookPath, method, body, headers);
    res.writeHead(result.status, { "Content-Type": "text/plain" });
    res.end(result.body);
  } catch (err: any) {
    logger.error({ err: err.message, webhookPath }, "Webhook handler error");
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal server error");
  }
});

webhookServer.listen(WEBHOOK_PORT, "127.0.0.1", async () => {
  logger.info({ port: WEBHOOK_PORT }, "Webhook server started");
  try {
    await webhookHandler.init();
    markHealthy("webhook");
  } catch (err: any) {
    logger.error({ err: err.message }, "Webhook handler init failed");
    markError("webhook", err.message);
  }
});

// Keepalive for systemd watchdog
const watchdogTimer = setInterval(() => {
  if (process.env.NOTIFY_SOCKET) {
    const dgram = require("dgram").createSocket("unixgram");
    dgram.send("WATCHDOG=1", process.env.NOTIFY_SOCKET, () => dgram.close());
  }
}, 30000);

async function main() {
  let decayTimer: ReturnType<typeof setInterval> | null = null;
  let consolidateTimer: ReturnType<typeof setInterval> | null = null;
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
    markHealthy("runtime");
    logger.info("Native agent runtime initialized");

    // ── ERROR OBSERVABILITY: Initialize self-healing system ──
    SelfHealer.start();
    ErrorAggregator.start();
    AlertManager.start();
    HeartbeatMonitor.start();
    CronErrorHandler.start();
    logger.info("Error observability and self-healing system initialized");

    // ── PLUGIN SYSTEM: Discover and load plugins ──
    const plugins = await discoverAndLoadPlugins();
    const pluginHealth = getPluginHealth();
    if (pluginHealth.failed > 0) {
      markDegraded("plugins", `${pluginHealth.failed} plugin(s) failed to load`);
    } else {
      markHealthy("plugins", { loaded: pluginHealth.loaded, total: pluginHealth.total });
    }

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
    markHealthy("mcp", { serverCount: mcpConnections.length });

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
      "agent.inbox", "agent.handoff", "agent.meeting", "agent.wake",
      "agent.create", "agent.spawn", "agent.list", "agent.status",
      // Board Meeting
      "boardmeeting.run", "boardmeeting.status",
      // Organization
      "org.chart", "org.health", "staff.list", "staff.get",
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
      // Cron / Scheduling
      "cron.status", "cron.list", "cron.create", "cron.pause", "cron.resume", "cron.delete", "cron.run",
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

    const mcpDefs = bridge.definitions.filter(d => !nativeToolNames.includes(d.name));

    nativeRuntime.setToolExecutor(bridge.executor, allToolNames, mcpDefs);
    logger.info(
      { nativeCount: nativeToolNames.length, mcpCount: allMcpToolNames.size, totalCount: allToolNames.length },
      "Tool executor wired (native + MCP bridge)",
    );

    // Configure per-agent tool scoping (3-tier: native + MCP server + MCP tool filter)
    const coreStaffIds = getCoreStaffIds();
    for (const agentId of coreStaffIds) {
      const scope = toolScoping[agentId];
      if (!scope || !Array.isArray(scope.mcpServers)) continue;

      // Tier 1: Native tool filtering
      const nativeScope = getAgentToolScope(agentId);
      const scopedTools = nativeScope.length > 0
        ? nativeToolNames.filter(name => nativeScope.includes(name))
        : [...nativeToolNames];

      // Tier 2+3: MCP server + per-server tool filtering
      const mcpServerToolsFilter = scope.mcpServerTools || {};
      for (const serverName of scope.mcpServers) {
        const serverConn = mcpServerTools[serverName];
        if (!serverConn) {
          logger.warn({ agentId, server: serverName }, "Scoped MCP server not connected — skipping");
          continue;
        }

        const filter = mcpServerToolsFilter[serverName];
        const filterSet = filter?.length ? new Set(filter) : null;
        let addedCount = 0;

        for (const tool of serverConn.tools) {
          // Config stores unprefixed tool names (e.g. "goal.list"), but
          // tool.name is prefixed (e.g. "lifeos__goal.list"). Compare against
          // tool.toolName to match the config schema.
          if (!filterSet || filterSet.has(tool.toolName)) {
            scopedTools.push(tool.name);
            addedCount++;
          }
        }

        if (filterSet) {
          logger.info(
            { agentId, server: serverName, filtered: addedCount, total: serverConn.tools.length },
            "MCP server scoped to agent (filtered)"
          );
        } else {
          logger.info(
            { agentId, server: serverName, toolCount: addedCount },
            "MCP server scoped to agent (all tools)"
          );
        }
      }

      const nativeCount = scopedTools.filter(t => nativeToolNames.includes(t)).length;
      const mcpCount = scopedTools.length - nativeCount;

      agentToolScopes[agentId] = scopedTools;
      nativeRuntime.setAgentToolScope(agentId, scopedTools);

      logger.info(
        { agentId, native: nativeCount, mcp: mcpCount, total: scopedTools.length },
        "Per-agent tool scope applied"
      );
    }

    for (const agentId of coreStaffIds) {
      if (!agentToolScopes[agentId]) {
        logger.info({ agentId, total: allToolNames.length }, "Agent has no toolScoping config — received all tools");
        agentToolScopes[agentId] = allToolNames;
        nativeRuntime.setAgentToolScope(agentId, allToolNames);
      }
    }

    // Log detailed per-agent tool scope (measurement baseline)
    if (Object.keys(agentToolScopes).length > 0) {
      const scopeSummary: string[] = [];
      for (const [agentId, tools] of Object.entries(agentToolScopes)) {
        const nativeCount = tools.filter(t => nativeToolNames.includes(t)).length;
        const mcpCount = tools.length - nativeCount;
        logger.info({ agentId, native: nativeCount, mcp: mcpCount, total: tools.length }, "Scoped tool count (3-tier)");
        scopeSummary.push(`${agentId.padEnd(24)} | native: ${String(nativeCount).padStart(3)} | mcp: ${String(mcpCount).padStart(3)} | total: ${String(tools.length).padStart(3)}`);
      }
      logger.info({ summary: scopeSummary }, "=== Tool Scoping Summary ===");
    }

    // ── SESSION RESTORATION: Rebuild in-memory session maps from persisted state ──
    try {
      const sessionRegistry = getSessionRegistry();
      const runtime = getNativeRuntime();
      const existingSessions = await sessionRegistry.list();
      let restored = 0;
      let failed = 0;

      for (const record of existingSessions) {
        if (record.has_real_conversation) {
          const ok = runtime.restoreSession(record.agent_id, record.session_id, { mode: "message" });
          if (ok) {
            restored++;
          } else {
            failed++;
          }
        }
      }

      if (restored > 0 || failed > 0) {
        logger.info({ restored, failed, total: existingSessions.length }, "Session restoration complete");
      } else {
        logger.info("No persisted sessions to restore");
      }
    } catch (err: any) {
      logger.error({ err: err.message }, "Session restoration failed — agents will start fresh");
    }

    // Start services
    await startHeartbeat(rt);
    markHealthy("heartbeat");
    const telegramBot = await startTelegram(rt);
    if (telegramBot) {
      markHealthy("telegram", { username: telegramBot.botInfo?.username });
    } else {
      markDegraded("telegram", "bot returned null from startTelegram");
    }

    // Start autonomous execution
    await startMessageProcessor(rt.ctx.kanban, rt.ctx.memory);
    await startAgentExecutor(rt.ctx.kanban, rt.ctx.memory);
    await startMeetingScheduler();
    await startAgentScheduler();
    await startBoardMeetingScheduler();
    markHealthy("board-meeting");

    // Seed CIO daily intelligence brief if not already registered
    const scheduler = await getAgentScheduler();
    const existingCioTasks = await scheduler.getTasksForAgent("cio-intelligence");
    const dailyBriefExists = existingCioTasks.some(t => t.name === "Daily Intelligence Brief" && t.enabled);
    if (!dailyBriefExists) {
      await scheduler.createTask({
        agent_id: "cio-intelligence",
        name: "Daily Intelligence Brief",
        description: "Run a full intelligence sweep across all MCP tools and deliver a synthesized daily brief to the user via Telegram.",
        schedule_type: "cron",
        cron_expression: "30 12 * * *",
        action: "custom_prompt",
        action_params: {
          prompt: `Execute a complete daily intelligence sweep using all your available MCP tools. This is your once-day comprehensive brief.

Step 1 — External Scan:
• Fetch GLOBAL_BREAKING and INDIA_NATIONAL_BASE news pools via news.fetch
• Run insights.trendingEntities to detect emerging topics and shifts
• Search Reddit (reddit.search) for ground-level sentiment on significant signals
• Run research.search on any academically or strategically relevant developments

Step 2 — Internal Context:
• Query your LifeOS databases: projects, campaigns, directives_risk_log, opportunities_strengths
• Cross-reference external signals with internal state — what trends affect your projects? What risks are emerging? What opportunities align with your strengths?

Step 3 — Synthesize:
Produce a Daily Intelligence Brief with:
1. Top 3-5 signals that matter (with why-they-matter context, not just headlines)
2. One emerging trend or connection others would miss
3. Any risks or opportunities tied to your active projects/campaigns
4. One actionable recommendation for strategic attention

Keep it tight. No data dumps. Tell the user what it MEANS, not what happened.`,
          priority: "P2",
          notify_user: true,
        },
      });
    } else {
      logger.info("CIO Daily Intelligence Brief already registered — skipping seed");
    }

    // Start memory lifecycle jobs
    const memoryFacade = rt.ctx.memoryFacade!;
    markHealthy("kanban");
    markHealthy("memory");
    const decayConfig: DecayConfig = {
      half_life_hours: 168,
      min_importance: 0.05,
      archive_threshold: 0.02,
    };

    decayTimer = setInterval(async () => {
      try {
        const result = await memoryFacade.runDecay(decayConfig);
        logger.info(result, "Memory decay run");
      } catch (err: any) {
        logger.error({ err: err.message }, "Memory decay job failed");
      }
    }, 24 * 3600000);

    consolidateTimer = setInterval(async () => {
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

    // ── Periodic health re-evaluation (OpenClaw pattern: refreshHealthSnapshot) ──
    let healthProbeConsecutiveFailures = 0;
    const HEALTH_PROBE_INTERVAL_MS = 120_000;
    setInterval(async () => {
      try {
        const { probeTelegram, getTelegramBot } = await import("./integrations/telegram.js");
        const bot = getTelegramBot();
        if (!bot) {
          markDegraded("telegram", "bot instance lost");
          return;
        }
        const result = await probeTelegram(5000);
        if (result.ok) {
          if (healthProbeConsecutiveFailures > 0) {
            logger.info({ previousFailures: healthProbeConsecutiveFailures }, "Telegram health probe recovered");
            healthProbeConsecutiveFailures = 0;
          }
          markHealthy("telegram", { username: result.username, latencyMs: result.elapsedMs });
        } else {
          healthProbeConsecutiveFailures++;
          if (healthProbeConsecutiveFailures >= 3) {
            markError("telegram", `probe failed: ${result.error}`);
          } else {
            markDegraded("telegram", `probe failed: ${result.error}`);
          }
        }
      } catch (err: any) {
        healthProbeConsecutiveFailures++;
        markDegraded("telegram", `probe error: ${err.message}`);
      }
    }, HEALTH_PROBE_INTERVAL_MS).unref?.();

    // Mark as ready — all components initialized
    logger.info("Strategos boot complete — NATIVE AGENT RUNTIME (no external dependencies)");

    // Graceful shutdown
    let shuttingDown = false;
    async function gracefulShutdown(signal: string) {
      if (shuttingDown) return;
      shuttingDown = true;

      logger.info({ signal }, "Graceful shutdown initiated");

      try {
        try {
          await sendTelegramMessage("⚠️ **Strategos going offline** for restart. I'll be right back.", "info");
        } catch { /* ignore */ }

        try {
          const { recordShutdownTimestamp, flushChatState } = await import("./integrations/telegram.js");
          recordShutdownTimestamp();
          flushChatState();
        } catch { /* ignore */ }

        // Stop error observability modules
        HeartbeatMonitor.stop();
        CronErrorHandler.stop();
        AlertManager.stop();
        ErrorAggregator.stop();
        SelfHealer.stop();

        // Stop schedulers first (prevent new work)
        getMessageProcessor()?.stop();
        getAgentExecutor()?.stop();
        getMeetingScheduler()?.stop();
        (await getAgentScheduler()).stop();
        getBoardMeetingScheduler()?.stop();
        stopHeartbeat();

        // Clear all lifecycle timers
        if (decayTimer) clearInterval(decayTimer);
        if (consolidateTimer) clearInterval(consolidateTimer);
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

        await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
        logger.info("Webhook server closed");

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
      logger.error({ err: err?.message || err }, "Unhandled rejection — marking degraded");
      markDegraded("runtime", `unhandledRejection: ${err?.message || err}`);
      ErrorBus.emit({
        type: "error:detected",
        severity: "critical",
        component: "runtime",
        error: err,
        message: `Unhandled rejection: ${err?.message || err}`,
      });
    });

    process.on("uncaughtException", (err: Error) => {
      logger.error({ err: err.message }, "Uncaught exception — marking degraded");
      markDegraded("runtime", `uncaughtException: ${err.message}`);
      ErrorBus.emit({
        type: "error:detected",
        severity: "critical",
        component: "runtime",
        error: err,
        message: `Uncaught exception: ${err.message}`,
      });
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Fatal during startup");
    process.exit(1);
  }
}

main();
