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
import { writeFileSync, readFileSync, unlinkSync, openSync, writeSync, closeSync } from "fs";
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
healthServer.headersTimeout = 10_000;
healthServer.requestTimeout = 15_000;
healthServer.timeout = 30_000;
healthServer.on("clientError", (err, socket) => { socket.destroy(); });

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
    try {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalSize += buf.length;
        if (totalSize > MAX_BODY_SIZE) {
          res.writeHead(413, { "Content-Type": "text/plain" });
          res.end("Payload too large");
          return;
        }
        chunks.push(buf);
      }
      const raw = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("application/json")) {
        const parsed = JSON.parse(raw.toString("utf-8"));
        // Prototype pollution guard
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          if ("__proto__" in parsed) delete (parsed as any).__proto__;
          if ("constructor" in parsed) delete (parsed as any).constructor;
        }
        body = parsed;
      } else {
        body = raw.toString("utf-8");
      }
    } catch (err: any) {
      if (res.writableEnded) return;
      logger.warn({ err: err.message }, "Webhook: body read/parse error (client disconnect?)");
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Request aborted");
      return;
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
  webhookServer.headersTimeout = 10_000;
  webhookServer.requestTimeout = 15_000;
  webhookServer.timeout = 30_000;
  webhookServer.on("clientError", (err, socket) => { socket.destroy(); });
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
    try {
      const dgram = require("dgram").createSocket("unixgram");
      dgram.send("WATCHDOG=1", process.env.NOTIFY_SOCKET, () => dgram.close());
    } catch {
      // NOTIFY_SOCKET not available or send failed
    }
  }
}, 30000).unref();

async function main() {
  // Single-instance enforcement via exclusive PID file creation (atomic check-and-claim)
  const pidFile = join(homedir(), ".local/run/strategos.pid");
  try {
    const fd = openSync(pidFile, 'wx');
    writeSync(fd, String(process.pid));
    closeSync(fd);
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      try {
        const existingPid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
        try {
          process.kill(existingPid, 0);
          console.error(`Strategos already running (PID ${existingPid}). Exiting.`);
          process.exit(1);
        } catch (e: any) {
          if (e.code === "ESRCH") {
            // Stale PID file — remove and retry exclusive create
            try { unlinkSync(pidFile); } catch {}
            const fd = openSync(pidFile, 'wx');
            writeSync(fd, String(process.pid));
            closeSync(fd);
          } else {
            throw e;
          }
        }
      } catch {
        // Race — another instance took it
        console.error("Strategos already running. Exiting.");
        process.exit(1);
      }
    } else {
      throw err;
    }
  }

  let decayTimer: ReturnType<typeof setInterval> | null = null;
  let consolidateTimer: ReturnType<typeof setInterval> | null = null;
  try {

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
    const mcpShutdown = rt.shutdown;

    // ── CONNECT MCP BRIDGE: External servers + native tools ──
    const mcpConfig = (config as any).mcp || {};
    const mcpToolMap = new Map<string, { conn: McpServerConnection; toolName: string }>();
    const mcpSchemaMap = new Map<string, Record<string, unknown>>();
    const onReconnect = (serverName: string, newConn: McpServerConnection) => {
      for (const [toolName, entry] of mcpToolMap) {
        if (entry.conn.serverName === serverName) {
          mcpToolMap.set(toolName, { conn: newConn, toolName: newConn.tools.find(t => t.toolName === entry.toolName)?.toolName ?? entry.toolName });
        }
      }
      for (const [toolName] of mcpSchemaMap) {
        const entry = mcpToolMap.get(toolName);
        if (entry?.conn.serverName === serverName) {
          const tool = newConn.tools.find(t => t.toolName === entry.toolName);
          if (tool) mcpSchemaMap.set(toolName, (tool.inputSchema || {}) as Record<string, unknown>);
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
        mcpSchemaMap.set(tool.name, (tool.inputSchema || {}) as Record<string, unknown>);
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
    try {
      await startMessageProcessor(rt.ctx.kanban, rt.ctx.memory);
    } catch (err: any) {
      logger.error({ err: err.message }, "Message processor failed to start — continuing without it");
      markDegraded("message-processor", err.message);
    }
    try {
      await startAgentExecutor(rt.ctx.kanban, rt.ctx.memory);
    } catch (err: any) {
      logger.error({ err: err.message }, "Agent executor failed to start — continuing without it");
      markDegraded("agent-executor", err.message);
    }
    try {
      await startMeetingScheduler();
    } catch (err: any) {
      logger.error({ err: err.message }, "Meeting scheduler failed to start — continuing without it");
      markDegraded("meeting-scheduler", err.message);
    }
    try {
      await startAgentScheduler();
    } catch (err: any) {
      logger.error({ err: err.message }, "Agent scheduler failed to start — continuing without it");
      markDegraded("agent-scheduler", err.message);
    }
    try {
      await startBoardMeetingScheduler();
    } catch (err: any) {
      logger.error({ err: err.message }, "Board meeting scheduler failed to start — continuing without it");
    }
    markHealthy("board-meeting");

    // Seed CIO daily intelligence brief if not already registered
    const scheduler = await getAgentScheduler();
    const existingCioTasks = await scheduler.getTasksForAgent("cio-intelligence");
    const dailyBriefExists = existingCioTasks.some((t: any) => t.name === "Daily Intelligence Brief" && t.enabled);
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

    // Seed CRO cron jobs if not already registered
    const existingCroTasks = await scheduler.getTasksForAgent("cro-relational");
    if (config.cro?.enabled) {
      // Job 1: Daily Nudge & Scan
      const croDailyExists = existingCroTasks.some(t => t.name === "CRO Daily Nudge & Scan" && t.enabled);
      if (!croDailyExists) {
        await scheduler.createTask({
          agent_id: "cro-relational",
          name: "CRO Daily Nudge & Scan",
          description: "Daily relational audit: check journal gaps, scan communication channels, propose reconnections, nudge user if no journal entry today.",
          schedule_type: "cron",
          cron_expression: config.cro.dailyNudgeTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your daily relational workflow:

1. JOURNAL CHECK: Query relational_journal for entries in the last 24 hours. If none, prepare a warm nudge to the user.
2. PEOPLE SCAN: Query the people DB. Identify contacts where last_connected_date > connection_frequency (overdue reconnects). List the top 3 most urgent.
3. KANBAN TRIAGE: Check your Kanban board. What's in "To Reconnect" and "This Week"? Move cards that are due.
4. CHANNEL SCAN: If you have access to Gmail (gog-cli-mcp), LinkedIn (linkedin-mcp), and Instagram (instagram-mcp) tools — scan each for relationship-relevant activity. Flag important items.
5. HEALTH CHECK: Compute relationship health from existing fields (last_connected_date vs connection_frequency, value_exchange_balance, desired_trajectory).
6. OUTPUT: Generate a brief relational summary. If no journal entry today, send a nudge via notify.telegram: "Hey! Who'd you interact with today? Even a quick mention helps me keep your relationship map current."
7. PROPOSALS: If you found overdue reconnects or new contacts, propose them to the user with specifics.

Remember: NEVER write to people DB or relational_journal without explicit user approval. Always propose first.`,
            priority: "P2",
            notify_user: true,
          },
        });
      } else {
        logger.info("CRO Daily Nudge & Scan already registered — skipping seed");
      }

      // Job 2: Weekly Network Audit
      const croWeeklyAuditExists = existingCroTasks.some(t => t.name === "CRO Weekly Network Audit" && t.enabled);
      if (!croWeeklyAuditExists) {
        await scheduler.createTask({
          agent_id: "cro-relational",
          name: "CRO Weekly Network Audit",
          description: "Weekly deep audit of relationship health: dormant contacts, value exchange balance, network gaps, new contact opportunities.",
          schedule_type: "cron",
          cron_expression: config.cro.weeklyAuditTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your weekly network audit:

1. FULL PEOPLE SCAN: Query all contacts in the people DB. Identify:
   - DORMANT: No contact in 30+ days
   - AT RISK: Overdue for reconnect AND value_exchange_balance = "I am in Debt"
   - PRIORITY: desired_trajectory = "Deepen" but last_connected is stale
2. CHANNEL SCAN: Check LinkedIn, Instagram, and Gmail for any activity from dormant contacts (job changes, posts, emails).
3. VALUE EXCHANGE REVIEW: Across all active contacts, is the balance healthy? Flag relationships where you're consistently "in Debt."
4. NEW CONTACT PROPOSALS: From your channel scans, identify 2-3 people NOT in the DB who seem worth adding. Propose them with context.
5. TRAJECTORY ADJUSTMENTS: Suggest any networking_profile or desired_trajectory changes based on recent patterns.
6. OUTPUT: Generate a weekly network health report. Propose specific actions for dormant/at-risk contacts.

Remember: Propose ALL changes for approval. Never write without user confirmation.`,
            priority: "P2",
            notify_user: false,
          },
        });
      } else {
        logger.info("CRO Weekly Network Audit already registered — skipping seed");
      }

      // Job 3: Weekly Relationship Brief
      const croWeeklyBriefExists = existingCroTasks.some(t => t.name === "CRO Weekly Relationship Brief" && t.enabled);
      if (!croWeeklyBriefExists) {
        await scheduler.createTask({
          agent_id: "cro-relational",
          name: "CRO Weekly Relationship Brief",
          description: "Monday morning relationship brief: last week's interactions, this week's priorities, upcoming follow-ups.",
          schedule_type: "cron",
          cron_expression: config.cro.weeklyBriefTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Generate your weekly relationship brief:

1. LAST WEEK REVIEW: Query relational_journal for the past 7 days. Summarize who you interacted with and key outcomes.
2. FOLLOW-UPS: Identify any follow-up actions from last week's interactions that are still pending.
3. THIS WEEK PRIORITIES: Check the people DB for contacts who need reconnection this week (last_connected_date + connection_frequency falls within the next 7 days).
4. KANBAN STATUS: What's on your board? Any "Scheduled" items for this week?
5. HEALTH TRENDS: Any relationships that are deteriorating? Any that strengthened notably?
6. OUTPUT: Send a concise weekly brief via notify.telegram covering: last week's interactions, this week's priorities, pending follow-ups, and health trends.

Keep it brief and actionable. This is the user's Monday morning relationship snapshot.`,
            priority: "P2",
            notify_user: true,
          },
        });
      } else {
        logger.info("CRO Weekly Relationship Brief already registered — skipping seed");
      }
    } else {
      logger.info("CRO cron jobs disabled by config — skipping seed");
    }

    // Seed COO cron jobs if not already registered
    const existingCooTasks = await scheduler.getTasksForAgent("coo-productivity");
    if (config.coo?.enabled) {
      // Job 1: Daily Morning Ops Check (5 AM IST)
      const cooMorningExists = existingCooTasks.some(t => t.name === "COO Daily Morning Ops Check" && t.enabled);
      if (!cooMorningExists) {
        await scheduler.createTask({
          agent_id: "coo-productivity",
          name: "COO Daily Morning Ops Check",
          description: "Morning operations briefing: review overnight activity, check all Kanban boards for blockers, identify today's top priorities, flag any at-risk deadlines.",
          schedule_type: "cron",
          cron_expression: config.coo.dailyMorningTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your daily morning operations check:

1. ACTIVITY SCAN: Review all agent Kanban boards. Any cards moved overnight? New blockers?
2. BLOCKER AUDIT: Check every board for cards stuck in "Blocked" or "In Review" for 2+ days.
3. DEADLINE CHECK: Query LifeOS for any tasks/projects with deadlines today or tomorrow. Flag anything at risk.
4. PRIORITY SETTING: Based on CEO's latest strategic directives and current board state, identify the top 3 operational priorities for today.
5. RESOURCE CHECK: Any agents showing inactivity patterns? Any tools or integrations that may need attention?
6. OUTPUT: Generate a concise morning operations brief. Highlight blockers, at-risk deadlines, and today's top 3 priorities.

Be specific. Use actual data — card names, dates, numbers. No vague summaries.`,
            priority: "P2",
            notify_user: true,
          },
        });
      } else {
        logger.info("COO Daily Morning Ops Check already registered — skipping seed");
      }

      // Job 2: Daily Evening Review (5 PM IST)
      const cooEveningExists = existingCooTasks.some(t => t.name === "COO Daily Evening Review" && t.enabled);
      if (!cooEveningExists) {
        await scheduler.createTask({
          agent_id: "coo-productivity",
          name: "COO Daily Evening Review",
          description: "End-of-day operations wrap-up: what got done, what slipped, tomorrow's prep, productivity metrics.",
          schedule_type: "cron",
          cron_expression: config.coo.dailyEveningTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your daily evening operations review:

1. COMPLETION AUDIT: Check all Kanban boards. What moved to "Done" today? Count completed items per agent.
2. SLIPPAGE REPORT: What was planned but NOT completed? Any deadlines missed today?
3. BLOCKER UPDATE: Any blockers still unresolved from this morning? Have they worsened?
4. TOMORROW PREP: Based on current board state, what are the top 3 operational priorities for tomorrow?
5. PRODUCTIVITY METRICS: Estimate today's completion rate (completed vs planned). Any agents significantly behind?
6. OUTPUT: Generate a concise evening operations review. Include: completed count, slipped items, unresolved blockers, tomorrow's priorities, and overall productivity assessment.

Be data-driven. Use actual card counts, dates, and specific items.`,
            priority: "P2",
            notify_user: true,
          },
        });
      } else {
        logger.info("COO Daily Evening Review already registered — skipping seed");
      }

      logger.info("COO cron jobs seeded successfully");
    } else {
      logger.info("COO cron jobs disabled by config — skipping seed");
    }

    // Seed CPO cron jobs if not already registered
    const existingCpoTasks = await scheduler.getTasksForAgent("cpo-psychologist");
    if (config.cpo?.enabled) {
      // Job 1: Daily Emotional Patterns
      const cpoDailyExists = existingCpoTasks.some(
        (t) => t.name === "CPO Daily Emotional Patterns" && t.enabled,
      );
      if (!cpoDailyExists) {
        await scheduler.createTask({
          agent_id: "cpo-psychologist",
          name: "CPO Daily Emotional Patterns",
          description:
            "Daily emotional pattern analysis: scan subjective_journal, score on 5 dimensions, compare to baseline, flag concerning patterns.",
          schedule_type: "cron",
          cron_expression: config.cpo.dailyAnalysisTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your daily emotional pattern analysis:

1. JOURNAL SCAN: Query subjective_journal for entries in the last 24-48 hours. Read each in full context.
2. 5D SCORING: Score each entry on Valence, Arousal, Control, Connection, and Purpose dimensions.
3. BASELINE COMPARE: Compare today's scores against your 7-day baseline. Any significant shifts?
4. BURNOUT SIGNALS: Check for sustained patterns (14+ days) across: emotional exhaustion, cynicism, reduced efficacy, absolutist language, future pessimism, physical symptoms.
5. SYSTEMIC REVIEW: Check systemic_journal for any recurring system-level concerns.
6. KANBAN PROCESS: Move any cards in "Journal Queue" or "Analyzing" forward.
7. OUTPUT: Generate a brief emotional patterns summary. If patterns are concerning (3+ burnout signals or significant baseline deviation), send a gentle check-in via notify.telegram: "Hey — I've noticed some patterns in how you've been feeling lately. Want to talk through it? No rush, just here when you're ready."

Remember: You are a reflective companion, not a therapist. Notice patterns, don't diagnose.`,
            priority: "P2",
            notify_user: false,
          },
        });
      }

      // Job 2: Weekly Wellness Check
      const cpoWeeklyExists = existingCpoTasks.some(
        (t) => t.name === "CPO Weekly Wellness Check" && t.enabled,
      );
      if (!cpoWeeklyExists) {
        await scheduler.createTask({
          agent_id: "cpo-psychologist",
          name: "CPO Weekly Wellness Check",
          description:
            "Weekly comprehensive wellness review: full week emotional analysis, burnout risk assessment, resilience indicators.",
          schedule_type: "cron",
          cron_expression: config.cpo.weeklyWellnessTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your weekly wellness check:

1. FULL WEEK ANALYSIS: Query subjective_journal for the past 7 days. Score all entries on 5 emotional dimensions. Compute weekly averages and trends for each dimension.
2. BURNOUT RISK ASSESSMENT: Check all 6 burnout signal categories (emotional exhaustion, cynicism, reduced efficacy, absolutist language, future pessimism, physical symptoms). How many show sustained patterns?
3. RESILIENCE INDICATORS: What's working well? Where is the user showing strength, adaptability, growth?
4. CROSS-DOMAIN CORRELATION: Check relational_journal for social patterns. Note any connections between mood and relationships.
5. KANBAN REVIEW: What insights have been generated? Are action items being addressed?
6. OUTPUT: Generate a weekly wellness report. Propose 1-2 reflection activities for the coming week. If burnout risk is elevated, send a gentle note via notify.telegram.

Keep it compassionate and actionable. This is a wellness review, not a clinical assessment.`,
            priority: "P2",
            notify_user: false,
          },
        });
      }

      // Job 3: Monthly Systemic Review
      const cpoMonthlyExists = existingCpoTasks.some(
        (t) => t.name === "CPO Monthly Systemic Review" && t.enabled,
      );
      if (!cpoMonthlyExists) {
        await scheduler.createTask({
          agent_id: "cpo-psychologist",
          name: "CPO Monthly Systemic Review",
          description:
            "Monthly systemic review: long-term emotional trends, project-emotion correlation, systemic insight synthesis.",
          schedule_type: "cron",
          cron_expression: config.cpo.monthlyReviewTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your monthly systemic review:

1. LONG-TERM TRENDS: Analyze subjective_journal for the past 30 days. Identify emotional trajectory across all 5 dimensions. Is the overall arc improving, stable, or declining?
2. SYSTEMIC INSIGHT SYNTHESIS: Review systemic_journal entries from the month. What recurring themes emerge? What structural factors are affecting wellbeing?
3. PROJECT-EMOTION CORRELATION: Query projects database. Are there correlations between project health/status and emotional patterns?
4. RELATIONAL CONTEXT: Note relational_journal patterns — are social connections buffering or compounding stress?
5. INTERVENTION REVIEW: What insights were generated this month? Which action items were addressed? What worked, what didn't?
6. RECOMMENDATIONS: Propose structural changes (not just coping strategies) — workload adjustment, boundary-setting, relationship priorities, self-care practices.
7. OUTPUT: Generate a monthly systemic review brief. If patterns are significant, flag to CEO via message.send with your analysis — CEO owns systemic_journal, don't write to it directly.

This is your big-picture view. Connect the dots across domains. What systemic changes would most improve the user's wellbeing?`,
            priority: "P2",
            notify_user: false,
          },
        });
      }

      logger.info("CPO cron jobs seeded successfully");
    } else {
      logger.info("CPO cron jobs disabled by config — skipping seed");
    }

    // Seed CEO cron jobs if not already registered
    const existingCeoTasks = await scheduler.getTasksForAgent("ceo-strategic");
    if (config.ceo?.enabled) {
      // Job 1: Daily Strategic Brief
      const ceoDailyExists = existingCeoTasks.some(t => t.name === "CEO Daily Strategic Brief" && t.enabled);
      if (!ceoDailyExists) {
        await scheduler.createTask({
          agent_id: "ceo-strategic",
          name: "CEO Daily Strategic Brief",
          description: "Daily strategic review: OKR progress, project health, risk assessment, opportunity scan, systemic journal review.",
          schedule_type: "cron",
          cron_expression: config.ceo.dailyBriefTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your daily strategic review:

1. OKR CHECK: Query quarterly_goals for active OKRs. Any at risk, blocked, or behind schedule?
2. PROJECT HEALTH: Query active projects. Any overdue, health declining, or deadlines approaching?
3. RISK REVIEW: Query directives_risk_log. Any high/critical risks unmitigated? Escalation needed?
4. OPPORTUNITY SCAN: Query opportunities_strengths. Any high-leverage opportunities not yet activated?
5. SYSTEMIC JOURNAL: Review recent systemic_journal entries. Any recurring patterns or systemic concerns?
6. KANBAN PROCESS: Check your Kanban board. What's in "Strategic Priorities" or "OKR Planning"?
7. OUTPUT: Generate a daily strategic summary. If anything is urgent, notify Board Chair via notify.telegram.

Keep it concise. Focus on what needs attention, not what's on track.`,
            priority: "P2",
            notify_user: true,
          },
        });
      }

      // Job 2: Weekly Strategic Review
      const ceoWeeklyExists = existingCeoTasks.some(t => t.name === "CEO Weekly Strategic Review" && t.enabled);
      if (!ceoWeeklyExists) {
        await scheduler.createTask({
          agent_id: "ceo-strategic",
          name: "CEO Weekly Strategic Review",
          description: "Weekly strategic posture review: quarterly OKR progress, portfolio health, risk/opportunity landscape.",
          schedule_type: "cron",
          cron_expression: config.ceo.weeklyReviewTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your weekly strategic review:

1. QUARTERLY OKR PROGRESS: Review all active OKRs. What's the overall quarterly trajectory? On track, at risk, or behind?
2. PORTFOLIO HEALTH: Review all active projects. What's the aggregate health? Any systemic issues across multiple projects?
3. RISK LANDSCAPE: Review all open risks. What's the aggregate risk posture? Are any risks compounding?
4. OPPORTUNITY LANDSCAPE: Review all opportunities. What's the activation rate? What's being missed?
5. SYSTEMIC PATTERNS: Review systemic_journal for the past 7 days. What recurring themes emerge?
6. STRATEGIC ALIGNMENT: Are annual goals and quarterly OKRs still aligned? Any goal pivots needed?
7. OUTPUT: Generate a weekly strategic posture report. If anything warrants Board Chair attention, flag it via notify.telegram.

This is your big-picture weekly assessment. Look for trends, not just snapshots.`,
            priority: "P2",
            notify_user: false,
          },
        });
      }

      // Job 3: Monthly Strategy Session
      const ceoMonthlyExists = existingCeoTasks.some(t => t.name === "CEO Monthly Strategy Session" && t.enabled);
      if (!ceoMonthlyExists) {
        await scheduler.createTask({
          agent_id: "ceo-strategic",
          name: "CEO Monthly Strategy Session",
          description: "Monthly strategy assessment: annual goal alignment, quarterly trajectory, systemic analysis, strategic recommendations.",
          schedule_type: "cron",
          cron_expression: config.ceo.monthlyStrategyTime,
          action: "custom_prompt",
          action_params: {
            prompt: `Execute your monthly strategy session:

1. ANNUAL GOAL ALIGNMENT: Review all annual goals. Are we on track for the year? Which goals are at risk? Any need pivot?
2. QUARTERLY TRAJECTORY: Review current quarter's OKRs. Are we on track to hit them? What needs adjustment for next quarter?
3. PORTFOLIO STRATEGY: Review all projects. Which ones are driving strategic value? Which are draining resources without return?
4. RISK & OPPORTUNITY SYNTHESIS: Review all risks and opportunities. What's the strategic threat landscape? What opportunities should we activate?
5. SYSTEMIC ANALYSIS: Review systemic_journal for the month. What systemic patterns are emerging? What structural changes would improve outcomes?
6. STRATEGIC RECOMMENDATIONS: Based on all of the above, what 2-3 strategic recommendations would you make to the Board Chair?
7. OUTPUT: Generate a monthly strategy report. Log key insights to systemic_journal. Notify Board Chair of significant findings via notify.telegram.

This is your monthly strategic deep-dive. Think in quarters and years, not days.`,
            priority: "P2",
            notify_user: false,
          },
        });
      }

      logger.info("CEO cron jobs seeded successfully");
    } else {
      logger.info("CEO cron jobs disabled by config — skipping seed");
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
    if (decayTimer && typeof decayTimer.unref === "function") decayTimer.unref();

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
    if (consolidateTimer && typeof consolidateTimer.unref === "function") consolidateTimer.unref();

    logger.info("Memory lifecycle jobs started (decay: daily, consolidation: 6h)");

    // ── Periodic health re-evaluation (OpenClaw pattern: refreshHealthSnapshot) ──
    let healthProbeConsecutiveFailures = 0;
    const HEALTH_PROBE_INTERVAL_MS = 120_000;
    let healthProbeTimer: ReturnType<typeof setInterval> | null = null;
    healthProbeTimer = setInterval(async () => {
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
    }, HEALTH_PROBE_INTERVAL_MS);
    if (healthProbeTimer && typeof healthProbeTimer.unref === "function") healthProbeTimer.unref();

    // Mark as ready — all components initialized
    logger.info("Strategos boot complete — NATIVE AGENT RUNTIME (no external dependencies)");

    // Graceful shutdown
    const SHUTDOWN_TIMEOUT_MS = 15000;
    let shuttingDown = false;
    async function gracefulShutdown(signal: string) {
      if (shuttingDown) return;
      shuttingDown = true;

      logger.info({ signal }, "Graceful shutdown initiated");

      // Force exit if shutdown takes too long
      const shutdownTimeout = setTimeout(() => {
        logger.error("Shutdown timeout exceeded — force exit");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      shutdownTimeout.unref();

      try {
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

        // Stop session manager cleanup timer + close CTO approval DB
        try { const { stopSessionManager } = await import("./auth/session.js"); stopSessionManager(); } catch { /* ignore */ }
        try { const { closeCtoDb } = await import("./cto/approval-handler.js"); closeCtoDb(); } catch { /* ignore */ }

        // Stop schedulers first (prevent new work)
        getMessageProcessor()?.stop();
        getAgentExecutor()?.stop();
        getMeetingScheduler()?.stop();
        (await getAgentScheduler()).stop();
        getBoardMeetingScheduler()?.stop();
        stopHeartbeat();

        // Stop Telegram bot (long-polling) before draining
        if (telegramBot) {
          try { await telegramBot.stop(); } catch { /* ignore */ }
          logger.info("Telegram bot stopped");
        }

        // Drain in-flight work (LLM calls, tool executions, file writes)
        logger.info("Draining in-flight work...");
        await new Promise(r => setTimeout(r, 3000));

        // Clear all lifecycle timers
        if (decayTimer) clearInterval(decayTimer);
        if (consolidateTimer) clearInterval(consolidateTimer);
        clearInterval(watchdogTimer);
        if (healthProbeTimer) clearInterval(healthProbeTimer);
        clearTimeout(shutdownTimeout);

        // Close MemoryFacade
        try { const { getMemoryFacade } = await import("./memory/index.js"); const mf = await getMemoryFacade(); mf.close?.(); logger.info("MemoryFacade closed"); } catch { /* ignore */ }

        // Close kanban database
        if (rt.ctx.kanban) { await rt.ctx.kanban.close(); logger.info("Kanban database closed"); }

        // Close messaging system
        try {
          const messaging = await import("./organic/messaging.js");
          const ms = await messaging.getMessagingSystem();
          if (ms?.close) { await ms.close(); }
          logger.info("Messaging system closed");
        } catch { /* ignore */ }

        // Clear session registry
        try { const { getSessionRegistry } = await import("./scheduler/session-registry.js"); const sr = getSessionRegistry(); await sr.close?.(); logger.info("Session registry closed"); } catch { /* ignore */ }

        // Clear ToolSearch cache (unbounded Map)
        try { const { cleanupAll } = await import("./runtime/tool-search.js"); cleanupAll(); logger.info("ToolSearch cache cleared"); } catch { /* ignore */ }

        // Close MCP connections
        if (mcpShutdown) { try { await mcpShutdown(); logger.info("MCP server shutdown complete"); } catch { /* ignore */ } }
        for (const conn of mcpConnections) { try { await conn.dispose(); } catch { /* ignore */ } }
        logger.info({ count: mcpConnections.length }, "MCP connections closed");

        // Notify systemd we're stopping
        if (process.env.NOTIFY_SOCKET) {
          try {
            const dgram = require("dgram").createSocket("unixgram");
            dgram.send("STOPPING=1", process.env.NOTIFY_SOCKET, () => dgram.close());
          } catch { /* ignore */ }
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
    process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));

    process.on("unhandledRejection", (err: any) => {
      logger.error({ err: err?.message || err }, "Unhandled rejection — initiating graceful shutdown");
      markDegraded("runtime", `unhandledRejection: ${err?.message || err}`);
      ErrorBus.emit({
        type: "error:detected",
        severity: "critical",
        component: "runtime",
        error: err,
        message: `Unhandled rejection: ${err?.message || err}`,
      });
      if (!shuttingDown) gracefulShutdown("unhandledRejection");
    });

    process.on("uncaughtException", (err: Error) => {
      logger.error({ err: err.message }, "Uncaught exception — initiating graceful shutdown");
      markDegraded("runtime", `uncaughtException: ${err.message}`);
      ErrorBus.emit({
        type: "error:detected",
        severity: "critical",
        component: "runtime",
        error: err,
        message: `Uncaught exception: ${err.message}`,
      });
      if (!shuttingDown) gracefulShutdown("uncaughtException");
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Fatal during startup");
    process.exit(1);
  }
}

main();
