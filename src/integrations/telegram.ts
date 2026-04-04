import { Telegraf } from "telegraf";
import { fmt, bold, italic, join } from "telegraf/format";
import { logger } from "../logger.js";
import { cfg } from "../config.js";
import type { StrategosRuntime } from "../types.js";
import { getOrgChart, getCoreStaffIds, getStaffById } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { AgentContextManager } from "../organic/context.js";
import { getNativeRuntime } from "../runtime/native-agent-runtime.js";
import { autoStore, autoRecall } from "../memory/auto.js";
import { getMemoryFacade } from "../memory/index.js";
import { getSessionRegistry } from "../scheduler/session-registry.js";

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

// Maps internal agent IDs to native runtime agent identifiers
const AGENT_ID_MAP: Record<string, string> = {
  "ceo-strategic": "ceo-strategic",
  "coo-productivity": "coo-productivity",
  "cfo-financial": "cfo-financial",
  "cmo-content": "cmo-content",
  "cro-relational": "cro-relational",
  "physician-health": "cpso-health",
  "cpo-psychologist": "cpo-psychologist",
  "cio-intelligence": "cio-intelligence",
};

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
    const bot = new Telegraf(cfg.telegramToken);
    const registry: AgentRegistry = { agents: new Map(), cards: new Map() };
    const contextManager = new AgentContextManager(rt.ctx.kanban, rt.ctx.memory);
    
    logger.info({ chatId: cfg.telegramChatId }, "Telegram starting...");

    // Current agent per chat (legacy single-agent mapping)
    const chatAgentMap = new Map<string, string>();
    // Router: active participants per chat (single, meeting, or threaded)
    type ChatRoute = { participants: string[]; mode: "single"|"meeting"|"threaded"; lastActive: number; timeoutMs: number };
    const chatRoutes = new Map<string, ChatRoute>();
    const defaultTimeoutMs = parseInt(process.env.TG_ROUTE_TIMEOUT_MS || "1800000", 10); // 30 minutes

    const getRoute = (chatId: string): ChatRoute => {
      const r = chatRoutes.get(chatId);
      if (r) return r;
      const created = { participants: ["ceo-strategic"], mode: "single" as const, lastActive: Date.now(), timeoutMs: defaultTimeoutMs };
      chatRoutes.set(chatId, created);
      return created;
    };
    const setRoute = (chatId: string, route: ChatRoute) => { chatRoutes.set(chatId, { ...route, lastActive: Date.now() }); };

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
      
      const message = fmt`${bold("👋 I'm Strategos, your CEO agent.")}

${bold("Core Staff:")}
${staffList}

${bold("Commands:")}
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
      
      await ctx.reply(message);
      const chatId = ctx.chat.id.toString();
      chatAgentMap.set(chatId, "ceo-strategic");
      setRoute(chatId, { participants: ["ceo-strategic"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
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
        
        await ctx.reply(fmt`${bold("🎯 Summon an Agent:")}\n\n${agents}`);
        return;
      }
      
      // Map name to agent ID
      const agentId = getCoreStaffIds().find(id => {
        const s = getStaffById(id);
        return s?.name.toLowerCase().replace(/\s+/g, '-') === agentName || id.toLowerCase().includes(agentName);
      });
      
      if (!agentId) {
        await ctx.reply(fmt`${bold("❌ Agent not found.")} Try /agent to see available agents.`);
        return;
      }
      
      chatAgentMap.set(ctx.chat.id.toString(), agentId);
      setRoute(ctx.chat.id.toString(), { participants: [agentId], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
      const staff = getStaffById(agentId);
      await ctx.reply(fmt`${bold(`✅ Now speaking with ${staff?.avatar} ${staff?.name}`)}\n\n${staff?.title || "Agent"}\n\nAsk me anything or give me tasks.`);
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
        await ctx.reply(bold("🛑 Meeting ended. Back to Strategos."));
        return;
      }
      const wanted = args.map((a: string) => a.toLowerCase());
      const ids = getCoreStaffIds().filter(id => {
        const s = getStaffById(id);
        if (!s) return false;
        const key = s.name.toLowerCase().replace(/\s+/g, '-');
        return wanted.includes(key) || wanted.includes(id.toLowerCase());
      });
      if (ids.length === 0) { await ctx.reply(bold("❌ No valid agents found")); return; }
      setRoute(chatId, { participants: ids, mode: "meeting", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
      const names = ids.map(id => getStaffById(id)?.name || id).join(", ");
      await ctx.reply(fmt`${bold("🏛 Boardroom meeting active with:")} ${names}`);
    });

    // /org command
    bot.command("org", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      await ctx.reply(getOrgChart());
    });

    // /staff command
    bot.command("staff", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      
      const staff = getCoreStaffIds().map(id => {
        const s = getStaffById(id);
        if (!s) return "";
        return fmt`${s.avatar} ${bold(s.name)} — ${s.title}
   ├─ Level ${s.autonomyLevel} | Board: ${s.boardSeat ? "Yes" : "No"}
   └─ Reports: ${s.reportsTo || "CEO"}`;
      }).filter(Boolean).join("\n\n");
      
      await ctx.reply(fmt`${bold("Core Staff:")}\n\n${staff}`);
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
      
      await ctx.reply(fmt`${bold("🤖 All Agents:")}\n\n${list}`);
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
        const formatted = contextManager.formatWakeContext(context);
        await ctx.reply(formatted);
      } catch (err: any) {
        await ctx.reply(fmt`${bold("❌ Error:")} ${err.message}`);
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
        
        const lines = threads.map(t => {
          const other = t.participants.find(p => p !== agentId) || "unknown";
          const ts = new Date(t.updated_at).toISOString().slice(0, 16);
          return fmt`• ${bold(t.subject)} (with ${other})\n  _${ts}_`;
        });
        
        await ctx.reply(fmt`${bold(`📬 Messages for ${agentId} (${threads.length})`)}\n\n${join(lines, "\n")}`);
      } catch (err: any) {
        await ctx.reply(fmt`${bold("❌ Error:")} ${err.message}`);
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
          await ctx.reply(fmt`${bold("🔍 No results for")} "${query}"`);
          return;
        }
        
        const lines = result.results.slice(0, 5).map(r => {
          const icon = r.type === "message" ? "💬" : r.type === "task" ? "📋" : r.type === "memory" ? "🧠" : "🏛";
          return fmt`${icon} ${bold(`[${r.type}]`)} ${r.summary}\n   _Relevance: ${(r.relevance * 100).toFixed(0)}%_`;
        });
        
        await ctx.reply(fmt`${bold(`🔍 Results for "${query}" (${result.total_found} found)`)}\n\n${join(lines, "\n")}`);
      } catch (err: any) {
        await ctx.reply(fmt`${bold("❌ Error:")} ${err.message}`);
      }
    });

    // /help command
    bot.command("help", async (ctx) => {
      const helpText = fmt`${bold("📋 Strategos Help")}

${bold("Organization Commands:")}
/org — Organization chart
/staff — Core staff list
/agents — All agents (core + auxiliary)
/agent [name] — Summon an agent

${bold("Memory & Context:")}
/wake [agent] — View agent's wake context
/messages [agent] — Browse message threads
/recall [query] — Search across all memory

${bold("System Commands:")}
/status — System status
/help — This help message

${bold("Natural Language:")}
Just talk naturally! Examples:
• "Understand my trajectory"
• "Prioritize today"
• "Create a developer agent"
• "Propose a board meeting"`;
      
      await ctx.reply(helpText);
    });

    // /status command
    bot.command("status", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      await ctx.sendChatAction("typing");
      try {
        const runtime = getNativeRuntime();
        const sessions = runtime.listSessions();
        await ctx.reply(fmt`${bold("✅ Strategos System Status")}\n\n• MCP Server: Running\n• Core Staff: 7 agents\n• Memory: Active\n• Telegram: Online\n• Native Runtime: Healthy (${sessions.length} session(s) active)`);
      } catch (err: any) {
        await ctx.reply(fmt`${bold("❌ Error:")} ${err.message}`);
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
        
        const lines = chatSessions.map(s => `• **${s.agent_id}**: \`${s.session_id}\` (${s.message_count} msgs)`);
        await ctx.reply(fmt`${bold("📊 Active Sessions:")}\n\n${join(lines, "\n")}`);
        return;
      }
      
      if (args[0].toLowerCase() === "reset" || args[0].toLowerCase() === "clear") {
        const agentId = args[1];
        if (!agentId) {
          await ctx.reply("Usage: `/session reset [agent]` or `/session clear [agent]`\nExample: `/session reset cfo-financial`\n\n⚠️ This clears the session but keeps LanceDB memory intact.");
          return;
        }
        
        await sessionRegistry.invalidate(agentId, chatId);
        
        await ctx.reply(fmt`${bold("✅ Session cleared for")} **${agentId}**\n\n⚠️ LanceDB memory embeddings are preserved. Only conversation context was reset.`);
        logger.info({ chatId, agentId }, "Session reset via registry");
        return;
      }
      
      await ctx.reply("Usage: `/session` — List sessions\n`/session reset [agent]` — Clear session (memory preserved)");
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
        if (Date.now() - route.lastActive > route.timeoutMs) {
          route = { participants: ["ceo-strategic"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs };
          setRoute(chatId, route);
        }

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
              wakeCtx = contextManager.formatWakeContext(wc);
            } catch (e) { 
              logger.warn({ err: e }, "Failed to build wake context"); 
              wakeCtx = "[No context available]";
            }

            // Get persistent session via registry
            let acpSessionId = await sessionRegistry.getOrCreate(agentId, { chatId });

            // Build delta
            const memoryFacade = await getMemoryFacade();

            // AUTO RECALL: Fetch relevant memories before responding
            const recallText = await autoRecall({
              agentId,
              queryText: text,
              trigger: "user_message",
            });

            const memoryInjection = await memoryFacade.injectForTask(agentId, text);

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
            try {
              logger.info({ agentId, nativeAgentId, sessionId: acpSessionId }, "Sending delta to native runtime...");
              const result = await runtime.sendMessage(acpSessionId, delta, nativeAgentId);
              logger.info({ agentId, textLength: result.text?.length, tokens: result.tokens }, "Native runtime response received");
              reply = result.text || "(empty response)";
            } catch (err: any) {
              logger.error({ agentId, err: err.message }, "Native runtime message failed");
              reply = `(error contacting agent: ${err.message})`;
            }

            // AUTO STORE: Save the conversation turn
            await autoStore({
              agentId,
              inputText: text,
              outputText: reply,
              trigger: "user_message",
              context: {
                threadId: chatId,
              },
            });

            await sessionRegistry.touch(acpSessionId);

            const prefix = getStaffById(agentId)?.avatar ? `${getStaffById(agentId)?.avatar} ${getStaffById(agentId)?.name}` : agentId;
            return `${prefix}:\n${reply}`;
          }));

          // Clear typing indicator
          clearInterval(typingInterval);

          const successful = replies.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
          const failed = replies.filter(r => r.status === "rejected");

          if (failed.length > 0) {
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
        await ctx.reply(fmt`${bold("❌ Unexpected error")} - Please try again`);
      }
    });

    // Launch bot
    logger.info("Telegram bot launching...");
    
    bot.launch().then(() => {
      logger.info({ username: bot.botInfo?.username }, "Telegram bot running");
    }).catch((err: any) => {
      logger.error({ err: err.message }, "Telegram bot error");
    });

    // Send startup message
    try {
      const startupMsg = fmt`${bold("✅ Strategos Bot is ONLINE!")}

${bold("Send /start to begin")}
${bold("Send /agent CFO to summon CFO")}
${bold("Send /help for commands")}

Your AI organization is ready to work!`;
      
      setTelegramBot(bot);
      await bot.telegram.sendMessage(cfg.telegramChatId, startupMsg);
      logger.info("Startup message sent to Telegram");
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
