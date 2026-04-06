import { Telegraf, Markup } from "telegraf";
import { logger } from "../logger.js";
import { cfg } from "../config.js";
import type { StrategosRuntime } from "../types.js";
import { getOrgChart, getCoreStaffIds, getStaffById, AGENT_ID_MAP } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { AgentContextManager } from "../organic/context.js";
import { getNativeRuntime } from "../runtime/native-agent-runtime.js";
import { autoStore, autoRecall } from "../memory/auto.js";
import { getMemoryFacade } from "../memory/index.js";
import { getSessionRegistry } from "../scheduler/session-registry.js";
import { getAgentHealthRegistry } from "../scheduler/agent-health.js";
import os from "node:os";
import path from "node:path";
import * as fs from "node:fs";

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
  const htmlChunks = splitTelegramHtmlChunks(html, TELEGRAM_MAX_LENGTH);
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

const STATE_FILE = path.join(os.homedir(), ".strategos", "state", "telegram-routes.json");
const SHUTDOWN_TS_FILE = path.join(os.homedir(), ".strategos", "state", "shutdown-timestamp.json");

// ── Module-level routing state (lifted from startTelegram for board meeting access) ──

type ChatRoute = { participants: string[]; mode: "single"|"meeting"|"threaded"; lastActive: number; timeoutMs: number };
const defaultTimeoutMs = parseInt(process.env.TG_ROUTE_TIMEOUT_MS || "1800000", 10); // 30 minutes

const chatAgentMap = new Map<string, string>();
const chatRoutes = new Map<string, ChatRoute>();

function getRoute(chatId: string): ChatRoute {
  const r = chatRoutes.get(chatId);
  if (r) return r;
  const created: ChatRoute = { participants: ["ceo-strategic"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs };
  chatRoutes.set(chatId, created);
  return created;
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
  persistState();
}

function loadChatState(): Record<string, { agent_id: string; route?: { participants: string[]; mode: "single"|"meeting"|"threaded"; timeoutMs: number } }> {
  try {
    if (fs.existsSync(STATE_FILE)) {
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
    const tmpPath = `${STATE_FILE}.tmp-${process.pid}`;
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
      const data = JSON.parse(fs.readFileSync(SHUTDOWN_TS_FILE, "utf-8"));
      return data.timestamp ?? null;
    }
  } catch { /* ignore */ }
  return null;
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

let boardMeetingActive = false;
let previousRoute: ChatRoute | null = null;

export async function startTelegram(rt: StrategosRuntime) {
  if (!cfg.telegramToken || cfg.telegramToken === "your_bot_token_here") {
    logger.warn("Telegram not configured - set TELEGRAM_BOT_TOKEN in .env");
    return null;
  }

  if (!cfg.telegramChatId || cfg.telegramChatId === "your_chat_id_here") {
    logger.warn("Telegram chat ID not configured - set TELEGRAM_CHAT_ID in .env");
    return null;
  }

  try {
    const bot = new Telegraf(cfg.telegramToken, { handlerTimeout: Infinity });
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
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      
      const staffList = getCoreStaffIds()
        .map(id => {
          const s = getStaffById(id);
          return s ? `• ${s.avatar} ${s.name} — ${s.title}` : "";
        })
        .filter(Boolean)
        .join("\n");
      
      const message = `<b>👋 I'm Strategos, your CEO agent.</b>

<b>Core Staff:</b>
${staffList}

<b>Commands:</b>
/start — Welcome message
/agent [name] — Summon an agent (e.g., /agent CFO)
/help — Command reference
/org — Organization chart
/staff — List core staff
/agents — All agents
/wake [agent] — Agent context
/messages [agent] — Browse messages
/recall [query] — Search memory
/status — System status

Just talk naturally to interact with the team!`;
      
      await ctx.reply(message, { parse_mode: "HTML" });
      const chatId = ctx.chat.id.toString();
      const currentAgent = chatAgentMap.get(chatId) || "ceo-strategic";
      setRoute(chatId, { participants: [currentAgent], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
    });

    // /agent - Summon any agent
    bot.command("agent", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      
      const args = (ctx.message as any)?.text?.split(" ") || [];
      const agentName = args[1]?.toLowerCase();
      
      if (!agentName) {
        const agents = getCoreStaffIds()
          .map(id => {
            const s = getStaffById(id);
            return s ? `${s.avatar} ${s.name} — /agent ${s.name.toLowerCase().replace(/\s+/g, '-')}` : "";
          })
          .filter(Boolean)
          .join("\n");
        
        await ctx.reply(`<b>🎯 Summon an Agent:</b>\n\n${agents}`, { parse_mode: "HTML" });
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
    });

    // /meeting command: manage multi-agent sessions (user can still start meetings)
    bot.command("meeting", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      if (args.length === 0) {
        await ctx.reply("Usage: /meeting [end|names...]\nExample: /meeting CFO CMO CTO");
        return;
      }
      const chatId = ctx.chat.id.toString();
      if (args[0].toLowerCase() === "end") {
        setRoute(chatId, { participants: ["ceo-strategic"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
        persistState();
        await ctx.reply(`<b>🛑 Meeting ended. Back to Strategos.</b>`, { parse_mode: "HTML" });
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
      const names = ids.map(id => getStaffById(id)?.name || id).join(", ");
      await ctx.reply(`<b>🏛 Boardroom meeting active with:</b> ${names}`, { parse_mode: "HTML" });
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
            const decisionEmoji = decision === "approved" ? "✅ **Approved**" : "❌ **Rejected**";
            await ctx.editMessageText(`${originalText}\n\n${decisionEmoji}`, { parse_mode: "Markdown" });
          }
        } catch { /* ignore edit failures (e.g., message too old) */ }

        logger.info({ meetingId, decision }, "Board meeting decision applied");
      } catch (err: any) {
        logger.error({ meetingId, err: err.message }, "Failed to apply board meeting decision");
        await ctx.answerCbQuery("❌ Failed to apply decision");
      }
    });

    // /org command
    bot.command("org", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const html = markdownToTelegramHtml(getOrgChart());
      await ctx.reply(html, { parse_mode: "HTML" });
    });

    // /staff command
    bot.command("staff", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;

      const staffLines = getCoreStaffIds().map(id => {
        const s = getStaffById(id);
        if (!s) return "";
        return `${s.avatar} <b>${s.name}</b> — ${s.title}\n   ├─ Board: ${s.boardSeat ? "Yes" : "No"}\n   └─ Reports: ${s.reportsTo || "CEO"}`;
      }).filter(Boolean).join("\n\n");

      await ctx.reply(`<b>Core Staff:</b>\n\n${staffLines}`, { parse_mode: "HTML" });
    });

    // /agents command
    bot.command("agents", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;

      const core = getCoreStaffIds()
        .map(id => {
          const s = getStaffById(id);
          return s ? `🏢 ${s.avatar} ${s.id} (${s.title})` : "";
        })
        .filter(Boolean);

      const aux = Array.from(registry.agents.values()).map(a => `• ${a.id} (${a.role})`);
      const list = [...core, ...aux].join("\n") || "No agents yet";

      await ctx.reply(`<b>🤖 All Agents:</b>\n\n${list}`, { parse_mode: "HTML" });
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

    // /messages command
    bot.command("messages", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(" ") || [];
      const agentId = args[1] || "ceo-strategic";

      await ctx.sendChatAction("typing");
      try {
        const messaging = await getMessagingSystem();
        const threads = await messaging.getThreadsForAgent(agentId, 10);

        if (threads.length === 0) {
          await ctx.reply("📭 No messages yet");
          return;
        }

        const formatTime = (ts: number | undefined): string => {
          if (!ts) return "unknown";
          const d = new Date(ts < 1e12 ? ts * 1000 : ts);
          if (isNaN(d.getTime())) return "unknown";
          return d.toLocaleString();
        };

        const lines = threads.map(t => {
          const other = t.participants.find(p => p !== agentId) || "unknown";
          const ts = formatTime(t.updated_at);
          return `• <b>${escapeHtml(t.subject)}</b> (with ${other})\n  <i>${ts}</i>`;
        }).join("\n");

        await ctx.reply(`<b>📬 Messages for ${agentId} (${threads.length})</b>\n\n${lines}`, { parse_mode: "HTML" });
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
        await ctx.reply("Usage: /recall [query]\nExample: /recall budget meeting");
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
      const helpText = `<b>📋 Strategos Help</b>

<b>Organization Commands:</b>
/org — Organization chart
/staff — Core staff list
/agents — All agents (core + auxiliary)
/agent [name] — Summon an agent

<b>Memory &amp; Context:</b>
/wake [agent] — View agent's wake context
/messages [agent] — Browse message threads
/recall [query] — Search across all memory

<b>System Commands:</b>
/status — System status
/help — This help message

<b>Natural Language:</b>
Just talk naturally! Examples:
• "Understand my trajectory"
• "Prioritize today"
• "Create a developer agent"
• "Propose a board meeting"`;

      await ctx.reply(helpText, { parse_mode: "HTML" });
    });

    // /status command
    bot.command("status", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      await ctx.sendChatAction("typing");
      try {
        const chatId = ctx.chat.id.toString();
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

        await ctx.reply(`<b>✅ Strategos System Status</b>

<b>Active agent:</b> ${activeAgentDisplay}

<b>System:</b>
• MCP Server: Running
• Core Staff: ${teamStatus.length} agents
• Memory: Active
• Telegram: Online
• Native Runtime: Healthy (${sessions.length} session(s) active)

<b>Team health:</b>
${agentLines}`, { parse_mode: "HTML" });
      } catch (err: any) {
        await ctx.reply(`<b>❌ Error:</b> ${escapeHtml(err.message)}`, { parse_mode: "HTML" });
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

    // Natural language messages - route to native runtime
    bot.on("message", async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const text = (ctx.message as any)?.text;
      
      if (chatId !== cfg.telegramChatId || !text || text.startsWith("/")) return;
      
      logger.info({ chatId, text: text.substring(0, 100) }, "Message received");
      await ctx.sendChatAction("typing");
      
      try {
        // Determine route with timeout reset
        let route = getRoute(chatId);
        if (Date.now() - route.lastActive > route.timeoutMs && !boardMeetingActive) {
          route = { participants: ["ceo-strategic"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs };
        }
        setRoute(chatId, route);

        const runtime = getNativeRuntime();

        // Keep typing indicator active during processing
        const typingInterval = setInterval(() => {
          ctx.sendChatAction("typing").catch(() => {});
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
              sid = runtime.getOrCreateRuntimeSession(nativeAgentId, { mode: "message" });
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
        logger.error({ err: err.message }, "Unexpected error in message handler");
        await ctx.reply(`<b>❌ Unexpected error</b> - Please try again`, { parse_mode: "HTML" });
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
      await ctx.editMessageText(
        `✅ Now speaking with ${staff.avatar} ${staff.name}\n\n${staff.title}\n\nAsk me anything or give me tasks.`,
        { parse_mode: "HTML" },
      );
      logger.info({ chatId, agentId }, "Agent switched via inline keyboard");
    });

    // Error recovery: catch errors from the Telegraf bot
    bot.catch(async (err: any) => {
      const ctx = err.ctx as any;
      const updateType = ctx?.updateType || "unknown";
      logger.error({ err: err.message, updateType }, "Telegram bot error");
      try {
        await sendTelegramMessage(`⚠️ **Bot Error**: ${err.message}`, "warning");
      } catch { /* ignore notification failures */ }
    });

    // bot.launch() starts long-polling — Promise never resolves until bot.stop()
    // Do NOT await it, or all subsequent code will hang forever
    try {
      bot.launch({ dropPendingUpdates: false });
      logger.info({ username: bot.botInfo?.username }, "Telegram bot running");
    } catch (err: any) {
      logger.error({ err: err.message }, "Telegram bot launch failed");
      return null;
    }

    setTelegramBot(bot);

    // ── Register native bot command menu (appears on "/" tap) ──
    const TELEGRAM_COMMANDS = [
      { command: "start", description: "Welcome message" },
      { command: "agent", description: "Summon an agent" },
      { command: "meeting", description: "Start/end board meeting" },
      { command: "org", description: "Organization chart" },
      { command: "staff", description: "Core staff list" },
      { command: "agents", description: "All agents with status" },
      { command: "wake", description: "Agent wake context" },
      { command: "messages", description: "Browse message threads" },
      { command: "recall", description: "Search vector memory" },
      { command: "session", description: "Session management" },
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
        // Fall back to plain text on parse error
        if (/can't parse entities|parse entities|find end of the entity/i.test(htmlErr.message)) {
          await telegramBot.telegram.sendMessage(cfg.telegramChatId, text, { 
            disable_notification: priority === "info"
          });
        } else {
          throw htmlErr;
        }
      }
    }
    logger.info({ text: text.substring(0, 50), priority }, "Telegram notification sent");
    return true;
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to send Telegram notification");
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
    const timeout = setTimeout(() => {}, timeoutMs);
    const me = await Promise.race([
      telegramBot.telegram.getMe(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe timeout")), timeoutMs)
      ),
    ]);
    clearTimeout(timeout);
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
          if (isLast) {
            await telegramBot.telegram.sendMessage(cfg.telegramChatId, report.slice(0, TELEGRAM_MAX_LENGTH), {
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
            await telegramBot.telegram.sendMessage(cfg.telegramChatId, report.slice(0, TELEGRAM_MAX_LENGTH));
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
