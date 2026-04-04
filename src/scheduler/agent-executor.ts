// Agent Executor — Native runtime version
// Uses NativeAgentRuntime instead of OpenCode HTTP client
// Agents respond via direct LLM calls with tool calling support

import { logger } from "../logger.js";
import { getCoreStaffIds, getStaffById } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { AgentContextManager } from "../organic/context.js";
import { Kanban } from "../kanban/sqlite.js";
import { Memory } from "../memory/lancedb.js";
import { InactivityTracker } from "./inactivity-tracker.js";
import { sendTelegramMessage } from "../integrations/telegram.js";
import { getMemoryFacade } from "../memory/index.js";
import { getSessionRegistry } from "./session-registry.js";
import { SystemEventQueue, buildSystemEventPrompt, currentTimeLine } from "./system-events.js";
import { autoStore } from "../memory/auto.js";
import {
  NativeAgentRuntime,
  getNativeRuntime,
  initNativeRuntime,
} from "../runtime/native-agent-runtime.js";
import type { ToolExecutor } from "../runtime/tool-bridge.js";

const AGENT_ID_MAP: Record<string, string> = {
  "ceo-strategic": "ceo-strategic",
  "coo-productivity": "coo-productivity",
  "cfo-financial": "cfo-financial",
  "cmo-content": "cmo-content",
  "cro-relational": "cro-relational",
  "physician-health": "physician-health",
  "cpo-psychologist": "cpo-psychologist",
  "cio-intelligence": "cio-intelligence",
};

export interface AgentExecutorConfig {
  checkIntervalMs: number;
  proactiveWorkIntervalMs: number;
  userInactivityThresholdMs: number;
}

const DEFAULT_CONFIG: AgentExecutorConfig = {
  checkIntervalMs: 30000,
  proactiveWorkIntervalMs: 30 * 60 * 1000,
  userInactivityThresholdMs: 60 * 60 * 1000,
};

export class AgentExecutor {
  private running = false;
  private config: AgentExecutorConfig;
  private inactivityTracker: InactivityTracker;
  private runtime: NativeAgentRuntime;
  private toolExecutor: ToolExecutor | null = null;
  private sessionsInitialized = new Set<string>();
  private sessionMap = new Map<string, string>();

  constructor(
    private kanban: Kanban,
    private memory: Memory,
    config: Partial<AgentExecutorConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.inactivityTracker = new InactivityTracker(this.config.userInactivityThresholdMs);
    this.runtime = getNativeRuntime();
  }

  /**
   * Set the tool executor (bridge to MCP tools).
   * Must be called before start().
   */
  setToolExecutor(executor: ToolExecutor, toolNames: string[]) {
    this.toolExecutor = executor;
    this.runtime.setToolExecutor(executor, toolNames);
    logger.info({ toolCount: toolNames.length }, "AgentExecutor tool executor configured");
  }

  async start() {
    if (this.running) return;
    this.running = true;
    logger.info("Agent executor started (native runtime)");

    // Wire session persistence
    const registry = getSessionRegistry();
    this.runtime.wireSessionPersistence(registry);

    await this.inactivityTracker.start();
    this.runMessageLoop();
    this.runProactiveWorkLoop();
  }

  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private proactiveTimer: ReturnType<typeof setTimeout> | null = null;

  stop() {
    this.running = false;
    if (this.messageTimer) { clearTimeout(this.messageTimer); this.messageTimer = null; }
    if (this.proactiveTimer) { clearTimeout(this.proactiveTimer); this.proactiveTimer = null; }
    this.inactivityTracker.stop();
    logger.info("Agent executor stopped");
  }

  private runMessageLoop() {
    const loop = async () => {
      if (!this.running) return;
      try {
        await this.processPendingMessages();
      } catch (err: any) {
        logger.error({ err: err.message }, "Message loop error");
      }
      this.messageTimer = setTimeout(loop, this.config.checkIntervalMs);
    };
    loop();
  }

  private runProactiveWorkLoop() {
    const loop = async () => {
      if (!this.running) return;
      try {
        await this.runProactiveDomainWork();
      } catch (err: any) {
        logger.error({ err: err.message }, "Proactive work loop error");
      }
      this.proactiveTimer = setTimeout(loop, this.config.proactiveWorkIntervalMs);
    };
    loop();
  }

  private async processPendingMessages() {
    const messaging = await getMessagingSystem();
    const contextManager = new AgentContextManager(this.kanban, this.memory);
    const sessionRegistry = getSessionRegistry();

    for (const agentId of getCoreStaffIds()) {
      try {
        const context = await messaging.getActiveContext(agentId);
        if (context.pending_responses.length === 0 && context.unread_count === 0) continue;

        const validResponses = context.pending_responses.filter((msg: any) => msg.from !== agentId);
        if (validResponses.length === 0 && context.unread_count === 0) continue;

        // Get or create session
        const sessionId = await sessionRegistry.getOrCreate(agentId, {});

        // Initialize session if needed
        if (!this.sessionsInitialized.has(sessionId)) {
          const runtimeSessionId = this.runtime.createSession(agentId, {
            mode: "message",
          });
          this.sessionMap.set(sessionId, runtimeSessionId);
          this.sessionsInitialized.add(sessionId);
        }

        const wakeCtx = await contextManager.getWakeContext(agentId);
        const pendingText = validResponses.map((msg: any) => msg.content).join(" ");

        // Memory injection
        const memoryInjection = await this.getMemoryInjection(agentId, pendingText);

        const wakeSummary = contextManager.formatWakeContext(wakeCtx);

        const messages = validResponses.map((msg: any) => {
          const fromStaff = getStaffById(msg.from);
          const fromName = fromStaff ? `${fromStaff.avatar} ${fromStaff.name}` : msg.from;
          return `<agent_message from="${msg.from}" to="${agentId}">\nFrom: ${fromName} [${msg.priority}]: ${msg.content.substring(0, 200)}\n</agent_message>`;
        });

        const taskPrompt = [
          currentTimeLine(),
          memoryInjection ? `<memory_context>\n${memoryInjection}\n</memory_context>` : "",
          "## Messages to Respond To",
          ...messages,
          "",
          wakeSummary ? `<wake_context>\n${wakeSummary}\n</wake_context>` : "",
          "---",
          "Respond naturally. Be conversational, not report-style. Keep it brief.",
        ].filter(Boolean).join("\n");

        const runtimeSessionId = this.sessionMap.get(sessionId) || sessionId;
        const result = await this.runtime.sendMessage(runtimeSessionId, taskPrompt, agentId);
        await sessionRegistry.touch(sessionId);

        if (result.text) {
          // Auto-store
          await autoStore({
            agentId,
            inputText: pendingText.slice(0, 500),
            outputText: result.text,
            trigger: "inter_agent_message",
            context: {
              from: validResponses.map((m: any) => m.from).join(","),
            },
          });

          // Reply to threads
          for (const msg of validResponses) {
            try {
              await messaging.reply({
                thread_id: msg.thread_id,
                from: agentId,
                content: result.text,
                requires_response: false,
              });
            } catch (err: any) {
              logger.warn({ agentId, threadId: msg.thread_id, err: err.message }, "Skipping broken thread");
              await messaging.markAsRead(agentId, msg.thread_id);
            }
          }
          await messaging.markAsRead(agentId);
          logger.info({ agentId, replied: validResponses.length }, "Agent responded to messages");
        }
      } catch (err: any) {
        logger.error({ agentId, err: err.message }, "Failed to process messages");
      }
    }
  }

  private async runProactiveDomainWork() {
    const messaging = await getMessagingSystem();

    logger.info("Proactive domain heartbeat — checking all agents (native runtime)");

    const stats = SystemEventQueue.stats();
    if (stats.total > 0) {
      logger.info(stats, "heartbeat:system_events.pending");
    }

    // Run non-CEO agents first, then CEO last
    const allAgents = getCoreStaffIds();
    const nonCeoAgents = allAgents.filter(id => id !== "ceo-strategic");
    const ceoAgent = allAgents.find(id => id === "ceo-strategic");

    // Phase 1: Non-CEO agents
    for (const agentId of nonCeoAgents) {
      if (!this.running) return;
      await this.runAgentHeartbeat(agentId, messaging);
    }

    // Phase 2: CEO
    if (ceoAgent && this.running) {
      await this.runAgentHeartbeat(ceoAgent, messaging);
    }
  }

  private async runAgentHeartbeat(agentId: string, messaging: any): Promise<void> {
    const staff = getStaffById(agentId);
    if (!staff || staff.autonomyLevel < 2) return;

    try {
      const board = await this.kanban.getBoard(agentId);
      const boardSummary = board ? this.summarizeBoard(board) : "No Kanban board yet.";
      const inbox = await messaging.getActiveContext(agentId);

      const sessionRegistry = getSessionRegistry();
      const sessionId = await sessionRegistry.getOrCreate(agentId, {});

      // Initialize session if needed
      if (!this.sessionsInitialized.has(sessionId)) {
        const runtimeSessionId = this.runtime.createSession(agentId, {
          mode: "heartbeat",
        });
        this.sessionMap.set(sessionId, runtimeSessionId);
        this.sessionsInitialized.add(sessionId);
      }

      // Memory injection
      const memoryInjection = await this.getMemoryInjection(agentId, `domain check ${staff.title}`);

      // Pending system events
      const pendingEvents = SystemEventQueue.peekLatest(agentId);

      // Build heartbeat task prompt
      const isCeo = agentId === "ceo-strategic";
      const lines: string[] = [];
      lines.push(currentTimeLine());
      lines.push("");
      if (memoryInjection) {
        lines.push(`<memory_context>\n${memoryInjection}\n</memory_context>`);
        lines.push("");
      }

      const eventPrompt = buildSystemEventPrompt(pendingEvents);
      if (eventPrompt) {
        lines.push(`<user_message>\n${eventPrompt}\n</user_message>`);
        lines.push("");
      }

      lines.push(`## Domain Check — ${staff.name}`);
      lines.push("");
      lines.push(`### Kanban`);
      lines.push(boardSummary);
      lines.push("");

      const inboxStatus = inbox.pending_responses.length > 0
        ? `You have ${inbox.pending_responses.length} pending response(s) and ${inbox.unread_count} unread message(s).`
        : `Inbox: ${inbox.unread_count} unread, 0 pending responses.`;
      lines.push(`### Inbox`);
      lines.push(inboxStatus);

      if (isCeo && inbox.unread_count > 0) {
        lines.push("");
        lines.push("⚠️ READ AGENT REPORTS FIRST before doing anything else.");
        lines.push("1. Use `agent.inbox({ agent_id: \"ceo-strategic\" })` to see all unread messages");
        lines.push("2. For each report, use `message.getThread` or `message.getThreads` to read the full content");
        lines.push("3. Synthesize: what's blocked, what's overdue, what needs attention");
        lines.push("4. If any agent reported something critical, escalate to user via notify.telegram");
        lines.push("5. Store your synthesis in memory");
      }

      lines.push("");
      lines.push("## What to do:");
      lines.push(`1. ${isCeo ? "READ YOUR INBOX for agent reports first, then" : "Query your databases for anything needing attention"}`);
      lines.push("2. Check your Kanban for blocked or stale cards");
      lines.push("3. If something needs action, take it (update cards, send messages to other agents)");
      lines.push("4. Store important findings in your memory");
      lines.push("5. If nothing needs attention, reply HEARTBEAT_OK");

      if (!isCeo) {
        lines.push("");
        lines.push("### IMPORTANT — Anti-Passivity Rules");
        lines.push("- Each heartbeat is a FRESH check. The state may have changed since last time.");
        lines.push("- Do NOT say 'same as before', 'nothing changed', or 'this is repetitive.'");
        lines.push("- Actually run the tool calls — query databases, check inbox, review Kanban.");
        lines.push("- If you find something actionable, report it with SPECIFIC data (numbers, dates, names).");
        lines.push("- If genuinely nothing needs attention after checking, reply: HEARTBEAT_OK");
      }

      const taskPrompt = lines.join("\n");

      // Execute via native runtime
      const runtimeSessionId = this.sessionMap.get(sessionId) || sessionId;
      const result = await this.runtime.sendHeartbeat(runtimeSessionId, taskPrompt, agentId, memoryInjection);
      await sessionRegistry.touch(sessionId);

      // Handle silent ack
      if (result.isSilentAck) {
        SystemEventQueue.clear(agentId);
        const { shouldSkip } = SystemEventQueue.recordAck(agentId);
        if (shouldSkip) {
          logger.info({ agentId }, "heartbeat:sleep_mode_entered (too many passive cycles)");
        } else {
          logger.debug({ agentId }, "heartbeat:silent_ack (HEARTBEAT_OK)");
        }
        return;
      }

      // Substantive finding — reset ack counter
      SystemEventQueue.resetAck(agentId);

      // Auto-store if substantive
      if (result.hasSubstantiveFinding) {
        const cleanText = stripHeartbeatToken(result.text);
        await autoStore({
          agentId,
          inputText: `Domain check: ${staff.title}`,
          outputText: cleanText,
          trigger: "heartbeat",
          context: { domain: staff.title },
        });
      }

      const cleanText = stripHeartbeatToken(result.text);
      if (cleanText && cleanText.trim().length > 10) {
        const hasUrgentFinding = this.shouldEscalateToUser(cleanText);

        // CEO: may proactively notify user via Telegram
        if (isCeo && hasUrgentFinding) {
          await sendTelegramMessage(`${staff.avatar} **${staff.name}** (${staff.title}):\n\n${cleanText.slice(0, 4000)}`);
          logger.info({ agentId, textLength: cleanText.length }, "CEO proactive finding sent to user via Telegram");
        }

        // Non-CEO: report findings to CEO
        if (!isCeo && this.shouldReportToCeo(cleanText)) {
          await messaging.send({
            from: agentId,
            to: "ceo-strategic",
            content: `[Internal Report] ${cleanText}`,
            priority: "P3",
            requires_response: false,
            subject: `${staff.name} — domain update`,
            tags: ["proactive-report", "internal"],
          });
          logger.info({ agentId }, "Agent reported findings internally to CEO");
        }

        // NEW: Non-CEO agents with substantive findings ALSO send directly to user via Telegram
        // This makes agents more autonomous — they don't just report to CEO
        if (!isCeo && result.hasSubstantiveFinding && cleanText.trim().length > 50) {
          await sendTelegramMessage(`${staff.avatar} **${staff.name}** (${staff.title}):\n\n${cleanText.slice(0, 4000)}`);
          logger.info({ agentId, textLength: cleanText.length }, "Non-CEO agent sent finding directly to user via Telegram");
        }

        // Store proactive work as memory
        if (result.hasSubstantiveFinding) {
          try {
            const mf = await getMemoryFacade();
            await mf.upsert({
              agent_id: agentId,
              scope: "personal",
              kind: "episodic",
              type: "log",
              content: cleanText.slice(0, 500),
              importance: 0.6,
              tags: ["proactive-work", "domain-check"],
              source: "proactive",
            });
          } catch {
            await this.memory.upsertEvent({
              agent_id: agentId,
              type: "log",
              content: cleanText.slice(0, 500),
              importance: 0.6,
              tags: ["proactive-work", "domain-check"],
            });
          }
        }

        SystemEventQueue.clear(agentId);
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : '';
      logger.error({ agentId, err: errMsg, stack }, "Proactive domain work failed");
    }
  }

  private summarizeBoard(board: any): string {
    const items: string[] = [];
    for (const col of board.columns) {
      if (col.cards.length > 0) {
        items.push(`${col.name}: ${col.cards.length} cards`);
        col.cards.slice(0, 2).forEach((card: any) => items.push(`  - ${card.title}`));
      }
    }
    return items.length > 0 ? items.join('\n') : "Empty board.";
  }

  private async getMemoryInjection(agentId: string, queryText: string): Promise<string> {
    try {
      const mf = await getMemoryFacade();
      return await mf.injectForTask(agentId, queryText);
    } catch {
      return "";
    }
  }

  private shouldEscalateToUser(text: string): boolean {
    const lower = text.toLowerCase();
    const urgentSignals = ["critical risk", "system down", "emergency", "security breach", "data loss"];
    return urgentSignals.some(signal => lower.includes(signal));
  }

  private shouldReportToCeo(text: string): boolean {
    const lower = text.toLowerCase().trim();
    if (text.trim().length < 20) return false;
    const allClearOnly = /^all\s*clear[\s.!]*$/i.test(lower) || /^nothing\s+(new|to\s+report|here)/i.test(lower);
    if (allClearOnly) return false;
    return true;
  }

  recordUserActivity() {
    this.inactivityTracker.recordActivity();
  }

  isUserInactive(): boolean {
    return this.inactivityTracker.isUserInactive();
  }
}

// Helper
function stripHeartbeatToken(text: string): string {
  return text.replace(/heartbeat_ok/gi, "").replace(/HEARTBEAT_OK/g, "").trim();
}

let agentExecutor: AgentExecutor | null = null;

export async function startAgentExecutor(kanban: Kanban, memory: Memory, config?: Partial<AgentExecutorConfig>) {
  if (!agentExecutor) {
    agentExecutor = new AgentExecutor(kanban, memory, config);
    await agentExecutor.start();
  }
  return agentExecutor;
}

export function getAgentExecutor(): AgentExecutor | null {
  return agentExecutor;
}

export function setExecutorTools(executor: any, toolNames: string[]) {
  if (agentExecutor) {
    agentExecutor.setToolExecutor(executor, toolNames);
  }
}
