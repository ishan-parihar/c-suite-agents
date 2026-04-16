import { Telegraf, Markup } from "telegraf";
import { logger } from "../logger.js";
import { cfg, getConfig } from "../config.js";
import type { OperantRuntime } from "../types.js";
import { getOrgChart, getCoreStaffIds, getStaffById, AGENT_ID_MAP } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { getMeetingGovernance } from "../organic/meetings.js";
import { getHiringSystem } from "../organic/hiring.js";
import { AgentContextManager } from "../organic/context.js";
import { getNativeRuntime } from "../runtime/native-agent-runtime.js";
import { autoStore, autoRecall } from "../memory/auto.js";
import { getMemoryFacade } from "../memory/index.js";
import { getSessionRegistry } from "../scheduler/session-registry.js";
import { getAgentHealthRegistry } from "../scheduler/agent-health.js";
import { getReportsAndSessions } from "../mcp/tools-reports.js";
import { getAgentScheduler } from "../scheduler/agent-scheduler.js";
import os from "node:os";
import path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { ErrorBus } from "../runtime/error-emitter.js";
import { GatewayError } from "../runtime/error-types.js";
import { AsyncMutex } from "../runtime/async-mutex.js";

type AgentRegistry = { agents: Map<string, { id: string; role: string; boardId: string }>; cards: Map<string, string> };

const TELEGRAM_MAX_LENGTH = 4000;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/**
 * Converts markdown to Telegram-compatible HTML.
 * Follows openclaw's approach: markdown → HTML with <b>, <i>, <s>, <code>, <pre><code>, <a>, <blockquote>.
 */
function markdownToTelegramHtml(md: string): string {
  let result = "";
  const lines = md.split("\n");
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  const flushBlockquote = () => {
    if (blockquoteLines.length > 0) {
      result += `<blockquote>${blockquoteLines.join("\n")}</blockquote>\n`;
      blockquoteLines = [];
    }
    inBlockquote = false;
  };

  const formatInline = (text: string): string => {
    let t = escapeHtml(text);
    if (t.length > 4096) t = t.slice(0, 4096);
    t = t.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, (_m, content) => `<b><i>${content}</i></b>`);
    t = t.replace(/\*\*(.+?)\*\*/g, (_m, content) => `<b>${content}</b>`);
    t = t.replace(/__(.+?)__/g, (_m, content) => `<b>${content}</b>`);
    t = t.replace(/\*(.+?)\*/g, (_m, content) => `<i>${content}</i>`);
    t = t.replace(/_(.+?)_/g, (_m, content) => `<i>${content}</i>`);
    t = t.replace(/~~(.+?)~~/g, (_m, content) => `<s>${content}</s>`);
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => `<a href="${escapeHtmlAttr(url)}">${text}</a>`);
    return t;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inCodeBlock) {
      if (line.startsWith("```")) {
        inCodeBlock = false;
        result += `<pre><code>${escapeHtml(codeBlockContent.join("\n"))}</code></pre>\n`;
        codeBlockContent = [];
      } else {
        codeBlockContent.push(line);
      }
      continue;
    }

    if (line.startsWith("```")) {
      flushBlockquote();
      inCodeBlock = true;
      codeBlockContent = [];
      continue;
    }

    if (line.startsWith("> ")) {
      inBlockquote = true;
      blockquoteLines.push(formatInline(line.slice(2)));
      continue;
    } else if (inBlockquote) {
      flushBlockquote();
    }

    if (line.startsWith("### ")) {
      result += `<b>${formatInline(line.slice(4))}</b>\n`;
    } else if (line.startsWith("## ")) {
      result += `<b>${formatInline(line.slice(3))}</b>\n`;
    } else if (line.startsWith("# ")) {
      result += `<b>${formatInline(line.slice(2))}</b>\n`;
    } else if (/^[-*] /.test(line)) {
      result += `• ${formatInline(line.slice(2))}\n`;
    } else if (/^\d+\. /.test(line)) {
      result += `${formatInline(line)}\n`;
    } else if (line.trim() === "") {
      result += "\n";
    } else {
      result += `${formatInline(line)}\n`;
    }
  }

  flushBlockquote();

  if (inCodeBlock) {
    result += `<pre><code>${escapeHtml(codeBlockContent.join("\n"))}</code></pre>\n`;
  }

  return result.trim();
}

const HTML_TAG_PATTERN = /(<\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?>/gi;

interface HtmlTag {
  name: string;
  openTag: string;
  closeTag: string;
}

/**
 * Splits HTML into chunks that respect the Telegram message length limit.
 * Maintains tag nesting so each chunk is valid HTML on its own.
 * Based on openclaw's splitTelegramHtmlChunks approach.
 */
function splitTelegramHtmlChunks(html: string, limit: number): string[] {
  if (!html) return [];
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (html.length <= normalizedLimit) return [html];

  const chunks: string[] = [];
  const openTags: HtmlTag[] = [];
  let current = "";
  let chunkHasPayload = false;

  const resetCurrent = () => {
    current = openTags.map((t) => t.openTag).join("");
    chunkHasPayload = false;
  };

  const closeSuffix = (tags: HtmlTag[]): string =>
    [...tags].reverse().map((t) => t.closeTag).join("");

  const closeSuffixLength = (tags: HtmlTag[]): number =>
    tags.reduce((sum, t) => sum + t.closeTag.length, 0);

  const flushCurrent = () => {
    if (!chunkHasPayload) return;
    chunks.push(`${current}${closeSuffix(openTags)}`);
    resetCurrent();
  };

  const appendText = (segment: string) => {
    let remaining = segment;
    while (remaining.length > 0) {
      const available = normalizedLimit - current.length - closeSuffixLength(openTags);
      if (available <= 0) {
        if (!chunkHasPayload) {
          throw new Error(`Telegram chunk limit exceeded by tag overhead (limit=${normalizedLimit})`);
        }
        flushCurrent();
        continue;
      }
      if (remaining.length <= available) {
        current += remaining;
        chunkHasPayload = true;
        break;
      }
      // Split at a safe boundary: prefer last space, avoid breaking in the middle of &entities;
      let splitAt = available;
      const lastSpace = remaining.lastIndexOf(" ", available);
      const lastNewline = remaining.lastIndexOf("\n", available);
      const safeSplit = Math.max(lastSpace, lastNewline);
      if (safeSplit > available * 0.5) {
        splitAt = safeSplit + 1;
      }
      // Don't break in the middle of HTML entities
      const lastAmp = remaining.lastIndexOf("&", splitAt);
      if (lastAmp >= 0 && lastAmp < splitAt) {
        const semiIdx = remaining.indexOf(";", lastAmp);
        if (semiIdx >= 0 && semiIdx < splitAt) {
          // Entity is complete before split, safe
        } else if (semiIdx >= splitAt) {
          splitAt = lastAmp;
        }
      }
      if (splitAt <= 0) splitAt = 1;
      current += remaining.slice(0, splitAt);
      chunkHasPayload = true;
      remaining = remaining.slice(splitAt);
      flushCurrent();
    }
  };

  resetCurrent();
  HTML_TAG_PATTERN.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_TAG_PATTERN.exec(html)) !== null) {
    const tagStart = match.index;
    const tagEnd = HTML_TAG_PATTERN.lastIndex;
    appendText(html.slice(lastIndex, tagStart));

    const isClosing = match[1] === "</";
    const tagName = match[2].toLowerCase();
    const isSelfClosing = !isClosing && match[0].trimEnd().endsWith("/>");

    if (!isClosing) {
      const nextCloseLength = isSelfClosing ? 0 : `</${tagName}>`.length;
      if (
        chunkHasPayload &&
        current.length + match[0].length + closeSuffixLength(openTags) + nextCloseLength >
          normalizedLimit
      ) {
        flushCurrent();
      }
    }

    current += match[0];
    if (!isSelfClosing) {
      if (isClosing) {
        for (let i = openTags.length - 1; i >= 0; i--) {
          if (openTags[i].name === tagName) {
            openTags.splice(i, 1);
            break;
          }
        }
      } else {
        openTags.push({
          name: tagName,
          openTag: match[0],
          closeTag: `</${tagName}>`,
        });
      }
    }
    lastIndex = tagEnd;
  }

  appendText(html.slice(lastIndex));
  flushCurrent();
  return chunks.length > 0 ? chunks : [html];
}

/**
 * Sends HTML content to Telegram with smart chunking and parse fallback.
 * Follows openclaw's pattern: try HTML, fall back to plain text on parse errors.
 */
async function sendTelegramHtmlChunks(
  ctx: any,
  html: string,
  plainText: string,
): Promise<void> {
  let htmlChunks: string[];
  try {
    htmlChunks = splitTelegramHtmlChunks(html, TELEGRAM_MAX_LENGTH);
  } catch (err: any) {
    logger.warn({ err: err.message }, "telegram:html.chunking.failed, falling back to plain text");
    return sendTelegramHtmlChunks(ctx, plainText, plainText);
  }
  const sentMessageIds: number[] = [];

  for (let i = 0; i < htmlChunks.length; i++) {
    const isLastChunk = i === htmlChunks.length - 1;
    const chunk = htmlChunks[i];
    if (!chunk) continue;

    try {
      const result = await ctx.reply(chunk, { parse_mode: "HTML" });
      if (result?.message_id) sentMessageIds.push(result.message_id);
    } catch (err: any) {
      // Check if it's a parse error — fall back to plain text for this chunk
      if (/can't parse entities|parse entities|find end of the entity/i.test(err.message)) {
        logger.warn({ chunkIndex: i }, "HTML parse error, falling back to plain text for chunk");
        const plainChunks = splitTelegramHtmlChunks(plainText, TELEGRAM_MAX_LENGTH);
        const fallback = plainChunks[i] || chunk;
        const result = await ctx.reply(fallback);
        if (result?.message_id) sentMessageIds.push(result.message_id);
      } else {
        throw err;
      }
    }
  }
}

const STATE_FILE = path.join(os.homedir(), ".operant", "state", "telegram-routes.json");
const SHUTDOWN_TS_FILE = path.join(os.homedir(), ".operant", "state", "shutdown-timestamp.json");

// ── Module-level routing state (lifted from startTelegram for board meeting access) ──

type ChatRoute = { participants: string[]; mode: "single"|"meeting"|"threaded"; lastActive: number; timeoutMs: number };
const defaultTimeoutMs = parseInt(process.env.TG_ROUTE_TIMEOUT_MS || "1800000", 10); // 30 minutes

const chatAgentMap = new Map<string, string>();
const chatRoutes = new Map<string, ChatRoute>();
const chatMutex = new AsyncMutex();
let lastChatRoutesPruneTime = 0;

function getRoute(chatId: string): ChatRoute {
  const now = Date.now();
  if (now - lastChatRoutesPruneTime > 3600000) { // every hour
    lastChatRoutesPruneTime = now;
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    for (const [id, route] of chatRoutes) {
      if (now - route.lastActive > ONE_WEEK) {
        chatRoutes.delete(id);
        chatAgentMap.delete(id);
      }
    }
  }
  const r = chatRoutes.get(chatId);
  if (r) return { ...r, participants: [...r.participants] };
  const created: ChatRoute = { participants: ["ceo-strategic"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs };
  chatRoutes.set(chatId, created);
  return { ...created, participants: [...created.participants] };
}

function setRoute(chatId: string, route: ChatRoute) {
  chatRoutes.set(chatId, { ...route, lastActive: Date.now() });
}

function persistState() {
  const state: Record<string, { agent_id: string; route?: { participants: string[]; mode: "single"|"meeting"|"threaded"; timeoutMs: number } }> = {};
  for (const [chatId, agentId] of chatAgentMap) {
    const route = chatRoutes.get(chatId);
    state[chatId] = {
      agent_id: agentId,
      route: route ? { participants: route.participants, mode: route.mode, timeoutMs: route.timeoutMs } : undefined,
    };
  }
  saveChatState(state);
}

/**
 * Explicitly flush chat routing state to disk.
 * Called on shutdown to prevent state loss between last route change and restart.
 */
export function flushChatState(): void {
  // Prune stale entries older than 7 days
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [chatId, route] of chatRoutes) {
    if (route.lastActive && (now - route.lastActive) > SEVEN_DAYS) {
      chatRoutes.delete(chatId);
      chatAgentMap.delete(chatId);
    }
  }
  persistState();
}

function loadChatState(): Record<string, { agent_id: string; route?: { participants: string[]; mode: "single"|"meeting"|"threaded"; timeoutMs: number } }> {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const stat = fs.statSync(STATE_FILE);
      if (stat.size > 100 * 1024) {
        logger.warn({ path: STATE_FILE, size: stat.size }, "telegram-routes.json too large, using default state");
        return {};
      }
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "Failed to load chat state, using defaults");
  }
  return {};
}

function saveChatState(state: Record<string, { agent_id: string; route?: { participants: string[]; mode: "single"|"meeting"|"threaded"; timeoutMs: number } }>) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmpPath = `${STATE_FILE}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    fs.renameSync(tmpPath, STATE_FILE);
  } catch (err: any) {
    logger.error({ err: err.message, path: STATE_FILE }, "Failed to persist chat routing state — agent selection will reset to CEO on restart");
  }
}

export function recordShutdownTimestamp() {
  try {
    fs.mkdirSync(path.dirname(SHUTDOWN_TS_FILE), { recursive: true });
    fs.writeFileSync(SHUTDOWN_TS_FILE, JSON.stringify({ timestamp: Date.now() }, null, 2));
  } catch (err: any) {
    logger.warn({ err: err.message }, "Failed to record shutdown timestamp");
  }
}

function readShutdownTimestamp(): number | null {
  try {
    if (fs.existsSync(SHUTDOWN_TS_FILE)) {
      const stat = fs.statSync(SHUTDOWN_TS_FILE);
      if (stat.size > 100 * 1024) {
        logger.warn({ path: SHUTDOWN_TS_FILE, size: stat.size }, "shutdown-timestamp.json too large, returning null");
        return null;
      }
      const data = JSON.parse(fs.readFileSync(SHUTDOWN_TS_FILE, "utf-8"));
      return data.timestamp ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

async function sendCommandsPage(ctx: any, page: number, totalPages: number) {
  const start = (page - 1) * COMMANDS_PER_PAGE;
  const end = Math.min(start + COMMANDS_PER_PAGE, OPERANT_COMMANDS.length);
  const pageCommands = OPERANT_COMMANDS.slice(start, end);

  const lines = [`<b>📋 Operant Commands</b> (Page ${page}/${totalPages})\n`];
  for (let i = 0; i < pageCommands.length; i++) {
    const cmd = pageCommands[i];
    lines.push(`<b>/${escapeHtml(cmd.command)}</b> — ${escapeHtml(cmd.description)}`);
  }

  const buttons: any[] = [];
  if (page > 1) {
    buttons.push(Markup.button.callback("◀ Prev", `commands_page_${page - 1}`));
  }
  buttons.push(Markup.button.callback(`${page}/${totalPages}`, "commands_page_noop"));
  if (page < totalPages) {
    buttons.push(Markup.button.callback("Next ▶", `commands_page_${page + 1}`));
  }

  await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([buttons]),
  });
}

function formatDowntime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "a few seconds";
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  if (remainingMin === 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  return `${hours}h ${remainingMin}m`;
}

const OPERANT_COMMANDS = [
  { command: "start", description: "Welcome message" },
  { command: "agent", description: "Pick an agent from inline menu" },
  { command: "meeting", description: "Start/end board meeting" },
  { command: "meetings", description: "Pending meeting proposals" },
  { command: "org", description: "Organization chart" },
  { command: "staff", description: "Core staff list" },
  { command: "agents", description: "All agents with status" },
  { command: "wake", description: "Agent wake context" },
  { command: "messages", description: "Browse message threads" },
  { command: "inbox", description: "Message inbox" },
  { command: "recall", description: "Search vector memory" },
  { command: "memory", description: "Memory statistics" },
  { command: "board", description: "View Kanban board" },
  { command: "report", description: "Latest reports" },
  { command: "session", description: "Session management" },
  { command: "hire", description: "Hire auxiliary staff" },
  { command: "fire", description: "Fire auxiliary staff" },
  { command: "team", description: "View auxiliary team" },
  { command: "cron", description: "Scheduled tasks" },
  { command: "status", description: "System health status" },
  { command: "help", description: "Command reference" },
];

const COMMANDS_PER_PAGE = 10;

let boardMeetingActive = false;
let previousRoute: ChatRoute | null = null;

export async function startTelegram(rt: OperantRuntime) {
  if (telegramBot) {
    logger.warn("Telegram bot already running, ignoring duplicate start");
    return telegramBot;
  }

  if (!cfg.telegramToken || cfg.telegramToken === "your_bot_token_here") {
    logger.warn("Telegram not configured - set TELEGRAM_BOT_TOKEN in .env");
    return null;
  }

  if (!cfg.telegramChatId || cfg.telegramChatId === "your_chat_id_here") {
    logger.warn("Telegram chat ID not configured - set TELEGRAM_CHAT_ID in .env");
    return null;
  }

  try {
    const bot = new Telegraf(cfg.telegramToken, {
      handlerTimeout: 120_000,
      telegram: { timeout: 15000, retryLimit: 3 } as Record<string, unknown>,
    });
    const registry: AgentRegistry = { agents: new Map(), cards: new Map() };
    const contextManager = new AgentContextManager(rt.ctx.kanban, rt.ctx.memory);
    
    logger.info({ chatId: cfg.telegramChatId }, "Telegram starting...");

    // Restore agent selection state from disk
    const persistedState = loadChatState();
    const now = Date.now();
    for (const [chatId, entry] of Object.entries(persistedState)) {
      const agentId = entry.agent_id || "ceo-strategic";
      chatAgentMap.set(chatId, agentId);
      if (entry.route) {
        chatRoutes.set(chatId, { ...entry.route, lastActive: now });
      } else {
        chatRoutes.set(chatId, { participants: [agentId], mode: "single", lastActive: now, timeoutMs: defaultTimeoutMs });
      }
    }
    logger.info({ restoredChats: Object.keys(persistedState).length }, "Chat state restored from disk");

    // SessionRegistry for persistent session management
    const sessionRegistry = getSessionRegistry();

    // /start command
    bot.command("start", async (ctx) => {
      try {
        if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
        
        const staffList = getCoreStaffIds()
          .map(id => {
            const s = getStaffById(id);
            return s ? `• ${s.avatar} ${s.name} — ${s.title}` : "";
          })
          .filter(Boolean)
          .join("\n");
        
        const message = `<b>👋 I'm Operant, your CEO agent.</b>

<b>Core Staff:</b>
${staffList}

<b>Commands:</b>
/start — Welcome message
/agent — Pick an agent from inline menu
/help — Command reference
/org — Organization chart
/staff — List core staff
/agents — All agents
/wake [agent] — Agent context
/messages [agent] — Browse messages
/recall [query] — Search memory
/meeting [end|names...] — Start/end board meeting
/session — Session management
/status — System status
/board [agent] — View Kanban board
/inbox [agent] — Message inbox
/report [agent] — Latest reports
/hire [role] [manager] [tasks...] — Hire staff
/fire [agent_id] [reason] — Fire staff
/team [manager] — View auxiliary team
/memory — Memory statistics
/cron — Scheduled tasks
/meetings — Pending meeting proposals

Just talk naturally to interact with the team!`;
        
        await ctx.reply(message, { parse_mode: "HTML" });
        const chatId = ctx.chat.id.toString();
        const currentAgent = chatAgentMap.get(chatId) || "ceo-strategic";
        setRoute(chatId, { participants: [currentAgent], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
      } catch (err: any) {
        logger.error({ err: err.message }, "telegram.command.start.error");
        await ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
      }
    });

    // /agent - Summon any agent
    bot.command("agent", async (ctx) => {
      try {
        if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
        
        const args = (ctx.message as any)?.text?.split(" ") || [];
        const agentName = args[1]?.toLowerCase();
        
        if (!agentName) {
          const chatId = ctx.chat.id.toString();
          const currentAgentId = chatAgentMap.get(chatId) || "ceo-strategic";

          const buttons = getCoreStaffIds().map(id => {
            const s = getStaffById(id);
            if (!s) return null;
            const isActive = id === currentAgentId;
            const label = isActive ? `✅ ${s.avatar} ${s.name}` : `${s.avatar} ${s.name}`;
            return Markup.button.callback(label, `agent_${id}`);
          }).filter(Boolean);

          const rows: any[][] = [];
          for (let i = 0; i < buttons.length; i += 2) {
            rows.push(buttons.slice(i, i + 2));
          }

          const currentStaff = getStaffById(currentAgentId);
          const currentLabel = currentStaff
            ? `${currentStaff.avatar} ${currentStaff.name}`
            : currentAgentId;

          await ctx.reply(
            `<b>🎯 Summon an Agent</b>\n\nCurrently: ${currentLabel}\n\nTap an agent below to switch:`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) },
          );
          return;
        }
        
        const agentId = getCoreStaffIds().find(id => {
          const s = getStaffById(id);
          return s?.name.toLowerCase().replace(/\s+/g, '-') === agentName || id.toLowerCase().includes(agentName);
        });
        
        if (!agentId) {
          await ctx.reply(`<b>❌ Agent not found.</b> Try /agent to see available agents.`, { parse_mode: "HTML" });
          return;
        }
        
        chatAgentMap.set(ctx.chat.id.toString(), agentId);
        setRoute(ctx.chat.id.toString(), { participants: [agentId], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
        persistState();
        const staff = getStaffById(agentId);
        await ctx.reply(`<b>✅ Now speaking with ${staff?.avatar} ${staff?.name}</b>\n\n${staff?.title || "Agent"}\n\nAsk me anything or give me tasks.`, { parse_mode: "HTML" });
        logger.info({ chat_id: ctx.chat.id.toString(), agent_id: agentId }, "Agent summoned");
      } catch (err: any) {
        logger.error({ err: err.message }, "telegram.command.agent.error");
        await ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
      }
    });

    // /meeting command: manage multi-agent sessions (user can still start meetings)
    bot.command("meeting", async (ctx) => {
      try {
        if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
        const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
        if (args.length === 0) {
          await ctx.reply(`<b>⏳ Board Meeting Management</b>

Usage:
/meeting [end|names...]

Examples:
• <b>/meeting CFO CMO CTO</b> — Start board meeting with these agents
• <b>/meeting end</b> — End current meeting and return to single-agent mode

The meeting will be processed through the board meeting engine with turn-based discussion.`, { parse_mode: "HTML" });
          return;
        }
        const chatId = ctx.chat.id.toString();
        if (args[0].toLowerCase() === "end") {
          setRoute(chatId, { participants: ["ceo-strategic"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
          persistState();
          await ctx.reply(`<b>🛑 Meeting ended. Back to Operant.</b>`, { parse_mode: "HTML" });
          return;
        }
        const wanted = args.map((a: string) => a.toLowerCase());
        const ids = getCoreStaffIds().filter(id => {
          const s = getStaffById(id);
          if (!s) return false;
          const key = s.name.toLowerCase().replace(/\s+/g, '-');
          return wanted.includes(key) || wanted.includes(id.toLowerCase());
        });
        if (ids.length === 0) { await ctx.reply(`<b>❌ No valid agents found</b>`, { parse_mode: "HTML" }); return; }
        setRoute(chatId, { participants: ids, mode: "meeting", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
        persistState();
        const names = ids.map(id => {
          const s = getStaffById(id);
          return s ? `${s.avatar} ${s.name}` : id;
        }).join(", ");
        const namesList = ids.map(id => {
          const s = getStaffById(id);
          return s ? `• ${s.avatar} <b>${s.name}</b> — ${s.title}` : `• ${id}`;
        }).join("\n");
        await ctx.reply(`<b>🏛 Multi-Agent Discussion Active</b>

Participants:
${namesList}

Your messages will be sent to all participants concurrently. Each agent will respond independently.

<b>Note:</b> This routes messages to multiple agents. For formal board meetings with quorum voting, agents can use the board meeting tools internally.`, { parse_mode: "HTML" });
      } catch (err: any) {
        logger.error({ err: err.message }, "telegram.command.meeting.error");
        await ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
      }
    });

    // ── Board Meeting Decision Callbacks ──────────────────────────────
    bot.action(/^board_(approve|reject)_(.+)$/, async (ctx) => {
      const action = ctx.match[1] as "approve" | "reject";
      const meetingId = ctx.match[2];
      const decision = action === "approve" ? "approved" as const : "negated" as const;

      try {
        const { applyUserDecision } = await import("../organic/board-meeting.js");
        await applyUserDecision(meetingId, decision);
        await ctx.answerCbQuery(decision === "approved" ? "✅ Decision applied" : "❌ Meeting discarded");

        try {
          const msg = ctx.callbackQuery.message;
          if (msg && "text" in msg) {
            const originalText = msg.text || "";
            const decisionEmoji = decision === "approved" ? "✅ <b>Approved</b>" : "❌ <b>Rejected</b>";
            await ctx.editMessageText(`${originalText}\n\n${decisionEmoji}`, { parse_mode: "HTML" });
          }
        } catch { /* ignore edit failures (e.g., message too old) */ }

        logger.info({ meetingId, decision }, "Board meeting decision applied");
      } catch (err: any) {
        logger.error({ meetingId, err: err.message }, "Failed to apply board meeting decision");
        await ctx.answerCbQuery("❌ Failed to apply decision");
      }
    });

    // ── CTO Upgrade Approval/Rejection Callbacks ──────────────────────────────
    bot.action(/^upgrade_(approve|reject)_(.+)$/, async (ctx) => {
      const action = ctx.match[1] as "approve" | "reject";
      const proposalId = ctx.match[2];
      const decision = action === "approve" ? "approved" as const : "rejected" as const;

      try {
        const { handleUpgradeApproval } = await import("../cto/approval-handler.js");
        const result = await handleUpgradeApproval(proposalId, decision);

        await ctx.answerCbQuery(result.success
          ? (decision === "approved" ? "✅ Upgrade approved" : "❌ Upgrade rejected")
          : `❌ ${result.message}`);

        try {
          const msg = ctx.callbackQuery.message;
          if (msg && "text" in msg) {
            const originalText = msg.text || "";
            const decisionEmoji = decision === "approved" ? "✅ <b>Approved</b>" : "❌ <b>Rejected</b>";
            await ctx.editMessageText(`${originalText}\n\n${decisionEmoji}`, { parse_mode: "HTML" });
          }
        } catch { /* ignore edit failures */ }

        logger.info({ proposalId, decision, success: result.success }, "CTO upgrade decision applied");
      } catch (err: any) {
        logger.error({ proposalId, err: err.message }, "Failed to apply upgrade decision");
        await ctx.answerCbQuery("❌ Failed to apply decision");
      }
    });

    // /org command
    bot.command("org", async (ctx) => {
      try {
        if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
        const html = markdownToTelegramHtml(getOrgChart());
        await ctx.reply(html, { parse_mode: "HTML" });
      } catch (err: any) {
        logger.error({ err: err.message }, "telegram.command.org.error");
        await ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
      }
    });

    // /staff command
    bot.command("staff", async (ctx) => {
      try {
        if (ctx.chat.id.toString() !== cfg.telegramChatId) return;

        const staffLines = getCoreStaffIds().map(id => {
          const s = getStaffById(id);
          if (!s) return "";
          return `${s.avatar} <b>${s.name}</b> — ${s.title}\n   ├─ Board: ${s.boardSeat ? "Yes" : "No"}\n   └─ Reports: ${s.reportsTo || "CEO"}`;
        }).filter(Boolean).join("\n\n");

        await ctx.reply(`<b>Core Staff:</b>\n\n${staffLines}`, { parse_mode: "HTML" });
      } catch (err: any) {
        logger.error({ err: err.message }, "telegram.command.staff.error");
        await ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
      }
    });

    // /agents command — core staff + auxiliary from HiringSystem
    bot.command("agents", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      await ctx.sendChatAction("typing");

      const core = getCoreStaffIds()
        .map(id => {
          const s = getStaffById(id);
          return s ? `🏢 ${s.avatar} <b>${s.name}</b> — ${s.title}` : "";
        })
        .filter(Boolean);

      let aux: string[] = [];
      try {
        const hiring = await getHiringSystem();
        const allContracts = await hiring.getAllContracts();
        const activeContracts = allContracts.filter(c => c.status === "active");
        aux = activeContracts.map(c => {
          const mgr = getStaffById(c.reports_to);
          const mgrName = mgr ? `${mgr.avatar} ${mgr.name}` : c.reports_to;
          return `  🤖 <b>${escapeHtml(c.role)}</b> (<code>${escapeHtml(c.agent_id)}</code>) → ${mgrName}`;
        });
      } catch (e: any) {
        logger.warn({ err: e.message }, "Failed to fetch auxiliary agents");
      }

      const coreSection = `<b>Core Staff (${core.length}):</b>\n${core.join("\n")}`;
      const auxSection = aux.length > 0
        ? `\n\n<b>Auxiliary Staff (${aux.length}):</b>\n${aux.join("\n")}`
        : `\n\n<i>No auxiliary staff hired yet. Use /hire to add team members.</i>`;

      await ctx.reply(`${coreSection}${auxSection}`, { parse_mode: "HTML" });
    });

    // /wake command
    bot.command("wake", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(" ") || [];
      const agentId = args[1];
      
      if (!agentId) {
        await ctx.reply("Usage: /wake [agent_id]\nExample: /wake cmo-content");
        return;
      }
      
      await ctx.sendChatAction("typing");
      try {
        const context = await contextManager.getWakeContext(agentId);
        const formatted = await contextManager.formatWakeContext(context);
        await ctx.reply(markdownToTelegramHtml(formatted), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /messages command — Browse message threads (superseded by /inbox)
    bot.command("messages", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(" ") || [];
      const agentId = args[1] || "ceo-strategic";

      await ctx.sendChatAction("typing");
      try {
        const messaging = await getMessagingSystem();
        const threads = await messaging.getThreadsForAgent(agentId, 15);

        if (threads.length === 0) {
          await ctx.reply(`<b>📭 No message threads for</b> <b>${escapeHtml(agentId)}</b>\n\nTry /inbox for a complete inbox view with unread counts and escalations.`, { parse_mode: "HTML" });
          return;
        }

        const formatTime = (ts: number | undefined): string => {
          if (!ts) return "unknown";
          const d = new Date(ts < 1e12 ? ts * 1000 : ts);
          if (isNaN(d.getTime())) return "unknown";
          return d.toLocaleString();
        };

        const statusEmoji: Record<string, string> = { active: "🟢", resolved: "✅", escalated: "⚠️", archived: "📦" };
        const lines = threads.map(t => {
          const other = t.participants.find(p => p !== agentId) || "unknown";
          const otherStaff = getStaffById(other);
          const otherName = otherStaff ? `${otherStaff.avatar} ${otherStaff.name}` : other;
          const ts = formatTime(t.updated_at);
          const sEmoji = statusEmoji[t.status] || "⚪";
          return `${sEmoji} <b>${escapeHtml(t.subject)}</b> (with ${escapeHtml(otherName)})\n  <i>${ts} [${t.status}]</i>`;
        }).join("\n");

        const unreadCount = await messaging.getUnreadCount(agentId);
        await ctx.reply(`<b>📬 Message Threads for ${escapeHtml(agentId)} (${threads.length})</b>\nUnread messages: <b>${unreadCount}</b>\n\n${lines}`, { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /recall command
    bot.command("recall", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(" ") || [];
      const query = args.slice(1).join(" ");
      
      if (!query) {
        await ctx.reply(`<b>🧠 Vector Memory Search</b>

Usage: /recall [query]
Example: /recall budget meeting

Searches across messages, tasks, and stored memories for the CEO agent.`, { parse_mode: "HTML" });
        return;
      }
      
      await ctx.sendChatAction("typing");
      try {
        const result = await contextManager.recall({ agent_id: "ceo-strategic", query, top_k: 10 });
        
        if (result.results.length === 0) {
          await ctx.reply(`<b>🔍 No results for</b> "${escapeHtml(query)}"`, { parse_mode: "HTML" });
          return;
        }

        const lines = result.results.slice(0, 5).map(r => {
          const icon = r.type === "message" ? "💬" : r.type === "task" ? "📋" : r.type === "memory" ? "🧠" : "🏛";
          return `${icon} <b>[${r.type}]</b> ${escapeHtml(r.summary)}\n   <i>Relevance: ${(r.relevance * 100).toFixed(0)}%</i>`;
        }).join("\n");

        await ctx.reply(`<b>🔍 Results for "${escapeHtml(query)}" (${result.total_found} found)</b>\n\n${lines}`, { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /help command
    bot.command("help", async (ctx) => {
      try {
        const helpText = `<b>📋 Operant Help</b>

<b>Organization Commands:</b>
/org — Organization chart
/staff — Core staff list
/agents — All agents (core + auxiliary)
/agent — Pick an agent from inline menu

<b>Memory &amp; Context:</b>
/wake [agent] — View agent's wake context
/messages [agent] — Browse message threads
/inbox [agent] — Full inbox with unread, escalations (recommended)
/recall [query] — Search CEO memory (messages, tasks, embeddings)
/memory — Memory statistics across all scopes

<b>Kanban &amp; Reports:</b>
/board [agent] — View Kanban board (tap names to switch)
/inbox [agent] — Message inbox
/report [agent] — Latest periodic reports

<b>Team Management:</b>
/hire [role] [manager] [tasks...] — Hire auxiliary staff
/fire [agent_id] [reason] — Fire auxiliary staff
/team [manager] — View auxiliary team

<b>Meetings:</b>
/meeting [end|names...] — Multi-agent discussion mode
/meetings — Active meetings + governance proposals

<b>Scheduling:</b>
/cron — List scheduled tasks
/cron status [agent] — Task status for agent
/cron pause [task_id] — Pause a task
/cron resume [task_id] — Resume a task

<b>System Commands:</b>
/status — System status
/session — Session management
/help — This help message

<b>Natural Language:</b>
Just talk naturally! Examples:
• "Understand my trajectory"
• "Prioritize today"
• "Create a developer agent"
• "Propose a board meeting"`;

        await ctx.reply(helpText, { parse_mode: "HTML" });
      } catch (err: any) {
        logger.error({ err: err.message }, "telegram.command.help.error");
        await ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
      }
    });

    // /session command - manage sessions
    bot.command("session", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const chatId = ctx.chat.id.toString();
      
      if (args.length === 0) {
        // Show current sessions
        const sessions = await sessionRegistry.list();
        const chatSessions = sessions.filter(s => s.chat_id === chatId);
        
        if (chatSessions.length === 0) {
          await ctx.reply("📭 No active sessions. Send a message to create one.");
          return;
        }

        const sessionLines = chatSessions.map(s => `• <b>${escapeHtml(s.agent_id)}</b>: <code>${escapeHtml(s.session_id)}</code> (${s.message_count} msgs)`).join("\n");
        await ctx.reply(`<b>📊 Active Sessions:</b>\n\n${sessionLines}`, { parse_mode: "HTML" });
        return;
      }

      if (args[0].toLowerCase() === "reset" || args[0].toLowerCase() === "clear") {
        const agentId = args[1];
        if (!agentId) {
          await ctx.reply("Usage: /session reset [agent] or /session clear [agent]\nExample: /session reset cfo-financial\n\n⚠️ This clears the session but keeps LanceDB memory intact.");
          return;
        }

        await sessionRegistry.invalidate(agentId, chatId);

        await ctx.reply(`<b>✅ Session cleared for</b> <b>${escapeHtml(agentId)}</b>\n\n⚠️ LanceDB memory embeddings are preserved. Only conversation context was reset.`, { parse_mode: "HTML" });
        logger.info({ chatId, agentId }, "Session reset via registry");
        return;
      }

      await ctx.reply("Usage: /session — List sessions\n/session reset [agent] — Clear session (memory preserved)");
    });

    // /board command — View Kanban board
    bot.command("board", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const chatId = ctx.chat.id.toString();
      const activeAgentId = chatAgentMap.get(chatId) || "ceo-strategic";

      await ctx.sendChatAction("typing");
      try {
        if (args.length > 0) {
          // Specific agent's board
          const agentId = args[0];
          const board = await rt.ctx.kanban.getBoard(agentId);
          if (!board) {
            await ctx.reply(`<b>❌ Board not found for</b> <b>${escapeHtml(agentId)}</b>`, { parse_mode: "HTML" });
            return;
          }
          const staff = getStaffById(agentId);
          const agentName = staff ? `${staff.avatar} ${staff.name}` : agentId;
          const priorityEmoji: Record<string, string> = { P1: "🔴", P2: "🟡", P3: "🔵", P4: "⚪" };

          const lines = [`<b>📋 ${escapeHtml(agentName)}'s Board</b>\n`];
          for (const col of board.columns) {
            const cardCount = col.cards.length;
            lines.push(`<b>${escapeHtml(col.name)}</b> (${cardCount})`);
            for (const card of col.cards.slice(0, 8)) {
              const emoji = priorityEmoji[card.priority] || "⚪";
              const dueStr = card.due ? ` <i>(due: ${escapeHtml(card.due)})</i>` : "";
              lines.push(`  ${emoji} <b>${escapeHtml(card.title)}</b>${dueStr}`);
            }
            if (col.cards.length > 8) lines.push(`  ... and ${col.cards.length - 8} more`);
            if (cardCount === 0) lines.push(`  <i>(empty)</i>`);
          }
          const totalCards = board.columns.reduce((sum, c) => sum + c.cards.length, 0);
          lines.push(`\n<b>Total: ${totalCards} cards</b>`);
          await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
        } else {
          // Show current agent's board with option to switch
          const board = await rt.ctx.kanban.getBoard(activeAgentId);
          if (!board) {
            await ctx.reply(`<b>❌ Board not found for active agent</b>`, { parse_mode: "HTML" });
            return;
          }
          const staff = getStaffById(activeAgentId);
          const agentName = staff ? `${staff.avatar} ${staff.name}` : activeAgentId;
          const priorityEmoji: Record<string, string> = { P1: "🔴", P2: "🟡", P3: "🔵", P4: "⚪" };

          const lines = [`<b>📋 ${escapeHtml(agentName)}'s Board</b>\n`];
          for (const col of board.columns) {
            const cardCount = col.cards.length;
            lines.push(`<b>${escapeHtml(col.name)}</b> (${cardCount})`);
            for (const card of col.cards.slice(0, 8)) {
              const emoji = priorityEmoji[card.priority] || "⚪";
              const dueStr = card.due ? ` <i>(due: ${escapeHtml(card.due)})</i>` : "";
              lines.push(`  ${emoji} <b>${escapeHtml(card.title)}</b>${dueStr}`);
            }
            if (col.cards.length > 8) lines.push(`  ... and ${col.cards.length - 8} more`);
            if (cardCount === 0) lines.push(`  <i>(empty)</i>`);
          }
          const totalCards = board.columns.reduce((sum, c) => sum + c.cards.length, 0);
          lines.push(`\n<b>Total: ${totalCards} cards</b>`);

          // Build inline keyboard with other staff agents
          const buttons = getCoreStaffIds()
            .filter(id => id !== activeAgentId)
            .slice(0, 6)
            .map(id => {
              const s = getStaffById(id);
              return s ? Markup.button.callback(`${s.avatar} ${s.name}`, `board_view_${id}`) : null;
            })
            .filter(Boolean);
          const rows: any[][] = [];
          for (let i = 0; i < buttons.length; i += 2) {
            rows.push(buttons.slice(i, i + 2));
          }

          await ctx.reply(lines.join("\n"), {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(rows),
          });
        }
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /inbox command — View message inbox
    bot.command("inbox", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const chatId = ctx.chat.id.toString();
      const activeAgentId = chatAgentMap.get(chatId) || "ceo-strategic";
      const agentId = args[0] || activeAgentId;

      await ctx.sendChatAction("typing");
      try {
        const messaging = await getMessagingSystem();
        const context = await messaging.getActiveContext(agentId);

        const formatTime = (ts: number): string => {
          if (!ts) return "unknown";
          const d = new Date(ts < 1e12 ? ts * 1000 : ts);
          if (isNaN(d.getTime())) return "unknown";
          return d.toLocaleString();
        };

        const lines = [`<b>📬 Inbox for ${escapeHtml(agentId)}</b>\n`];
        lines.push(`Unread: <b>${context.unread_count}</b> | Pending Responses: <b>${context.pending_responses.length}</b>`);

        if (context.unread_count > 0) {
          const unread = await messaging.getUnreadMessages(agentId, 10);
          lines.push("\n<b>📥 Unread Messages:</b>");
          for (const msg of unread.slice(0, 5)) {
            const fromStaff = getStaffById(msg.from);
            const fromName = fromStaff ? `${fromStaff.avatar} ${fromStaff.name}` : msg.from;
            const ts = formatTime(msg.created_at);
            const priorityTag = msg.priority === "P1" ? "🔴" : msg.priority === "P2" ? "🟡" : "";
            const preview = msg.content.length > 100 ? msg.content.slice(0, 100) + "..." : msg.content;
            lines.push(`${priorityTag} <b>[${msg.priority}] ${escapeHtml(fromName)}</b> — ${ts}`);
            lines.push(`<i>${escapeHtml(preview)}</i>`);
          }
          if (unread.length > 5) lines.push(`... and ${context.unread_count - 5} more`);
        }

        if (context.pending_responses.length > 0) {
          lines.push("\n<b>⏳ Awaiting Your Response:</b>");
          for (const msg of context.pending_responses.slice(0, 3)) {
            const fromStaff = getStaffById(msg.from);
            const fromName = fromStaff ? `${fromStaff.avatar} ${fromStaff.name}` : msg.from;
            lines.push(`• ${escapeHtml(fromName)}: ${escapeHtml(msg.content.slice(0, 80))}...`);
          }
        }

        if (context.active_threads.length > 0) {
          lines.push(`\n<b>💬 Active Threads (${context.active_threads.length}):</b>`);
          for (const thread of context.active_threads.slice(0, 5)) {
            const other = thread.participants.find(p => p !== agentId) || "unknown";
            const otherStaff = getStaffById(other);
            const otherName = otherStaff ? `${otherStaff.avatar} ${otherStaff.name}` : other;
            lines.push(`• ${escapeHtml(thread.subject)} (with ${escapeHtml(otherName)})`);
          }
        }

        if (context.recent_escalations && context.recent_escalations.length > 0) {
          lines.push(`\n<b>⚠️ Escalations (${context.recent_escalations.length}):</b>`);
          for (const esc of context.recent_escalations.slice(0, 3)) {
            const toStaff = getStaffById(esc.to);
            const toName = toStaff ? `${toStaff.avatar} ${toStaff.name}` : esc.to;
            lines.push(`• → ${escapeHtml(toName)}: ${escapeHtml(esc.reason.slice(0, 80))} <i>[${esc.status}]</i>`);
          }
        }

        if (context.unread_count === 0 && context.pending_responses.length === 0 && (!context.recent_escalations || context.recent_escalations.length === 0)) {
          lines.push("\n<i>📭 Inbox is clear</i>");
        }

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /report command — View latest periodic reports
    bot.command("report", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const chatId = ctx.chat.id.toString();
      const activeAgentId = chatAgentMap.get(chatId) || "ceo-strategic";
      const agentId = args[0] || activeAgentId;

      await ctx.sendChatAction("typing");
      try {
        const rs = await getReportsAndSessions();
        const reports = await rs.getLatestReports(agentId, 5);

        if (!reports || reports.length === 0) {
          await ctx.reply(`<b>📊 No reports found for</b> <b>${escapeHtml(agentId)}</b>`, { parse_mode: "HTML" });
          return;
        }

        const lines = [`<b>📊 Latest Reports for ${escapeHtml(agentId)}</b>\n`];
        for (const report of reports) {
          const dateStr = report.created_at ? new Date(report.created_at).toLocaleString() : "unknown";
          lines.push(`<b>📅 ${escapeHtml(report.period)}</b> — ${dateStr}`);
          if (report.summary) lines.push(`<i>${escapeHtml(report.summary.slice(0, 200))}</i>`);
          if (report.metrics && Object.keys(report.metrics).length > 0) {
            const metricStrs = Object.entries(report.metrics).slice(0, 5).map(([k, v]) => `  • ${escapeHtml(String(k))}: ${escapeHtml(String(v))}`);
            lines.push(metricStrs.join("\n"));
          }
          if (report.actions && report.actions.length > 0) {
            lines.push(`<b>Action Items:</b>`);
            for (const action of report.actions.slice(0, 3)) {
              const assignee = action.assignee ? ` (${action.assignee})` : "";
              const due = action.due ? ` [due: ${action.due}]` : "";
              lines.push(`  • ${escapeHtml(action.description)}${assignee}${due}`);
            }
          }
          lines.push("");
        }

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /hire command — Hire auxiliary staff
    bot.command("hire", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];

      if (args.length < 2) {
        await ctx.reply(`<b>📋 Hire Auxiliary Staff</b>

Usage: /hire [role] [manager] [task1, task2, ...]

Example:
/hire Developer coo-productivity Build auth system, Write tests, Review PRs

• <b>role</b> — Job title/role name
• <b>manager</b> — Core staff member who manages this hire
• <b>tasks</b> — Comma-separated list of responsibilities`, { parse_mode: "HTML" });
        return;
      }

      const role = args[0];
      const reportsTo = args[1];
      const tasksStr = args.slice(2).join(" ");
      const tasks = tasksStr.split(",").map((t: string) => t.trim()).filter(Boolean);

      if (tasks.length === 0) {
        await ctx.reply(`<b>❌ Please provide at least one task.</b>\n\nUsage: /hire [role] [manager] [task1, task2, ...]`, { parse_mode: "HTML" });
        return;
      }

      await ctx.sendChatAction("typing");
      try {
        const hiring = await getHiringSystem();
        const contract = await hiring.create({ role, reports_to: reportsTo, tasks });

        const managerStaff = getStaffById(reportsTo);
        const managerName = managerStaff ? `${managerStaff.avatar} ${managerStaff.name}` : reportsTo;

        await ctx.reply(`<b>✅ Staff Hired!</b>

<b>Role:</b> ${escapeHtml(contract.role)}
<b>Agent ID:</b> <code>${escapeHtml(contract.agent_id)}</code>
<b>Reports to:</b> ${escapeHtml(managerName)}
<b>Tasks:</b> ${contract.tasks.map((t: string) => escapeHtml(t)).join(", ")}

The new team member has been registered in Kanban and Memory systems.`, { parse_mode: "HTML" });
        logger.info({ agentId: contract.agent_id, role, reportsTo }, "Staff hired via Telegram");
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /fire command — Fire auxiliary staff
    bot.command("fire", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];

      if (args.length < 2) {
        await ctx.reply(`<b>⚠️ Fire Auxiliary Staff</b>

Usage: /fire [agent_id] [reason]

Example:
/fire dev-abc12345 Project no longer requires this role

<b>Warning:</b> This will terminate the contract and cancel all pending delegations.`, { parse_mode: "HTML" });
        return;
      }

      const agentId = args[0];
      const reason = args.slice(1).join(" ");

      // Validate it's not core staff
      const coreStaff = getCoreStaffIds();
      if (coreStaff.includes(agentId)) {
        await ctx.reply(`<b>❌ Cannot fire core staff member</b> <b>${escapeHtml(agentId)}</b>. Core staff cannot be terminated.`, { parse_mode: "HTML" });
        return;
      }

      await ctx.sendChatAction("typing");
      try {
        const hiring = await getHiringSystem();
        const contract = await hiring.fire({ agent_id: agentId, reason });

        await ctx.reply(`<b>🔴 Staff Released</b>

<b>Role:</b> ${escapeHtml(contract.role)}
<b>Agent ID:</b> <code>${escapeHtml(agentId)}</code>
<b>Reason:</b> ${escapeHtml(reason)}

All pending delegations have been cancelled.`, { parse_mode: "HTML" });
        logger.info({ agentId, role: contract.role, reason }, "Staff fired via Telegram");
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /team command — View auxiliary team members
    bot.command("team", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const managerId = args[0] || "ceo-strategic";

      await ctx.sendChatAction("typing");
      try {
        const hiring = await getHiringSystem();
        const contracts = await hiring.getContractsForManager(managerId);

        const managerStaff = getStaffById(managerId);
        const managerName = managerStaff ? `${managerStaff.avatar} ${managerStaff.name}` : managerId;

        if (contracts.length === 0) {
          await ctx.reply(`<b>👥 ${escapeHtml(managerName)} has no auxiliary staff.</b>

Use /hire [role] ${escapeHtml(managerId)} [tasks...] to add team members.`, { parse_mode: "HTML" });
          return;
        }

        const lines = [`<b>👥 Team for ${escapeHtml(managerName)}</b> (${contracts.length} members)\n`];
        for (const contract of contracts) {
          const statusEmoji = contract.status === "active" ? "🟢" : contract.status === "on_hold" ? "🟡" : "🔴";
          lines.push(`${statusEmoji} <b>${escapeHtml(contract.role)}</b> (<code>${escapeHtml(contract.agent_id)}</code>)`);
          lines.push(`   Tasks: ${contract.tasks.map((t: string) => escapeHtml(t)).join(", ")}`);
          if (contract.budget) lines.push(`   Budget: $${contract.budget}`);
          lines.push("");
        }

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /memory command — Memory statistics
    bot.command("memory", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;

      await ctx.sendChatAction("typing");
      try {
        const memoryFacade = await getMemoryFacade();
        const stats = await memoryFacade.stats();

        const lines = [`<b>🧠 Memory Statistics</b>\n`];

        let grandTotal = 0;
        const scopeEmoji: Record<string, string> = { personal: "👤", project: "📁", company: "🏢" };

        lines.push("<b>By Scope:</b>");
        for (const [scope, data] of Object.entries(stats)) {
          grandTotal += data.total;
          const emoji = scopeEmoji[scope] || "📄";
          lines.push(`  ${emoji} <b>${escapeHtml(scope)}:</b> ${data.total} entries`);
        }
        lines.push(`\n<b>Total Entries:</b> ${grandTotal}`);

        const allAgentCounts: Record<string, number> = {};
        for (const [, data] of Object.entries(stats)) {
          for (const [agentId, count] of Object.entries(data.perAgent)) {
            allAgentCounts[agentId] = (allAgentCounts[agentId] || 0) + count;
          }
        }

        if (Object.keys(allAgentCounts).length > 0) {
          lines.push("\n<b>By Agent:</b>");
          const sorted = Object.entries(allAgentCounts).sort((a, b) => b[1] - a[1]);
          for (const [agentId, count] of sorted.slice(0, 10)) {
            const staff = getStaffById(agentId);
            const agentName = staff ? `${staff.avatar} ${staff.name}` : agentId;
            lines.push(`  • ${escapeHtml(agentName)}: ${count} entries`);
          }
          if (sorted.length > 10) lines.push(`  ... and ${sorted.length - 10} more agents`);
        }

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /cron command — Scheduled tasks management
    bot.command("cron", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const chatId = ctx.chat.id.toString();
      const activeAgentId = chatAgentMap.get(chatId) || "ceo-strategic";

      await ctx.sendChatAction("typing");
      try {
        if (args.length === 0) {
          // List all scheduled tasks for active agent
          const scheduler = await getAgentScheduler();
          const tasks = await scheduler.getTasksForAgent(activeAgentId, true);

          if (tasks.length === 0) {
            await ctx.reply(`<b>⏱ No scheduled tasks for</b> <b>${escapeHtml(activeAgentId)}</b>`, { parse_mode: "HTML" });
            return;
          }

          const lines = [`<b>📋 Scheduled Tasks</b> (${tasks.length})\n`];
          for (const t of tasks) {
            const status = t.enabled ? (t.status === "active" ? "🟢" : "🟡") : "🔴";
            const nextRun = t.next_run > 0 ? new Date(t.next_run).toLocaleString() : "—";
            lines.push(`${status} <b>${escapeHtml(t.name)}</b> — ${escapeHtml(t.action)}`);
            lines.push(`   Next: ${nextRun} | Runs: ${t.run_count} | Fails: ${t.fail_count}`);
            lines.push(`   ID: <code>${escapeHtml(t.id)}</code>`);
          }
          await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
        } else if (args[0].toLowerCase() === "status") {
          const agentId = args[1] || activeAgentId;
          const scheduler = await getAgentScheduler();
          const tasks = await scheduler.getTasksForAgent(agentId);
          const active = tasks.filter(t => t.enabled && t.status === "active");
          const paused = tasks.filter(t => !t.enabled || t.status === "paused");

          const lines = [`<b>⏱ Scheduled Tasks for ${escapeHtml(agentId)}</b>\n`];
          lines.push(`Active: <b>${active.length}</b> | Paused: <b>${paused.length}</b> | Total: <b>${tasks.length}</b>`);
          await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
        } else if (args[0].toLowerCase() === "pause") {
          const taskId = args[1];
          if (!taskId) {
            await ctx.reply("Usage: /cron pause [task_id]", { parse_mode: "HTML" });
            return;
          }
          const scheduler = await getAgentScheduler();
          const result = await scheduler.pauseTask(taskId);
          if (result) {
            await ctx.reply(`<b>⏸ Task paused:</b> <code>${escapeHtml(taskId)}</code>`, { parse_mode: "HTML" });
            logger.info({ taskId }, "Cron task paused via Telegram");
          } else {
            await ctx.reply(`<b>❌ Task not found:</b> <code>${escapeHtml(taskId)}</code>`, { parse_mode: "HTML" });
          }
        } else if (args[0].toLowerCase() === "resume") {
          const taskId = args[1];
          if (!taskId) {
            await ctx.reply("Usage: /cron resume [task_id]", { parse_mode: "HTML" });
            return;
          }
          const scheduler = await getAgentScheduler();
          const result = await scheduler.resumeTask(taskId);
          if (result) {
            await ctx.reply(`<b>▶️ Task resumed:</b> <code>${escapeHtml(taskId)}</code>`, { parse_mode: "HTML" });
            logger.info({ taskId }, "Cron task resumed via Telegram");
          } else {
            await ctx.reply(`<b>❌ Task not found:</b> <code>${escapeHtml(taskId)}</code>`, { parse_mode: "HTML" });
          }
        } else {
          await ctx.reply(`<b>⏱ Scheduled Tasks Management</b>

Usage:
/cron — List all tasks
/cron status [agent] — Task counts for agent
/cron pause [task_id] — Pause a task
/cron resume [task_id] — Resume a task`, { parse_mode: "HTML" });
        }
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /meetings command — View board meetings + governance proposals
    bot.command("meetings", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;

      await ctx.sendChatAction("typing");
      try {
        const { getActiveMeeting } = await import("../organic/board-meeting.js");
        const governance = getMeetingGovernance();
        const active = getActiveMeeting();
        const proposals = governance ? await governance.getActiveProposals() : [];

        if (!active && proposals.length === 0) {
          await ctx.reply(`<b>🏛 No Active Meetings</b>

<b>Board Meeting Engine:</b> No active meetings
<b>Meeting Proposals:</b> None pending

<b>Quick Actions:</b>
• /meeting [names...] — Start multi-agent discussion
• Just ask me to "propose a board meeting" and agents will handle it`, { parse_mode: "HTML" });
          return;
        }

        const lines: string[] = [];

        if (active) {
          const statusEmoji: Record<string, string> = { scheduled: "📋", in_progress: "🏛", report_pending: "📝", delivered: "✅", approved: "👍", negated: "❌" };
          const emoji = statusEmoji[active.status] || "⚪";
          lines.push(`<b>${emoji} Active Board Meeting</b>`);
          lines.push(`ID: <code>${escapeHtml(active.id)}</code>`);
          lines.push(`Status: ${escapeHtml(active.status)}`);
          lines.push(`Turns: ${active.turns.length}`);
          if (active.objective) lines.push(`Objective: ${escapeHtml(active.objective)}`);
          lines.push("");
        }

        if (proposals.length > 0) {
          lines.push(`<b>📋 Meeting Proposals (${proposals.length})</b>\n`);
          const formatTime = (ts: number): string => {
            const d = new Date(ts);
            return d.toLocaleString();
          };

          for (const p of proposals) {
            const urgencyEmoji = p.urgency === "P1" ? "🔴" : p.urgency === "P2" ? "🟡" : "🔵";
            const statusEmoji = p.status === "voting" ? "🗳" : p.status === "scheduled" ? "📅" : "🏛";
            const yesVotes = Object.values(p.votes).filter(v => v === "yes").length;
            const noVotes = Object.values(p.votes).filter(v => v === "no").length;
            const abstainVotes = Object.values(p.votes).filter(v => v === "abstain").length;
            const deadline = p.voting_deadline ? formatTime(p.voting_deadline) : "—";

            lines.push(`${statusEmoji} <b>${urgencyEmoji} ${escapeHtml(p.title)}</b>`);
            lines.push(`ID: <code>${escapeHtml(p.id)}</code>`);
            lines.push(`Proposed by: ${escapeHtml(p.proposer)}`);
            lines.push(`<i>${escapeHtml(p.reason.slice(0, 120))}</i>`);
            lines.push(`Votes: ✅${yesVotes} ❌${noVotes} ⬜${abstainVotes} | Need: ${p.required_votes}`);
            lines.push(`Deadline: ${deadline}`);
            lines.push(`Status: ${escapeHtml(p.status)}`);
            lines.push("");
          }
        }

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /whoami command — show user identity context
    bot.command("whoami", async (ctx) => {
      try {
        if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
        const chatId = ctx.chat.id.toString();
        const sender = ctx.from;
        const firstName = escapeHtml(sender.first_name || "");
        const lastName = sender.last_name ? ` ${escapeHtml(sender.last_name)}` : "";
        const username = sender.username ? ` @${escapeHtml(sender.username)}` : "";

        const activeAgentId = chatAgentMap.get(chatId) || "ceo-strategic";
        const activeStaff = getStaffById(activeAgentId);
        const activeAgentDisplay = activeStaff
          ? `${activeStaff.avatar} ${escapeHtml(activeStaff.name)}`
          : escapeHtml(activeAgentId);

        const route = getRoute(chatId);
        const participantNames = route.participants.map(id => {
          const s = getStaffById(id);
          return s ? `${s.avatar} ${escapeHtml(s.name)}` : escapeHtml(id);
        }).join(", ");

        const timeoutFormatted = formatDowntime(route.timeoutMs);
        const inactiveMs = Date.now() - route.lastActive;
        const lastActiveStr = formatDowntime(inactiveMs) + " ago";

        const text = `<b>👤 Your Identity</b>

<b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>
<b>Sender:</b> ${firstName}${lastName}${username}
<b>Active Agent:</b> ${activeAgentDisplay}
<b>Route Mode:</b> ${escapeHtml(route.mode)}
<b>Route Participants:</b> ${participantNames}
<b>Session Timeout:</b> ${timeoutFormatted}
<b>Last Active:</b> ${lastActiveStr}`;

        await ctx.reply(text, { parse_mode: "HTML" });
      } catch (err: any) {
        logger.error({ err: err.message }, "telegram.command.whoami.error");
        await ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
      }
    });

    // /commands command — paginated command browser
    bot.command("commands", async (ctx) => {
      try {
        if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
        const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
        let page = parseInt(args[0], 10) || 1;
        const totalPages = Math.ceil(OPERANT_COMMANDS.length / COMMANDS_PER_PAGE);
        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;

        await sendCommandsPage(ctx, page, totalPages);
      } catch (err: any) {
        logger.error({ err: err.message }, "telegram.command.commands.error");
        await ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
      }
    });

    // /reset command — standalone session reset
    bot.command("reset", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const chatId = ctx.chat.id.toString();

      const sessionRegistry = getSessionRegistry();
      let agentId: string;

      if (args.length > 0) {
        agentId = args[0];
      } else {
        agentId = chatAgentMap.get(chatId) || "ceo-strategic";
      }

      const staff = getStaffById(agentId);
      const agentDisplay = staff ? `${staff.avatar} ${escapeHtml(staff.name)}` : escapeHtml(agentId);

      await sessionRegistry.invalidate(agentId, chatId);

      await ctx.reply(`<b>✅ Session cleared for</b> <b>${agentDisplay}</b>

⚠️ LanceDB memory embeddings are preserved. Only conversation context was reset.`, { parse_mode: "HTML" });
      logger.info({ chatId, agentId }, "Session reset via /reset command");
    });

    // /status [agent] — filtered status for a single agent
    bot.command("status", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const chatId = ctx.chat.id.toString();

      // No arg — behave exactly like the current /status (show all agents)
      if (args.length === 0) {
        await ctx.sendChatAction("typing");
        try {
          const activeAgentId = chatAgentMap.get(chatId) || "ceo-strategic";
          const activeStaff = getStaffById(activeAgentId);
          const activeAgentDisplay = activeStaff
            ? `${activeStaff.avatar} ${activeStaff.name}`
            : activeAgentId;

          const runtime = getNativeRuntime();
          const sessions = runtime.listSessions();

          const health = getAgentHealthRegistry();
          const teamStatus = health.getTeamStatus();
          const statusEmoji: Record<string, string> = { healthy: "🟢", degraded: "🟡", silent: "⚫", error: "🔴" };
          const agentLines = teamStatus
            .map(h => {
              const emoji = statusEmoji[h.status] || "⚪";
              const activeMarker = h.agentId === activeAgentId ? " ← active" : "";
              return `${emoji} ${h.avatar} ${h.name} — ${h.status}${activeMarker}`;
            })
            .join("\n");

          // Check actual subsystem states
          let kanbanStatus = "⚪ Unknown";
          try {
            const ceoBoard = await rt.ctx.kanban.getBoard("ceo-strategic");
            kanbanStatus = ceoBoard ? "🟢 Active" : "🔴 No boards";
          } catch { kanbanStatus = "🔴 Error"; }

          let memoryStatus = "⚪ Unknown";
          let memoryCount = 0;
          try {
            const memStats = await (await getMemoryFacade()).stats();
            memoryCount = Object.values(memStats).reduce((sum: number, s: any) => sum + s.total, 0);
            memoryStatus = memoryCount > 0 ? `🟢 Active (${memoryCount} entries)` : "🟡 Empty";
          } catch { memoryStatus = "🔴 Error"; }

          await ctx.reply(`<b>✅ Operant System Status</b>

<b>Active agent:</b> ${activeAgentDisplay}

<b>System:</b>
• MCP Server: Running
• Core Staff: ${teamStatus.length} agents
• Kanban: ${kanbanStatus}
• Memory: ${memoryStatus}
• Telegram: Online
• Native Runtime: Healthy (${sessions.length} session(s) active)

<b>Team health:</b>
${agentLines}`, { parse_mode: "HTML" });
        } catch (err: any) {
          await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
        }
        return;
      }

      // With agent arg — show focused status for a single agent
      await ctx.sendChatAction("typing");
      try {
        const agentArg = args[0].toLowerCase();

        // Look up agent by ID or name (case-insensitive match against core staff)
        let agentId: string | undefined;
        for (const staffId of getCoreStaffIds()) {
          if (staffId.toLowerCase() === agentArg) {
            agentId = staffId;
            break;
          }
          const staff = getStaffById(staffId);
          if (staff && staff.name.toLowerCase() === agentArg) {
            agentId = staffId;
            break;
          }
        }

        if (!agentId) {
          await ctx.reply(`<b>❌ Agent not found:</b> <code>${escapeHtml(args[0])}</code>\n\nUse /staff to see available agents.`, { parse_mode: "HTML" });
          return;
        }

        const staff = getStaffById(agentId);
        const agentName = staff ? escapeHtml(staff.name) : escapeHtml(agentId);
        const title = staff ? escapeHtml(staff.title) : "";
        const avatar = staff?.avatar || "🤖";

        // Health status
        const health = getAgentHealthRegistry();
        const healthData = health.getStatus(agentId);
        const statusEmoji: Record<string, string> = { healthy: "🟢", degraded: "🟡", silent: "⚫", error: "🔴" };
        const healthStatus = healthData ? (statusEmoji[healthData.status] || "⚪") + ` ${healthData.status}` : "⚪ unknown";

        // Kanban board summary
        let kanbanSummary = "—";
        try {
          const board = await rt.ctx.kanban.getBoard(agentId);
          if (board) {
            kanbanSummary = board.columns
              .filter(col => col.cards.length > 0)
              .map(col => `${escapeHtml(col.name)}: ${col.cards.length}`)
              .join(", ");
            if (!kanbanSummary) kanbanSummary = "empty";
          }
        } catch { kanbanSummary = "error"; }

        // Active session info
        const runtime = getNativeRuntime();
        const allSessions = runtime.listSessions();
        const agentSession = allSessions.find(s => s.agentId === agentId);
        const sessionInfo = agentSession
          ? `<code>${escapeHtml(agentSession.sessionId)}</code> (${agentSession.messages} messages)`
          : "none active";

        // Unread message count
        let unreadCount = 0;
        try {
          const messaging = await getMessagingSystem();
          unreadCount = await messaging.getUnreadCount(agentId);
        } catch (err) {
          logger.warn({ agentId, err: (err as Error).message }, "Failed to get unread message count for /status");
          unreadCount = -1;
        }

        // Scheduled tasks
        let activeTasks = 0;
        let pausedTasks = 0;
        try {
          const scheduler = await getAgentScheduler();
          const tasks = await scheduler.getTasksForAgent(agentId, true);
          activeTasks = tasks.filter(t => t.enabled && t.status === "active").length;
          pausedTasks = tasks.filter(t => !t.enabled || t.status === "paused").length;
        } catch { /* ignore */ }

        const text = `<b>${avatar} ${agentName} — Status</b>
<i>${title}</i>

<b>Health:</b> ${healthStatus}
<b>Kanban:</b> ${kanbanSummary}
<b>Session:</b> ${sessionInfo}
<b>Unread Messages:</b> ${unreadCount}
<b>Scheduled Tasks:</b> ${activeTasks} active, ${pausedTasks} paused`;

        await ctx.reply(text, { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /restart — Graceful restart of the Operant daemon
    bot.command("restart", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;

      try {
        // Flush state and record shutdown BEFORE replying (process may exit before reply sends)
        flushChatState();
        recordShutdownTimestamp();

        // Reply and wait for it to be sent
        await ctx.reply(`<b>🔄 Restarting Operant...</b>

Saving state and restarting. I'll be back in a moment.`, { parse_mode: "HTML" });

        // Give Telegram a moment to deliver the message
        await new Promise(resolve => setTimeout(resolve, 500));

        // Trigger graceful shutdown via SIGINT (same as systemctl restart)
        process.kill(process.pid, "SIGINT");
      } catch (err: any) {
        logger.error({ err: err.message }, "/restart failed");
        await ctx.reply(`<b>❌ Restart failed:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /compact — Trigger session context compaction for the active agent
    bot.command("compact", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const chatId = ctx.chat.id.toString();
      const agentId = chatAgentMap.get(chatId) || "ceo-strategic";

      await ctx.sendChatAction("typing");

      try {
        const staff = getStaffById(agentId);
        const agentName = staff ? `${staff.avatar} ${escapeHtml(staff.name)}` : escapeHtml(agentId);

        const runtime = getNativeRuntime();
        const sessions = runtime.listSessions();
        const agentSession = sessions.find(s => s.agent_id === agentId || s.agentId === agentId);

        if (!agentSession) {
          await ctx.reply(`<b>ℹ️ No active session to compact</b>

Send a message first to create a session, then try again.`, { parse_mode: "HTML" });
          return;
        }

        const sessionId = agentSession.session_id || agentSession.sessionId;
        await runtime.compactSession(sessionId);

        await ctx.reply(`<b>🗜️ Session Compacted</b>

<b>Agent:</b> ${agentName}
<b>Session:</b> <code>${escapeHtml(sessionId)}</code>
Context has been compacted. Conversation history preserved, redundant tokens pruned.`, { parse_mode: "HTML" });

        logger.info({ chatId, agentId, sessionId }, "Session compacted via Telegram");
      } catch (err: any) {
        await ctx.reply(`<b>❌ Compaction failed:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
        logger.error({ chatId, agentId, err: err.message }, "/compact failed");
      }
    });

    // /new — Start a completely fresh session
    bot.command("new", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const chatId = ctx.chat.id.toString();
      const agentId = chatAgentMap.get(chatId) || "ceo-strategic";

      try {
        const staff = getStaffById(agentId);
        const agentName = staff ? `${staff.avatar} ${escapeHtml(staff.name)}` : escapeHtml(agentId);

        const sessionRegistry = getSessionRegistry();
        await sessionRegistry.invalidate(agentId, chatId);

        await ctx.reply(`<b>🆕 New Session Started</b>

<b>Agent:</b> ${agentName}
Previous session cleared. Ready for a fresh conversation.`, { parse_mode: "HTML" });

        logger.info({ chatId, agentId }, "New session started via /new");
      } catch (err: any) {
        await ctx.reply(`<b>❌ Failed to start new session:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
        logger.error({ chatId, agentId, err: err.message }, "/new failed");
      }
    });

    // /stop — Abort the current agent run mid-execution
    bot.command("stop", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const chatId = ctx.chat.id.toString();
      const agentId = chatAgentMap.get(chatId) || "ceo-strategic";

      try {
        const staff = getStaffById(agentId);
        const agentName = staff ? `${staff.avatar} ${escapeHtml(staff.name)}` : escapeHtml(agentId);

        const runtime = getNativeRuntime();
        const sessions = runtime.listSessions();
        const agentSession = sessions.find(s => s.agent_id === agentId || s.agentId === agentId);

        if (!agentSession) {
          await ctx.reply(`<b>ℹ️ No active run to stop</b>

The agent isn't currently processing a request.`, { parse_mode: "HTML" });
          return;
        }

        const sessionId = agentSession.session_id || agentSession.sessionId;
        // Clear the session history to effectively stop any ongoing context
        runtime.clearSession(sessionId);

        await ctx.reply(`<b>🛑 Run Stopped</b>

<b>Agent:</b> ${agentName}
Current execution aborted. Send a new message to continue.`, { parse_mode: "HTML" });

        logger.info({ chatId, agentId, sessionId }, "Run stopped via /stop");
      } catch (err: any) {
        await ctx.reply(`<b>❌ Stop failed:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
        logger.error({ chatId, agentId, err: err.message }, "/stop failed");
      }
    });

    // ── Phase 3: Runtime & Visibility Commands ────────────────────────

    // /tasks — Show what agents are working on right now
    bot.command("tasks", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const chatId = ctx.chat.id.toString();
      const activeAgentId = chatAgentMap.get(chatId) || "ceo-strategic";

      await ctx.sendChatAction("typing");
      try {
        const lines: string[] = [];
        lines.push(`<b>📊 Active Tasks</b>\n`);

        // 1. Active Agent Sessions
        const runtime = getNativeRuntime();
        const sessions = runtime.listSessions();
        const agentSessions = sessions.filter(s => s.agentId === activeAgentId || (s as any).agent_id === activeAgentId);

        lines.push(`<b>Agent Sessions:</b>`);
        if (agentSessions.length === 0) {
          lines.push(`  <i>No active sessions</i>`);
        } else {
          for (const s of agentSessions) {
            const sid = s.sessionId || (s as any).session_id || "unknown";
            const msgs = s.messages ?? (s as any).messages ?? 0;
            const tokens = s.tokens ?? (s as any).tokens ?? 0;
            lines.push(`  • <code>${escapeHtml(sid)}</code> — ${msgs} msgs, ${tokens} tokens`);
          }
        }

        // 2. Scheduled Tasks
        const scheduler = await getAgentScheduler();
        const scheduledTasks = await scheduler.getTasksForAgent(activeAgentId, true);
        const activeTasks = scheduledTasks.filter(t => t.enabled && t.status === "active");

        lines.push(`\n<b>Scheduled Tasks (${activeTasks.length} active):</b>`);
        if (activeTasks.length === 0) {
          lines.push(`  <i>No scheduled tasks</i>`);
        } else {
          for (const t of activeTasks) {
            const lastStatus = t.fail_count > 0 ? `⚠️ ${t.fail_count} fails` : `✅ ${t.run_count} runs`;
            const scheduleStr = t.cron_expression
              ? escapeHtml(t.cron_expression)
              : t.interval_seconds
                ? `every ${t.interval_seconds}s`
                : "once";
            lines.push(`  • <b>${escapeHtml(t.name)}</b> — ${scheduleStr} — Last: ${lastStatus}`);
          }
        }

        // 3. Message Threads
        const messaging = await getMessagingSystem();
        const context = await messaging.getActiveContext(activeAgentId);
        const unreadCount = context.unread_count;
        const pendingCount = context.pending_responses.length;

        lines.push(`\n<b>Message Threads:</b>`);
        if (unreadCount === 0 && pendingCount === 0) {
          lines.push(`  <i>All caught up</i>`);
        } else {
          lines.push(`  • ${unreadCount} unread, ${pendingCount} pending responses`);
        }

        // 4. Kanban Active Cards
        const board = await rt.ctx.kanban.getBoard(activeAgentId);
        lines.push(`\n<b>Kanban — In Progress:</b>`);
        if (!board) {
          lines.push(`  <i>No board found</i>`);
        } else {
          const inProgressCards: string[] = [];
          for (const col of board.columns) {
            const colName = col.name.toLowerCase();
            if (colName.includes("progress") || colName.includes("doing") || colName.includes("active") || colName.includes("wip")) {
              for (const card of col.cards) {
                const priorityEmoji = card.priority === "P1" ? "🔴" : card.priority === "P2" ? "🟡" : card.priority === "P3" ? "🔵" : "⚪";
                inProgressCards.push(`${priorityEmoji} ${escapeHtml(card.title)}`);
              }
            }
          }
          if (inProgressCards.length === 0) {
            lines.push(`  <i>No active cards</i>`);
          } else {
            lines.push(`  (${inProgressCards.length})`);
            for (const card of inProgressCards.slice(0, 8)) {
              lines.push(`  • ${card}`);
            }
            if (inProgressCards.length > 8) {
              lines.push(`  ... and ${inProgressCards.length - 8} more`);
            }
          }
        }

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /context — Show what the active agent currently knows
    bot.command("context", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const chatId = ctx.chat.id.toString();
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const agentId = args[0] || chatAgentMap.get(chatId) || "ceo-strategic";

      await ctx.sendChatAction("typing");
      try {
        const staff = getStaffById(agentId);
        const agentName = staff ? `${staff.avatar} ${escapeHtml(staff.name)}` : escapeHtml(agentId);

        // Wake context
        let wakeContextStr = "";
        try {
          const wc = await contextManager.getWakeContext(agentId);
          if (wc) {
            const formatted = await contextManager.formatWakeContext(wc);
            // Truncate to first 500 chars if longer
            wakeContextStr = formatted.length > 500 ? formatted.slice(0, 500) + "\n…(truncated)" : formatted;
          }
        } catch {
          // Wake context unavailable
        }

        // Session info
        const runtime = getNativeRuntime();
        const sessions = runtime.listSessions();
        const agentSession = sessions.find(s => s.agentId === agentId || (s as any).agent_id === agentId);

        const lines: string[] = [];
        lines.push(`<b>🧠 Context for ${agentName}</b>\n`);

        lines.push(`<b>Wake Context:</b>`);
        if (wakeContextStr) {
          lines.push(`<pre>${escapeHtml(wakeContextStr)}</pre>`);
        } else {
          lines.push(`<i>No wake context configured</i>`);
        }

        lines.push(`\n<b>Session:</b> ${agentSession ? `<code>${escapeHtml(agentSession.sessionId || (agentSession as any).session_id)}</code>` : "<i>No active session</i>"}`);
        lines.push(`<b>Messages in session:</b> ${agentSession ? (agentSession.messages ?? (agentSession as any).messages ?? 0) : 0}`);
        lines.push(`<b>Tokens used:</b> ${agentSession ? (agentSession.tokens ?? (agentSession as any).tokens ?? 0) : 0}`);

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /model — Show current model configuration
    bot.command("model", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];

      await ctx.sendChatAction("typing");
      try {
        const fullCfg = getConfig();

        // /model set [name] — read-only instructions
        if (args[0]?.toLowerCase() === "set") {
          const modelName = args.slice(1).join(" ");
          if (!modelName) {
            await ctx.reply(`<b>🤖 Switch Model</b>

Usage: /model set [model_name]

<i>Note: Model switching requires editing the config file.</i>

<b>To change the model:</b>
1. Run: <code>operant configure --section llm</code>
2. Select your desired model
3. Or edit <code>~/.operant/config.json</code> directly

<b>Environment override:</b>
Set <code>AGENT_LLM_MODEL</code> in your .env file.`, { parse_mode: "HTML" });
            return;
          }
          await ctx.reply(`<b>🤖 Model Switch Requested</b>

Requested: <code>${escapeHtml(modelName)}</code>

<i>Model switching requires a config change.</i>

<b>To apply:</b>
1. Run: <code>operant configure --section llm</code>
2. Or set <code>AGENT_LLM_MODEL=${escapeHtml(modelName)}</code> in .env
3. Restart: <code>/restart</code>`, { parse_mode: "HTML" });
          return;
        }

        // /model list — show available models
        if (args[0]?.toLowerCase() === "list") {
          const llm = fullCfg.llm;
          const modelsSection = fullCfg.models;
          const providers = fullCfg.providers;

          const lines: string[] = [];
          lines.push(`<b>📋 Available Models</b>\n`);

          // Primary model
          const primaryModel = modelsSection?.primary ?? llm?.model ?? "not configured";
          lines.push(`<b>Primary:</b> <code>${escapeHtml(primaryModel)}</code>`);

          // Fallbacks
          const fallbacks = modelsSection?.fallbacks ?? [];
          if (fallbacks.length > 0) {
            lines.push(`\n<b>Fallbacks:</b>`);
            fallbacks.forEach((fb: string, i: number) => {
              lines.push(`  ${i + 1}. <code>${escapeHtml(fb)}</code>`);
            });
          } else {
            lines.push(`\n<i>No fallback models configured</i>`);
          }

          // Provider details if available
          if (providers && Object.keys(providers).length > 0) {
            lines.push(`\n<b>Providers:</b>`);
            for (const [name, provider] of Object.entries(providers)) {
              const p = provider as any;
              const modelCount = p.models?.length ?? 0;
              lines.push(`  • <b>${escapeHtml(name)}</b> — ${modelCount} model(s)`);
              if (p.models && p.models.length > 0) {
                for (const m of p.models.slice(0, 5)) {
                  lines.push(`    <code>${escapeHtml(m.id)}</code>`);
                }
                if (p.models.length > 5) {
                  lines.push(`    ... and ${p.models.length - 5} more`);
                }
              }
            }
          }

          await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
          return;
        }

        // /model (no args) — show current model settings
        const llm = fullCfg.llm;
        const modelsSection = fullCfg.models;

        const provider = llm?.provider ?? "not configured";
        const model = modelsSection?.primary ?? llm?.model ?? "not configured";
        const baseUrl = llm?.baseUrl ?? "—";
        const fallbacks = modelsSection?.fallbacks ?? [];

        const lines: string[] = [];
        lines.push(`<b>🤖 Model Configuration</b>\n`);
        lines.push(`<b>Provider:</b> <code>${escapeHtml(provider)}</code>`);
        lines.push(`<b>Model:</b> <code>${escapeHtml(model)}</code>`);
        if (baseUrl !== "—") {
          lines.push(`<b>Base URL:</b> <code>${escapeHtml(baseUrl)}</code>`);
        }
        lines.push(`<b>Max Tokens:</b> ${llm?.maxTokens ?? "—"}`);
        lines.push(`<b>Temperature:</b> ${llm?.temperature ?? "—"}`);

        if (fallbacks.length > 0) {
          lines.push(`\n<b>Fallback Chain:</b>`);
          fallbacks.forEach((fb: string, i: number) => {
            lines.push(`  ${i + 1}. <code>${escapeHtml(fb)}</code>`);
          });
        } else {
          lines.push(`\n<b>Fallback Chain:</b> <i>None configured</i>`);
        }

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // ── Phase 4: Advanced Operations Commands ─────────────────────────

    // /delegate — One-shot task delegation to a specific agent
    bot.command("delegate", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];

      if (args.length < 2) {
        await ctx.reply(`<b>📨 Delegate a Task</b>

Usage: /delegate [agent_id_or_name] [task description...]

Example:
<code>/delegate cfo Review Q3 budget and flag any concerns</code>`, { parse_mode: "HTML" });
        return;
      }

      await ctx.sendChatAction("typing");

      try {
        const agentArg = args[0].toLowerCase();
        const taskText = args.slice(1).join(" ");

        // Look up agent by ID or name
        let agentId: string | undefined;
        for (const staffId of getCoreStaffIds()) {
          if (staffId.toLowerCase() === agentArg) {
            agentId = staffId;
            break;
          }
          const staff = getStaffById(staffId);
          if (staff && staff.name.toLowerCase() === agentArg) {
            agentId = staffId;
            break;
          }
        }

        if (!agentId) {
          const agentList = getCoreStaffIds()
            .map(id => {
              const s = getStaffById(id);
              return s ? `<code>${escapeHtml(id)}</code> — ${s.avatar} ${escapeHtml(s.name)}` : `<code>${escapeHtml(id)}</code>`;
            })
            .join("\n");
          await ctx.reply(`<b>❌ Agent not found:</b> <code>${escapeHtml(args[0])}</code>\n\n<b>Available agents:</b>\n${agentList}`, { parse_mode: "HTML" });
          return;
        }

        const staff = getStaffById(agentId);
        const agentName = staff ? escapeHtml(staff.name) : escapeHtml(agentId);
        const avatar = staff?.avatar || "🤖";

        // Send task via native runtime
        const runtime = getNativeRuntime();
        const nativeAgentId = AGENT_ID_MAP[agentId] || agentId;
        let agentReply = "(no reply)";

        try {
          const sid = await runtime.getOrCreateRuntimeSession(nativeAgentId, { mode: "message", contextId: ctx.chat.id.toString() });
          const result = await runtime.sendMessage(sid, taskText, nativeAgentId);
          agentReply = result.text || "(empty response)";
        } catch (err: any) {
          logger.error({ agentId, err: err.message }, "Delegate: runtime sendMessage failed");
          agentReply = `(error: ${escapeHtml(err.message)})`;
        }

        const lines: string[] = [];
        lines.push(`<b>📨 Delegated to ${avatar} ${agentName}</b>\n`);
        lines.push(`<b>Task:</b> ${escapeHtml(taskText)}\n`);
        lines.push(`<b>Response:</b>\n${escapeHtml(agentReply)}`);

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
        logger.info({ agentId, taskLength: taskText.length }, "Task delegated via /delegate");
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /standup — Daily roll call showing what each agent is working on
    bot.command("standup", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;

      await ctx.sendChatAction("typing");

      try {
        const health = getAgentHealthRegistry();
        const teamStatus = health.getTeamStatus();
        const statusEmoji: Record<string, string> = { healthy: "🟢", degraded: "🟡", silent: "⚫", error: "🔴" };

        const messaging = await getMessagingSystem();
        const scheduler = await getAgentScheduler();

        const lines: string[] = [];
        lines.push(`<b>📢 Daily Standup</b>\n`);

        let healthyCount = 0;
        let silentCount = 0;
        let issueCount = 0;

        for (const entry of teamStatus) {
          const emoji = statusEmoji[entry.status] || "⚪";
          const agentId = entry.agentId;

          // Kanban cards
          let kanbanInfo = "—";
          try {
            const board = await rt.ctx.kanban.getBoard(agentId);
            if (board) {
              const totalCards = board.columns.reduce((sum, col) => sum + col.cards.length, 0);
              const activeCols = board.columns.filter(col => col.cards.length > 0).length;
              kanbanInfo = `${totalCards} cards across ${activeCols} columns`;
            }
          } catch {
            kanbanInfo = "error";
          }

          // Unread messages
          let msgInfo = "—";
          try {
            const context = await messaging.getActiveContext(agentId);
            msgInfo = `${context.unread_count} unread`;
          } catch {
            msgInfo = "error";
          }

          // Scheduled tasks
          let taskInfo = "—";
          try {
            const tasks = await scheduler.getTasksForAgent(agentId, true);
            const activeTasks = tasks.filter(t => t.enabled && t.status === "active");
            taskInfo = `${activeTasks.length} active scheduled`;
          } catch {
            taskInfo = "error";
          }

          lines.push(`<b>${entry.avatar} ${escapeHtml(entry.name)}</b>`);
          lines.push(`Status: ${emoji} ${entry.status}`);
          lines.push(`Kanban: ${kanbanInfo}`);
          lines.push(`Messages: ${msgInfo}`);
          lines.push(`Tasks: ${taskInfo}`);
          lines.push("");

          // Tally summary
          if (entry.status === "healthy") healthyCount++;
          else if (entry.status === "silent") silentCount++;
          else issueCount++;
        }

        lines.push(`<b>Summary:</b> ${healthyCount} agents healthy, ${silentCount} silent, ${issueCount} with issues`);

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /escalate — Manually escalate a message to the CEO
    bot.command("escalate", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];

      if (args.length === 0) {
        await ctx.reply(`<b>🚨 Escalate to CEO</b>

Usage: /escalate [message]

Example:
<code>/escalate Budget approval needed urgently for Q3 campaign</code>

Escalates the message to the CEO with P1 priority.`, { parse_mode: "HTML" });
        return;
      }

      await ctx.sendChatAction("typing");

      try {
        const chatId = ctx.chat.id.toString();
        const activeAgentId = chatAgentMap.get(chatId) || "ceo-strategic";
        const escalationMessage = args.join(" ");

        const activeStaff = getStaffById(activeAgentId);
        const activeAgentName = activeStaff ? `${activeStaff.avatar} ${escapeHtml(activeStaff.name)}` : escapeHtml(activeAgentId);

        // Send via messaging system with P1 priority
        const messaging = await getMessagingSystem();
        await messaging.send({
          from: activeAgentId,
          to: "ceo-strategic",
          content: escalationMessage,
          priority: "P1",
          requires_response: true
        });

        // Also send directly to CEO via runtime for immediate attention
        const runtime = getNativeRuntime();
        const ceoNativeId = AGENT_ID_MAP["ceo-strategic"] || "ceo-strategic";
        try {
          const ceoSid = await runtime.getOrCreateRuntimeSession(ceoNativeId, { mode: "message", contextId: chatId });
          await runtime.sendMessage(ceoSid, `🚨 ESCALATION from ${activeAgentName}:\n\n${escalationMessage}`, ceoNativeId);
        } catch (err: any) {
          logger.warn({ err: err.message }, "Escalation: direct CEO runtime notify failed — messaging send succeeded");
        }

        const lines: string[] = [];
        lines.push(`<b>🚨 Escalated to CEO</b>\n`);
        lines.push(`<b>From:</b> ${activeAgentName}`);
        lines.push(`<b>Message:</b> ${escapeHtml(escalationMessage)}\n`);
        lines.push(`The CEO has been notified and will respond.`);

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
        logger.info({ from: activeAgentId, messageLength: escalationMessage.length }, "Manual escalation to CEO");
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // /priority — Send a message with explicit priority to the active agent
    bot.command("priority", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];

      if (args.length < 2) {
        await ctx.reply(`<b>⚡ Priority Message</b>

Usage: /priority [P1|P2|P3|P4] [message...]

Priority levels:
<b>P1</b> — Critical, requires immediate response
<b>P2</b> — High, response within the hour
<b>P3</b> — Normal, regular response
<b>P4</b> — Low, background task

Example:
<code>/priority P1 Server is down, need immediate action</code>`, { parse_mode: "HTML" });
        return;
      }

      const priorityArg = args[0].toUpperCase();
      if (!["P1", "P2", "P3", "P4"].includes(priorityArg)) {
        await ctx.reply(`<b>❌ Invalid priority:</b> <code>${escapeHtml(args[0])}</code>\n\nMust be one of: <b>P1</b>, <b>P2</b>, <b>P3</b>, <b>P4</b>`, { parse_mode: "HTML" });
        return;
      }

      await ctx.sendChatAction("typing");

      try {
        const chatId = ctx.chat.id.toString();
        const activeAgentId = chatAgentMap.get(chatId) || "ceo-strategic";
        const messageText = args.slice(1).join(" ");

        const staff = getStaffById(activeAgentId);
        const agentName = staff ? `${staff.avatar} ${escapeHtml(staff.name)}` : escapeHtml(activeAgentId);

        const priorityDescriptions: Record<string, string> = {
          P1: "🔴 Critical — immediate response",
          P2: "🟡 High — response within the hour",
          P3: "🔵 Normal — regular response",
          P4: "⚪ Low — background task"
        };

        // Send via messaging system with explicit priority
        const messaging = await getMessagingSystem();
        await messaging.send({
          from: "user",
          to: activeAgentId,
          content: messageText,
          priority: priorityArg as any,
          requires_response: priorityArg === "P1" || priorityArg === "P2"
        });

        // Also send directly to agent runtime
        const runtime = getNativeRuntime();
        const nativeAgentId = AGENT_ID_MAP[activeAgentId] || activeAgentId;
        let agentReply = "(no reply)";

        try {
          const sid = await runtime.getOrCreateRuntimeSession(nativeAgentId, { mode: "message", contextId: chatId });
          const result = await runtime.sendMessage(sid, messageText, nativeAgentId);
          agentReply = result.text || "(empty response)";
        } catch (err: any) {
          logger.error({ agentId: activeAgentId, err: err.message }, "Priority: runtime sendMessage failed");
          agentReply = `(messaging queued, runtime error: ${escapeHtml(err.message)})`;
        }

        const lines: string[] = [];
        lines.push(`<b>⚡ Priority Message (${escapeHtml(priorityArg)})</b>\n`);
        lines.push(`<b>To:</b> ${agentName}`);
        lines.push(`<b>Priority:</b> ${priorityDescriptions[priorityArg]}`);
        lines.push(`<b>Message:</b> ${escapeHtml(messageText)}\n`);
        lines.push(`<b>Response:</b>\n${escapeHtml(agentReply)}`);

        await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
        logger.info({ agentId: activeAgentId, priority: priorityArg, messageLength: messageText.length }, "Priority message sent");
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // Media messages (documents, photos, videos, audio, voice, stickers, animations)
    bot.on(["document", "photo", "video", "video_note", "audio", "voice", "animation", "sticker"], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      if (chatId !== cfg.telegramChatId) return;

      const release = await chatMutex.acquire(chatId);
      try {
        logger.info({ chatId }, "Media message received");
        await ctx.sendChatAction("typing");

        let typingInterval: ReturnType<typeof setInterval> | undefined;
        try {
          // Import media pipeline
          const { detectMedia, downloadTelegramFile, buildMediaContext, resolveMediaPlaceholder } = await import("./telegram-media.js");

          // Detect media
          const detected = detectMedia(ctx);
          if (!detected.hasMedia) return;

          logger.info({ mediaType: detected.mediaType, mediaCount: detected.mediaCount, caption: detected.caption }, "Media detected");

          // Download media
          const maxSizeBytes = ((cfg as any).media?.maxSizeMB ?? 100) * 1024 * 1024;
          const media = await downloadTelegramFile(ctx, maxSizeBytes);
          if (!media) {
            await ctx.reply("⚠️ Could not download the file. It may be too large or unavailable.", { parse_mode: "HTML" });
            return;
          }

          logger.info({ path: media.path, contentType: media.contentType, size: media.fileSize }, "Media downloaded");

          // Try to parse documents for text
          let parsedContent = "";
          if (detected.mediaType === "document" && media.path) {
            try {
              const { createDocumentParseTool } = await import("../runtime/tools/document-parse.js");
              const docTool = createDocumentParseTool();
              if (docTool) {
                const result = await docTool.execute("", { file_path: media.path, max_length: 50000 });
                parsedContent = result.content?.[0]?.text ?? "";
              }
            } catch (e: any) {
              logger.warn({ err: e.message }, "Document parsing failed — will send as file reference");
            }
          }

          // Try to transcribe audio/voice
          let transcript = "";
          if ((detected.mediaType === "audio" || detected.mediaType === "voice") && media.path) {
            try {
              const { createAudioTranscribeTool } = await import("../runtime/tools/audio-transcribe.js");
              const audioTool = createAudioTranscribeTool();
              if (audioTool) {
                const result = await audioTool.execute("", { file_path: media.path });
                transcript = result.content?.[0]?.text ?? "";
              } else {
                transcript = "[Audio transcription not available — apex not configured]";
              }
            } catch (e: any) {
              logger.warn({ err: e.message }, "Audio transcription failed");
              transcript = `[Audio transcription failed: ${e.message}]`;
            }
          }

          // Build media context for agent
          const mediaSection = buildMediaContext([media], detected.caption);

          // If it's a document and we parsed it, append the content
          const fullMediaContext = parsedContent
            ? `${mediaSection}\n\n📄 Document Content:\n${parsedContent}`
            : transcript && !transcript.startsWith("[")
              ? `${mediaSection}\n\n🎤 Transcription:\n${transcript}`
              : transcript
                ? `${mediaSection}\n\n⚠️ ${transcript}`
                : mediaSection;

          // Route to agents — same routing logic as text handler
          let route = getRoute(chatId);
          if (Date.now() - route.lastActive > route.timeoutMs && !boardMeetingActive) {
            route = { participants: ["ceo-strategic"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs };
          }
          setRoute(chatId, route);

          const runtime = getNativeRuntime();

          // Keep typing indicator active during processing
          typingInterval = setInterval(() => {
            ctx.sendChatAction("typing").catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "sendChatAction failed"));
          }, 5000);

          try {
            // Fan-out to all participants concurrently
            const replies = await Promise.allSettled(route.participants.map(async (agentId) => {
              // Wake context per agent
              let wakeCtx = "";
              try {
                const wc = await contextManager.getWakeContext(agentId);
                wakeCtx = await contextManager.formatWakeContext(wc);
              } catch (e) {
                logger.warn({ err: e }, "Failed to build wake context");
                wakeCtx = "[No context available]";
              }

              // Get persistent session via registry
              try {
                await sessionRegistry.getOrCreate(agentId, { chatId });
              } catch (e: any) {
                logger.warn({ agentId, err: e.message }, "sessionRegistry.getOrCreate failed");
              }

              // Build delta with media context
              const delta = [
                fullMediaContext,
                detected.caption ? `[Caption: ${detected.caption}]` : "",
                `[Media File: ${media.fileName || media.path}]`,
                `---`,
                `[User sent a media file. Process it using your available tools and respond appropriately.]`,
              ].filter(Boolean).join('\n');

              // Send with native agent identity
              const nativeAgentId = AGENT_ID_MAP[agentId] || agentId;
              let reply = "(no reply)";
              let sid: string | undefined;
              try {
                sid = await runtime.getOrCreateRuntimeSession(nativeAgentId, { mode: "message", contextId: ctx.chat.id.toString() });
                logger.info({ agentId, nativeAgentId, sessionId: sid }, "Sending media delta to native runtime...");
                const result = await runtime.sendMessage(sid, delta, nativeAgentId);
                logger.info({ agentId, textLength: result.text?.length, tokens: result.tokens }, "Native runtime response received");
                reply = result.text || "(empty response)";
              } catch (err: any) {
                logger.error({ agentId, err: err.message }, "Native runtime message failed");
                reply = `(error contacting agent: ${err.message})`;
              }

              try {
                if (sid) await sessionRegistry.touch(sid);
              } catch (e: any) {
                logger.warn({ agentId, err: e.message }, "session touch failed");
              }

              const prefix = getStaffById(agentId)?.avatar ? `${getStaffById(agentId)?.avatar} ${getStaffById(agentId)?.name}` : agentId;
              return `${prefix}:\n${reply}`;
            }));

            // Clear typing indicator
            clearInterval(typingInterval);

            const successful = replies.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
            const failed = replies.filter(r => r.status === "rejected");

            if (failed.length > 0) {
              for (const f of failed) {
                const err = (f as PromiseRejectedResult).reason;
                logger.error({ err: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, "Agent response rejected");
              }
              logger.warn({ failed: failed.length, total: replies.length }, "Partial agent response failure");
            }
            if (successful.length === 0) {
              await ctx.reply("❌ No agents could process this file.", { parse_mode: "HTML" });
              return;
            }

            const combined = successful.map(r => r.value).join("\n\n");
            logger.info({ textLength: combined.length, agentsOk: successful.length, agentsFailed: failed.length }, "Sending reply to Telegram...");

            // Convert markdown to HTML and send with smart chunking
            const html = markdownToTelegramHtml(combined);
            await sendTelegramHtmlChunks(ctx, html, combined);
            logger.info("Media reply sent successfully");
          } catch (err: any) {
            clearInterval(typingInterval);
            logger.error({ err: err.message }, "Failed to process media message");
            const safeMsg = err.message?.length < 100 && !err.message?.includes("ECONN") && !err.message?.includes("ETIMEDOUT") && !err.message?.includes("ENOENT")
              ? "A processing error occurred"
              : "A processing error occurred";
            await ctx.reply(`❌ ${safeMsg}\n\nPlease try again or use /help for commands.`);
          }
        } catch (err: any) {
          clearInterval(typingInterval);
          logger.error({ err: err.message }, "Media processing failed");
          await ctx.reply("❌ Failed to process the media file.", { parse_mode: "HTML" });
        }
      } finally {
        release();
      }
    });

    // Natural language messages - route to native runtime
    bot.on("message", async (ctx) => {
      // Skip media types — they are handled by dedicated handlers above
      const msg = ctx.message as any;
      if (msg.photo || msg.document || msg.video || msg.audio || msg.voice || msg.sticker || msg.animation) return;

      const chatId = ctx.chat.id.toString();
      const text = (ctx.message as any)?.text ?? (ctx.message as any)?.caption ?? "";
      
      if (chatId !== cfg.telegramChatId || !text || text.startsWith("/")) return;
      
      const release = await chatMutex.acquire(chatId);
      try {
        logger.info({ chatId, text: text.substring(0, 100) }, "Message received");
        await ctx.sendChatAction("typing");
        
        let typingInterval: ReturnType<typeof setInterval> | undefined;
        try {
          // Determine route with timeout reset
          let route = getRoute(chatId);
          if (Date.now() - route.lastActive > route.timeoutMs && !boardMeetingActive) {
            route = { participants: ["ceo-strategic"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs };
          }
          setRoute(chatId, route);

          const runtime = getNativeRuntime();

          // Keep typing indicator active during processing
          typingInterval = setInterval(() => {
            ctx.sendChatAction("typing").catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "sendChatAction failed"));
          }, 5000);

          try {
            // Fan-out to all participants concurrently
            const replies = await Promise.allSettled(route.participants.map(async (agentId) => {
              // Wake context per agent
              let wakeCtx = "";
              try {
                const wc = await contextManager.getWakeContext(agentId);
                wakeCtx = await contextManager.formatWakeContext(wc);
              } catch (e) { 
                logger.warn({ err: e }, "Failed to build wake context"); 
                wakeCtx = "[No context available]";
              }

              // Get persistent session via registry
              try {
                await sessionRegistry.getOrCreate(agentId, { chatId });
              } catch (e: any) {
                logger.warn({ agentId, err: e.message }, "sessionRegistry.getOrCreate failed");
              }

              // Build delta
              let memoryFacade: any;
              try {
                memoryFacade = await getMemoryFacade();
              } catch (e: any) {
                logger.warn({ agentId, err: e.message }, "MemoryFacade unavailable");
              }

              // AUTO RECALL: Fetch relevant memories before responding
              let recallText = "";
              try {
                recallText = await autoRecall({
                  agentId,
                  queryText: text,
                  trigger: "user_message",
                });
              } catch (e: any) {
                logger.warn({ agentId, err: e.message }, "autoRecall failed");
              }

              let memoryInjection = "";
              if (memoryFacade) {
                try {
                  memoryInjection = await memoryFacade.injectForTask(agentId, text);
                } catch (e: any) {
                  logger.warn({ agentId, err: e.message }, "memory inject failed");
                }
              }

              const delta = [
                recallText,
                memoryInjection,
                `---`,
                `[User Message]`,
                text,
                `[/User Message]`,
                ``,
                `[Context]`,
                wakeCtx,
                `[/Context]`,
              ].filter(Boolean).join('\n');

              // Send with native agent identity
              const nativeAgentId = AGENT_ID_MAP[agentId] || agentId;
              let reply = "(no reply)";
              let sid: string | undefined;
              try {
                sid = await runtime.getOrCreateRuntimeSession(nativeAgentId, { mode: "message", contextId: chatId });
                logger.info({ agentId, nativeAgentId, sessionId: sid }, "Sending delta to native runtime...");
                const result = await runtime.sendMessage(sid, delta, nativeAgentId);
                logger.info({ agentId, textLength: result.text?.length, tokens: result.tokens }, "Native runtime response received");
                reply = result.text || "(empty response)";
              } catch (err: any) {
                logger.error({ agentId, err: err.message }, "Native runtime message failed");
                reply = `(error contacting agent: ${err.message})`;
              }

              // AUTO STORE: Save the conversation turn
              try {
                await autoStore({
                  agentId,
                  inputText: text,
                  outputText: reply,
                  trigger: "user_message",
                  context: {
                    threadId: chatId,
                  },
                });
              } catch (e: any) {
                logger.warn({ agentId, err: e.message }, "autoStore failed");
              }

              try {
                if (sid) await sessionRegistry.touch(sid);
              } catch (e: any) {
                logger.warn({ agentId, err: e.message }, "session touch failed");
              }

              const prefix = getStaffById(agentId)?.avatar ? `${getStaffById(agentId)?.avatar} ${getStaffById(agentId)?.name}` : agentId;
              return `${prefix}:\n${reply}`;
            }));

            // Clear typing indicator
            clearInterval(typingInterval);

            const successful = replies.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
            const failed = replies.filter(r => r.status === "rejected");

            if (failed.length > 0) {
              for (const f of failed) {
                const err = (f as PromiseRejectedResult).reason;
                logger.error({ err: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, "Agent response rejected");
              }
              logger.warn({ failed: failed.length, total: replies.length }, "Partial agent response failure");
            }
            if (successful.length === 0) {
              await ctx.reply("❌ No agents could respond right now. Please try again later.");
              return;
            }

            const combined = successful.map(r => r.value).join("\n\n");
            logger.info({ textLength: combined.length, agentsOk: successful.length, agentsFailed: failed.length }, "Sending reply to Telegram...");
            
            // Convert markdown to HTML and send with smart chunking
            const html = markdownToTelegramHtml(combined);
            await sendTelegramHtmlChunks(ctx, html, combined);
            logger.info("Reply sent successfully");
          } catch (err: any) {
            clearInterval(typingInterval);
            logger.error({ err: err.message }, "Failed to process message");
            const safeMsg = err.message?.length < 100 && !err.message?.includes("ECONN") && !err.message?.includes("ETIMEDOUT") && !err.message?.includes("ENOENT")
              ? "A processing error occurred"
              : "A processing error occurred";
            await ctx.reply(`❌ ${safeMsg}\n\nPlease try again or use /help for commands.`);
          }
        } catch (err: any) {
          clearInterval(typingInterval);
          logger.error({ err: err.message }, "Unexpected error in message handler");
          await ctx.reply(`<b>❌ Unexpected error</b> - Please try again`, { parse_mode: "HTML" });
        }
      } finally {
        release();
      }
    });

    // ── Callback query handler for inline keyboard interactions ──
    bot.action(/^agent_(.+)$/, async (ctx) => {
      const chatId = String(ctx.callbackQuery?.message?.chat?.id ?? "");
      if (chatId !== cfg.telegramChatId) {
        await ctx.answerCbQuery("Not authorized");
        return;
      }
      const agentId = ctx.match[1];
      const staff = getStaffById(agentId);
      if (!staff) {
        await ctx.answerCbQuery("Agent not found");
        return;
      }

      chatAgentMap.set(chatId, agentId);
      setRoute(chatId, { participants: [agentId], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
      persistState();

      await ctx.answerCbQuery(`Switched to ${staff.name}`);
      try {
        await ctx.editMessageText(
          `✅ Now speaking with ${staff.avatar} ${staff.name}\n\n${staff.title}\n\nAsk me anything or give me tasks.`,
          { parse_mode: "HTML" },
        );
      } catch (err: any) {
        logger.warn({ err: err.message }, "telegram:action.agent.edit.failed");
      }
      logger.info({ chatId, agentId }, "Agent switched via inline keyboard");
    });

    // board_view_ callback — view specific agent's board from inline keyboard
    bot.action(/^board_view_(.+)$/, async (ctx) => {
      const chatId = String(ctx.callbackQuery?.message?.chat?.id ?? "");
      if (chatId !== cfg.telegramChatId) {
        await ctx.answerCbQuery("Not authorized");
        return;
      }
      const agentId = ctx.match[1];
      const staff = getStaffById(agentId);
      if (!staff) {
        await ctx.answerCbQuery("Agent not found");
        return;
      }

      await ctx.answerCbQuery(`Viewing ${staff.name}'s board`);
      try {
        const board = await rt.ctx.kanban.getBoard(agentId);
        if (!board) {
          await ctx.reply(`<b>❌ Board not found for</b> <b>${escapeHtml(agentId)}</b>`, { parse_mode: "HTML" });
          return;
        }
        const agentName = `${staff.avatar} ${staff.name}`;
        const priorityEmoji: Record<string, string> = { P1: "🔴", P2: "🟡", P3: "🔵", P4: "⚪" };
        const lines = [`<b>📋 ${escapeHtml(agentName)}'s Board</b>\n`];
        for (const col of board.columns) {
          const cardCount = col.cards.length;
          lines.push(`<b>${escapeHtml(col.name)}</b> (${cardCount})`);
          for (const card of col.cards.slice(0, 8)) {
            const emoji = priorityEmoji[card.priority] || "⚪";
            const dueStr = card.due ? ` <i>(due: ${escapeHtml(card.due)})</i>` : "";
            lines.push(`  ${emoji} <b>${escapeHtml(card.title)}</b>${dueStr}`);
          }
          if (col.cards.length > 8) lines.push(`  ... and ${col.cards.length - 8} more`);
          if (cardCount === 0) lines.push(`  <i>(empty)</i>`);
        }
        const totalCards = board.columns.reduce((sum, c) => sum + c.cards.length, 0);
        lines.push(`\n<b>Total: ${totalCards} cards</b>`);

        const buttons = getCoreStaffIds()
          .filter(id => id !== agentId)
          .slice(0, 6)
          .map(id => {
            const s = getStaffById(id);
            return s ? Markup.button.callback(`${s.avatar} ${s.name}`, `board_view_${id}`) : null;
          })
          .filter(Boolean);
        const rows: any[][] = [];
        for (let i = 0; i < buttons.length; i += 2) {
          rows.push(buttons.slice(i, i + 2));
        }

        await ctx.reply(lines.join("\n"), {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard(rows),
        });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
      }
    });

    // meeting_vote_yes_ callback — vote yes on meeting proposal
    bot.action(/^meeting_vote_yes_(.+)$/, async (ctx) => {
      const chatId = String(ctx.callbackQuery?.message?.chat?.id ?? "");
      if (chatId !== cfg.telegramChatId) {
        await ctx.answerCbQuery("Not authorized");
        return;
      }
      const meetingId = ctx.match[1];
      try {
        const { applyUserDecision } = await import("../organic/board-meeting.js");
        await applyUserDecision(meetingId, "approved");
        await ctx.answerCbQuery("✅ Vote recorded: Yes");
        logger.info({ meetingId, vote: "yes" }, "Meeting vote recorded");
      } catch (err: any) {
        await ctx.answerCbQuery("❌ Failed to record vote");
        logger.error({ meetingId, err: err.message }, "Failed to record meeting vote");
      }
    });

    // meeting_vote_no_ callback — vote no on meeting proposal
    bot.action(/^meeting_vote_no_(.+)$/, async (ctx) => {
      const chatId = String(ctx.callbackQuery?.message?.chat?.id ?? "");
      if (chatId !== cfg.telegramChatId) {
        await ctx.answerCbQuery("Not authorized");
        return;
      }
      const meetingId = ctx.match[1];
      try {
        const { applyUserDecision } = await import("../organic/board-meeting.js");
        await applyUserDecision(meetingId, "negated");
        await ctx.answerCbQuery("❌ Vote recorded: No");
        logger.info({ meetingId, vote: "no" }, "Meeting vote recorded");
      } catch (err: any) {
        await ctx.answerCbQuery("❌ Failed to record vote");
        logger.error({ meetingId, err: err.message }, "Failed to record meeting vote");
      }
    });

    // commands_page_noop — dismiss callback for page indicator button
    bot.action("commands_page_noop", async (ctx) => {
      await ctx.answerCbQuery();
    });

    // commands_page_ callback — paginate commands browser
    bot.action(/^commands_page_(\d+)$/, async (ctx) => {
      const chatId = String(ctx.callbackQuery?.message?.chat?.id ?? "");
      if (chatId !== cfg.telegramChatId) {
        await ctx.answerCbQuery("Not authorized");
        return;
      }
      const page = parseInt(ctx.match[1], 10);
      const totalPages = Math.ceil(OPERANT_COMMANDS.length / COMMANDS_PER_PAGE);
      if (page < 1 || page > totalPages) {
        await ctx.answerCbQuery("Invalid page");
        return;
      }
      await ctx.answerCbQuery();
      try {
        const start = (page - 1) * COMMANDS_PER_PAGE;
        const end = Math.min(start + COMMANDS_PER_PAGE, OPERANT_COMMANDS.length);
        const pageCommands = OPERANT_COMMANDS.slice(start, end);

        const lines = [`<b>📋 Operant Commands</b> (Page ${page}/${totalPages})\n`];
        for (let i = 0; i < pageCommands.length; i++) {
          const cmd = pageCommands[i];
          lines.push(`<b>/${escapeHtml(cmd.command)}</b> — ${escapeHtml(cmd.description)}`);
        }

        const buttons: any[] = [];
        if (page > 1) {
          buttons.push(Markup.button.callback("◀ Prev", `commands_page_${page - 1}`));
        }
        buttons.push(Markup.button.callback(`${page}/${totalPages}`, "commands_page_noop"));
        if (page < totalPages) {
          buttons.push(Markup.button.callback("Next ▶", `commands_page_${page + 1}`));
        }

        await ctx.editMessageText(lines.join("\n"), {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([buttons]),
        });
      } catch (err: any) {
        try {
          await ctx.answerCbQuery("Failed to update");
        } catch { /* ignore answerCbQuery failure in error handler */ }
        logger.error({ err: err.message }, "commands_page callback error");
      }
    });

    // Error recovery: catch errors from the Telegraf bot
    bot.catch(async (err: any) => {
      const ctx = err.ctx as any;
      const updateType = ctx?.updateType || "unknown";
      logger.error({ err: err.message, updateType }, "Telegram bot error");
      ErrorBus.emit({
        type: "gateway:down",
        severity: "error",
        component: "gateway-telegram",
        error: err,
        message: `Telegram gateway error: ${err.message}`,
        context: { gatewayType: "telegram" },
      });
      try {
        await sendTelegramMessage(`⚠️ **Bot Error**: ${err.message}`, "warning");
      } catch { /* ignore notification failures */ }
    });

    // bot.launch() starts long-polling — Promise never resolves until bot.stop()
    // Do NOT await it, or all subsequent code will hang forever
    try {
      bot.launch({ dropPendingUpdates: true });
      logger.info({ username: bot.botInfo?.username }, "Telegram bot running");
    } catch (err: any) {
      logger.error({ err: err.message }, "Telegram bot launch failed");
      return null;
    }

    setTelegramBot(bot);

    // ── Register native bot command menu (appears on "/" tap) ──
    const TELEGRAM_COMMANDS = [
      { command: "start", description: "Welcome message" },
      { command: "agent", description: "Pick an agent from inline menu" },
      { command: "meeting", description: "Start/end board meeting" },
      { command: "meetings", description: "Pending meeting proposals" },
      { command: "org", description: "Organization chart" },
      { command: "staff", description: "Core staff list" },
      { command: "agents", description: "All agents with status" },
      { command: "wake", description: "Agent wake context" },
      { command: "messages", description: "Browse message threads" },
      { command: "inbox", description: "Message inbox" },
      { command: "recall", description: "Search vector memory" },
      { command: "memory", description: "Memory statistics" },
      { command: "board", description: "View Kanban board" },
      { command: "report", description: "Latest reports" },
      { command: "session", description: "Session management" },
      { command: "hire", description: "Hire auxiliary staff" },
      { command: "fire", description: "Fire auxiliary staff" },
      { command: "team", description: "View auxiliary team" },
      { command: "cron", description: "Scheduled tasks" },
      // Phase 1: Status & info
      { command: "whoami", description: "Your identity context" },
      { command: "commands", description: "Browse all commands" },
      { command: "reset", description: "Reset session" },
      // Phase 2: Session lifecycle
      { command: "restart", description: "Restart daemon" },
      { command: "compact", description: "Compact session context" },
      { command: "new", description: "Start new session" },
      { command: "stop", description: "Abort current run" },
      // Phase 3: Runtime & visibility
      { command: "tasks", description: "Active tasks overview" },
      { command: "context", description: "Agent context & memories" },
      { command: "model", description: "Model configuration" },
      // Phase 4: Advanced operations
      { command: "delegate", description: "Delegate task to agent" },
      { command: "standup", description: "Daily team standup" },
      { command: "escalate", description: "Escalate to CEO" },
      { command: "priority", description: "Send priority message" },
      // Common
      { command: "status", description: "System health status" },
      { command: "help", description: "Command reference" },
    ];
    try {
      await bot.telegram.setMyCommands(TELEGRAM_COMMANDS);
      logger.info({ count: TELEGRAM_COMMANDS.length }, "Bot command menu registered");
    } catch (err: any) {
      logger.warn({ err: err.message }, "Failed to register bot command menu");
    }

    // ── Polling watchdog (OpenClaw pattern: detect stalled polling) ──
    let pollingConsecutiveStalls = 0;
    const MAX_CONSECUTIVE_STALLS = 3;

    // Track activity via error handler — errors indicate the polling loop is at least alive enough to detect problems
    // The periodic health probe (in index.ts) serves as the actual liveness check

    try {
      const lastAgentId = chatAgentMap.get(cfg.telegramChatId) || "ceo-strategic";
      const lastStaff = getStaffById(lastAgentId);
      const agentName = lastStaff ? `${lastStaff.avatar} ${lastStaff.name}` : lastAgentId;

      const health = getAgentHealthRegistry();
      const teamStatus = health.getTeamStatus();
      const statusEmoji: Record<string, string> = { healthy: "🟢", degraded: "🟡", silent: "⚫", error: "🔴" };
      const silentAgents = health.getSilentAgents();

      const agentLines = teamStatus
        .map(h => {
          const emoji = statusEmoji[h.status] || "⚪";
          return `${emoji} ${h.avatar} ${h.name} — ${h.status}`;
        })
        .join("\n") || `🟢 ${agentName} — healthy (startup)`;

      const lastShutdown = readShutdownTimestamp();
      const downtimeText = lastShutdown
        ? `\nDowntime: ${formatDowntime(Date.now() - lastShutdown)}`
        : "";

      const silentAgentNames = silentAgents.map(id => {
        const s = getStaffById(id);
        return s ? `${s.avatar} ${s.name}` : id;
      });
      const silentWarning = silentAgentNames.length > 0
        ? `\n⚠️ Silent agents: ${silentAgentNames.join(", ")}`
        : "";

      const startupMsg = `<b>🔄 ${agentName} back online${downtimeText}</b>

<b>Team status:</b>
${agentLines}${silentWarning}

Tap an agent below to switch, or send /help for all commands.`;

      const buttons = getCoreStaffIds().map(id => {
        const s = getStaffById(id);
        return s ? Markup.button.callback(`${s.avatar} ${s.name}`, `agent_${id}`) : null;
      }).filter(Boolean);
      const rows: any[][] = [];
      for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
      }
      const staffKeyboard = Markup.inlineKeyboard(rows);

      await bot.telegram.sendMessage(cfg.telegramChatId, startupMsg, { parse_mode: "HTML", ...staffKeyboard });
      logger.info({ agentId: lastAgentId }, "Startup message sent from last-active agent");

      // Ensure the message handler routes to the correct agent (not just chatAgentMap, but also chatRoutes)
      setRoute(cfg.telegramChatId, { participants: [lastAgentId], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
      persistState();
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to send startup message");
    }

    return bot;
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to start Telegram bot");
    return null;
  }
}

// Exported for notify.telegram tool
let telegramBot: any = null;
export function setTelegramBot(bot: any) { telegramBot = bot; }
export async function sendTelegramMessage(text: string, priority: "info" | "warning" | "urgent" = "info"): Promise<boolean> {
  if (!telegramBot || !cfg.telegramChatId) {
    logger.warn("Telegram not configured for notifications");
    return false;
  }
  try {
    const html = markdownToTelegramHtml(text);
    const htmlChunks = splitTelegramHtmlChunks(html, TELEGRAM_MAX_LENGTH);
    for (const chunk of htmlChunks) {
      try {
        await telegramBot.telegram.sendMessage(cfg.telegramChatId, chunk, { 
          parse_mode: "HTML",
          disable_notification: priority === "info"
        });
      } catch (htmlErr: any) {
        if (/can't parse entities|parse entities|find end of the entity/i.test(htmlErr.message)) {
          const plainText = text.replace(/<[^>]*>/g, '');
          const plainChunks = splitTelegramHtmlChunks(plainText, TELEGRAM_MAX_LENGTH);
          for (const plainChunk of plainChunks) {
            await telegramBot.telegram.sendMessage(cfg.telegramChatId, plainChunk, {
              disable_notification: priority === "info"
            });
          }
        } else {
          throw htmlErr;
        }
      }
    }
    logger.info({ text: text.substring(0, 50), priority }, "Telegram notification sent");
    return true;
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to send Telegram notification");
    ErrorBus.emit({
      type: "gateway:down",
      severity: "warn",
      component: "gateway-telegram",
      error: err,
      message: `Telegram send failed: ${err.message}`,
      context: { gatewayType: "telegram" },
    });
    return false;
  }
}

export function getTelegramBot() {
  return telegramBot;
}

export type TelegramProbeResult = {
  ok: boolean;
  elapsedMs: number;
  username?: string;
  botId?: number;
  error?: string;
};

export async function probeTelegram(timeoutMs = 5000): Promise<TelegramProbeResult> {
  const started = Date.now();
  if (!telegramBot) {
    return { ok: false, elapsedMs: Date.now() - started, error: "bot not initialized" };
  }
  try {
    const me = await Promise.race([
      telegramBot.telegram.getMe(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe timeout")), timeoutMs)
      ),
    ]);
    return {
      ok: true,
      elapsedMs: Date.now() - started,
      username: me?.username,
      botId: me?.id,
    };
  } catch (err: any) {
    return {
      ok: false,
      elapsedMs: Date.now() - started,
      error: err.message || String(err),
    };
  }
}

export function isBoardMeetingActive(): boolean {
  return boardMeetingActive;
}

export function getPreviousRoute(): ChatRoute | null {
  return previousRoute;
}

export function setBoardMeetingActive(active: boolean): void {
  if (active && !boardMeetingActive) {
    if (cfg.telegramChatId) {
      const currentRoute = chatRoutes.get(cfg.telegramChatId);
      if (currentRoute) {
        previousRoute = currentRoute;
      }
    }
    chatAgentMap.set(cfg.telegramChatId || "", "ceo-strategic");
    if (cfg.telegramChatId) {
      setRoute(cfg.telegramChatId, {
        participants: ["ceo-strategic"],
        mode: "single",
        lastActive: Date.now(),
        timeoutMs: defaultTimeoutMs,
      });
    }
    boardMeetingActive = true;
    logger.info("Board meeting activated — routing to CEO");
  } else if (!active && boardMeetingActive) {
    if (previousRoute && cfg.telegramChatId) {
      chatAgentMap.set(cfg.telegramChatId, previousRoute.participants[0] || "ceo-strategic");
      setRoute(cfg.telegramChatId, previousRoute);
      persistState();
      previousRoute = null;
    }
    boardMeetingActive = false;
    logger.info("Board meeting deactivated — restored previous route");
  }
}

export async function deliverMeetingReport(report: string, meetingId: string): Promise<boolean> {
  if (!telegramBot || !cfg.telegramChatId) {
    logger.warn("Telegram not configured for meeting report delivery");
    return false;
  }
  try {
    const html = markdownToTelegramHtml(report);
    const htmlChunks = splitTelegramHtmlChunks(html, TELEGRAM_MAX_LENGTH);
    for (let i = 0; i < htmlChunks.length; i++) {
      const chunk = htmlChunks[i];
      const isLast = i === htmlChunks.length - 1;
      try {
        if (isLast) {
          await telegramBot.telegram.sendMessage(cfg.telegramChatId, chunk, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Approve", callback_data: `board_approve_${meetingId}` },
                  { text: "❌ Reject", callback_data: `board_reject_${meetingId}` },
                ],
              ],
            },
          });
        } else {
          await telegramBot.telegram.sendMessage(cfg.telegramChatId, chunk, {
            parse_mode: "HTML",
          });
        }
      } catch (htmlErr: any) {
        if (/can't parse entities|parse entities|find end of the entity/i.test(htmlErr.message)) {
          const plainChunk = chunk.replace(/<[^>]*>/g, '').slice(0, TELEGRAM_MAX_LENGTH);
          if (isLast) {
            await telegramBot.telegram.sendMessage(cfg.telegramChatId, plainChunk, {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "✅ Approve", callback_data: `board_approve_${meetingId}` },
                    { text: "❌ Reject", callback_data: `board_reject_${meetingId}` },
                  ],
                ],
              },
            });
          } else {
            await telegramBot.telegram.sendMessage(cfg.telegramChatId, plainChunk);
          }
        } else {
          throw htmlErr;
        }
      }
    }
    logger.info({ reportLength: report.length, meetingId }, "Meeting report delivered with decision buttons");
    return true;
  } catch (err: any) {
    logger.error({ err: err.message, meetingId }, "Failed to deliver meeting report");
    return false;
  }
}
