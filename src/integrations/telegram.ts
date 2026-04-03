import { Telegraf } from "telegraf";
import { fmt, bold, italic, join } from "telegraf/format";
import { logger } from "../logger.js";
import { cfg } from "../config.js";
import type { StrategosRuntime } from "../types.js";
import { getOrgChart, getCoreStaffIds, getStaffById } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { AgentContextManager } from "../organic/context.js";
import { getReportsAndSessions } from "../mcp/tools-reports.js";
import { getOpenCodeClient } from "../acp/opencode-client.js";
import { getPromptForRole } from "../staff/prompts.js";

type AgentRegistry = { agents: Map<string, { id: string; role: string; boardId: string }>; cards: Map<string, string> };

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
    const rs = await getReportsAndSessions();
    
    logger.info({ chatId: cfg.telegramChatId }, "Telegram starting...");

    // Current agent per chat (legacy single-agent mapping)
    const chatAgentMap = new Map<string, string>();
    // Router: active participants per chat (single, meeting, or threaded)
    type ChatRoute = { participants: string[]; mode: "single"|"meeting"|"threaded"; lastActive: number; timeoutMs: number };
    const chatRoutes = new Map<string, ChatRoute>();
    const defaultTimeoutMs = parseInt(process.env.TG_ROUTE_TIMEOUT_MS || "1800000", 10); // 30 minutes
    // OpenCode session cache per chat per agent
    const ocSessions = new Map<string, Map<string, string>>(); // chatId -> (agentId -> ocSessionId)

    // Start OpenCode client
    const acp = getOpenCodeClient();
    await acp.start(process.cwd());
    logger.info("OpenCode client started");

    const getRoute = (chatId: string): ChatRoute => {
      const r = chatRoutes.get(chatId);
      if (r) return r;
      const created = { participants: ["strategos"], mode: "single" as const, lastActive: Date.now(), timeoutMs: defaultTimeoutMs };
      chatRoutes.set(chatId, created);
      return created;
    };
    const setRoute = (chatId: string, route: ChatRoute) => { chatRoutes.set(chatId, { ...route, lastActive: Date.now() }); };
    
    const ensureAcPSession = async (chatId: string, agentId: string): Promise<string> => {
      // In-memory cache only (no persistence - forces fresh prompts on restart)
      let m = ocSessions.get(chatId);
      if (!m) { m = new Map(); ocSessions.set(chatId, m); }
      const cached = m.get(agentId);
      if (cached) return cached;
      
      // Create new OpenCode session
      const acp = getOpenCodeClient();
      const sessionId = await acp.createSession(process.cwd());
      
      m.set(agentId, sessionId);
      
      logger.info({ chatId, agentId, sessionId }, "Created new OpenCode session");
      return sessionId;
    };

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
      chatAgentMap.set(chatId, "strategos");
      setRoute(chatId, { participants: ["strategos"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
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
        setRoute(chatId, { participants: ["strategos"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs });
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
      const agentId = args[1] || "strategos";
      
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
        const result = await contextManager.recall({ agent_id: "strategos", query, top_k: 10 });
        
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
        const acp = getOpenCodeClient();
        const connected = acp.isConnected();
        await ctx.reply(fmt`${bold("✅ Strategos System Status")}\n\n• MCP Server: Running\n• Core Staff: 7 agents\n• Memory: Active\n• Telegram: Online\n• OpenCode Client: ${connected ? "Connected" : "Disconnected"}`);
      } catch (err: any) {
        await ctx.reply(fmt`${bold("❌ Error:")} ${err.message}`);
      }
    });

    // /session command - manage ACP sessions
    bot.command("session", async (ctx) => {
      if (ctx.chat.id.toString() !== cfg.telegramChatId) return;
      const args = (ctx.message as any)?.text?.split(/\s+/).slice(1) || [];
      const chatId = ctx.chat.id.toString();
      
      if (args.length === 0) {
        // Show current sessions
        const rs = await getReportsAndSessions();
        const allSessions: any[] = [];
        for (const agentId of getCoreStaffIds()) {
          const sessionId = await rs.getOcSession(chatId, agentId);
          if (sessionId) {
            allSessions.push({ agent: agentId, session: sessionId });
          }
        }
        
        if (allSessions.length === 0) {
          await ctx.reply("📭 No active sessions. Send a message to create one.");
          return;
        }
        
        const lines = allSessions.map(s => `• **${s.agent}**: \`${s.session}\``);
        await ctx.reply(fmt`${bold("📊 Active Sessions:")}\n\n${join(lines, "\n")}`);
        return;
      }
      
      if (args[0].toLowerCase() === "reset" || args[0].toLowerCase() === "clear") {
        const agentId = args[1];
        if (!agentId) {
          await ctx.reply("Usage: `/session reset [agent]` or `/session clear [agent]`\nExample: `/session reset cfo-financial`\n\n⚠️ This clears the ACP session but keeps LanceDB memory intact.");
          return;
        }
        
        const rs = await getReportsAndSessions();
        const sessionId = await rs.getOcSession(chatId, agentId);
        
        if (!sessionId) {
          await ctx.reply(`No session found for ${agentId}`);
          return;
        }
        
        // Remove from database (LanceDB embeddings remain untouched)
        const db = (rs as any).db;
        if (db) {
          db.run("DELETE FROM oc_sessions WHERE chat_id = ? AND agent_id = ?", [chatId, agentId]);
          await (rs as any).persist();
        }
        
        // Remove from cache
        const m = ocSessions.get(chatId);
        if (m) m.delete(agentId);
        
        await ctx.reply(fmt`${bold("✅ Session cleared for")} **${agentId}**\n\nSession ID: \`${sessionId}\`\n\n⚠️ LanceDB memory embeddings are preserved. Only ACP conversation context was reset.`);
        logger.info({ chatId, agentId, sessionId }, "Session reset");
        return;
      }
      
      await ctx.reply("Usage: `/session` — List sessions\n`/session reset [agent]` — Clear session (memory preserved)");
    });

    // Natural language messages - route to OpenCode ACP via stdio
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
          route = { participants: ["strategos"], mode: "single", lastActive: Date.now(), timeoutMs: defaultTimeoutMs };
          setRoute(chatId, route);
        }

        const rs = await getReportsAndSessions();
        const acp = getOpenCodeClient();

        // Keep typing indicator active during processing
        const typingInterval = setInterval(() => {
          ctx.sendChatAction("typing").catch(() => {});
        }, 5000);

        try {
          // Fan-out to all participants concurrently
          const replies = await Promise.all(route.participants.map(async (agentId) => {
            // Wake context per agent
            let wakeCtx = "";
            try {
              const wc = await contextManager.getWakeContext(agentId);
              wakeCtx = contextManager.formatWakeContext(wc);
            } catch (e) { 
              logger.warn({ err: e }, "Failed to build wake context"); 
              wakeCtx = "[No context available]";
            }

            // Proactive memory recall based on actual user message
            let relevantMemory = "";
            try {
              const recall = await contextManager.recall({
                agent_id: agentId,
                query: text,
                top_k: 5
              });
              if (recall && recall.results && recall.results.length > 0) {
                relevantMemory = "\n### Relevant Memory\n" + recall.results.map((r: any) => 
                  `• [${r.type}] ${r.summary} (relevance: ${(r.relevance * 100).toFixed(0)}%)`
                ).join("\n");
                logger.info({ agentId, memoryCount: recall.results.length }, "Proactive memory recall");
              }
            } catch (e) {
              logger.warn({ err: e, agentId }, "Memory recall failed");
            }

            // Ensure persistent OpenCode session per chat+agent
            const acpSessionId = await ensureAcPSession(chatId, agentId);
            
            // Get agent's system prompt
            const promptData = getPromptForRole(agentId);
            const systemPrompt = promptData ? promptData.prompt : "You are a helpful AI assistant.";
            
            // Build prompt with system prompt, context, and user message
            const prompt = `${systemPrompt}

---

[Current Session]
Agent: ${agentId}
Chat: ${chatId}
Mode: ${route.mode}

[Context]
${wakeCtx}
${relevantMemory}
[/Context]

[User Message]
${text}
[/User Message]

---

Remember: Be conversational, not report-style. Keep it brief and helpful.`;

            // Send message via OpenCode
            let reply = "(no reply)";
            try {
              logger.info({ agentId, sessionId: acpSessionId }, "Sending message to OpenCode...");
              const result = await acp.sendMessage(acpSessionId, prompt, process.cwd());
              logger.info({ agentId, textLength: result.text?.length, tokens: result.tokens }, "OpenCode response received");
              reply = result.text || "(empty response)";
            } catch (err: any) {
              logger.error({ agentId, err: err.message, stack: err.stack }, "OpenCode message failed");
              reply = `(error contacting agent: ${err.message})`;
            }

            // Log session per agent
            try {
              const dbSession = await rs.createSession(agentId, chatId);
              await rs.logStep({ session_id: dbSession.id, step_num: 1, step_type: "final", obs_summary: reply.slice(0, 500) });
            } catch (e) {
              logger.warn({ err: e }, "Failed to log session step");
            }

            const prefix = getStaffById(agentId)?.avatar ? `${getStaffById(agentId)?.avatar} ${getStaffById(agentId)?.name}` : agentId;
            return `${prefix}:\n${reply}`;
          }));

          // Clear typing indicator
          clearInterval(typingInterval);

          const combined = replies.join("\n\n");
          logger.info({ textLength: combined.length }, "Sending reply to Telegram...");
          
          // Use Telegram Markdown v2 for formatting
          await ctx.reply(combined, { parse_mode: "Markdown" });
          logger.info("Reply sent successfully");
        } catch (err: any) {
          clearInterval(typingInterval);
          logger.error({ err: err.message, stack: err.stack }, "Failed to process message");
          const errorMsg = `❌ *Error processing your message*\n\n\`${err.message}\`\n\nPlease try again or use /help for commands.`;
          await ctx.reply(errorMsg, { parse_mode: "Markdown" });
        }
      } catch (err: any) {
        logger.error({ err: err.message, stack: err.stack }, "Unexpected error in message handler");
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

    // Graceful shutdown
    process.once("SIGINT", () => {
      logger.info("SIGINT received, stopping bot...");
      bot.stop("SIGINT");
    });
    process.once("SIGTERM", () => {
      logger.info("SIGTERM received, stopping bot...");
      bot.stop("SIGTERM");
    });

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
    // Escape markdown if text contains raw formatting
    const formattedText = text.includes("```") || text.includes("##") ? text : text;
    await telegramBot.telegram.sendMessage(cfg.telegramChatId, formattedText, { 
      parse_mode: "Markdown",
      disable_notification: priority === "info"
    });
    logger.info({ text: text.substring(0, 50), priority }, "Telegram notification sent");
    return true;
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to send Telegram notification");
    return false;
  }
}
