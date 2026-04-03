import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { logger } from "../logger.js";
import { Memory } from "../memory/lancedb.js";
import { Kanban } from "../kanban/sqlite.js";
import type { StrategosRuntime, ToolExecutor } from "../types.js";
import { v4 as uuidv4 } from "uuid";
import { CORE_STAFF_ROLES, getCoreStaffIds, getOrgChart, getStaffById, getDirectReports } from "../staff/core-staff.js";
import { lifeos, LIFEOS_DATABASES, getAllDatabases } from "../lifeos/client.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { getReportsAndSessions } from "./tools-reports.js";
import { getMeetingGovernance } from "../organic/meetings.js";
import { getHiringSystem } from "../organic/hiring.js";
import { AgentContextManager } from "../organic/context.js";
import { sendTelegramMessage } from "../integrations/telegram.js";

type ToolResult = { content: Array<{ type: "text"; text: string }> };
const ok = (text: string): ToolResult => ({ content: [{ type: "text" as const, text }] });

const toolImpls: Record<string, (args: any) => Promise<ToolResult>> = {};

async function initializeCoreStaff(kanban: Kanban, memory: Memory) {
  logger.info("Initializing core staff...");
  for (const [id, role] of Object.entries(CORE_STAFF_ROLES)) {
    try {
      await kanban.ensureBoard(id, role.name);
      await memory.ensureAgent(id);
      logger.info({ id, role: role.title }, "Core staff initialized");
    } catch (err: any) {
      logger.error({ id, err: err.message }, "Failed to initialize staff");
    }
  }
  logger.info(`Core staff initialized: ${getCoreStaffIds().length} agents`);
}

export async function startStrategos(): Promise<StrategosRuntime> {
  const server = new McpServer({ name: "strategos", version: "0.1.0" }, { capabilities: { logging: {} } });
  const memory = await Memory.init(process.env.LANCEDB_DIR || ".lancedb");
  const kanban = await Kanban.init(process.env.KANBAN_DB || "kanban.db");
  const messaging = await getMessagingSystem();
  const meetings = getMeetingGovernance();
  const hiring = getHiringSystem();
  const contextManager = new AgentContextManager(kanban, memory);

  await initializeCoreStaff(kanban, memory);

  // === AGENT MANAGEMENT TOOLS ===
  
  const agentCreate = async (args: any): Promise<ToolResult> => {
    const agentId = uuidv4();
    await kanban.ensureBoard(agentId, args.name);
    await memory.ensureAgent(agentId);
    logger.info({ agentId, name: args.name }, "Agent created");
    return ok(agentId);
  };
  toolImpls["agent.create"] = agentCreate;
  server.registerTool("agent.create", { description: "Create new agent", inputSchema: z.object({ name: z.string(), role: z.string().optional(), model: z.string().optional(), tools: z.array(z.string()).optional() }) }, agentCreate);

  const agentSpawn = async (args: any): Promise<ToolResult> => {
    logger.info({ agent_id: args.agent_id, task: args.task }, "Spawn");
    return ok(`Agent ${args.agent_id} spawned`);
  };
  toolImpls["agent.spawn"] = agentSpawn;
  server.registerTool("agent.spawn", { description: "Spawn sub-agent", inputSchema: z.object({ agent_id: z.string(), role: z.string(), project_dir: z.string(), task: z.string() }) }, agentSpawn);

  // === AGENT COMMUNICATION TOOLS ===
  
  const agentCall = async (args: any): Promise<ToolResult> => {
    const { from_agent, to_agent, message, priority = "P3", requires_response = false } = args;
    
    if (!to_agent) {
      return ok("❌ Error: to_agent is required");
    }
    
    const staff = getStaffById(to_agent);
    if (!staff) {
      return ok(`❌ Agent "${to_agent}" not found. Use org.chart to see available agents.`);
    }
    
    try {
      await messaging.send({
        from: from_agent,
        to: to_agent,
        content: message,
        priority: priority,
        requires_response: requires_response,
        subject: message.slice(0, 50),
        tags: ["agent-call"]
      });
      
      logger.info({ from: from_agent, to: to_agent, priority }, "Agent call made");
      return ok(`✅ Message sent to **${staff.avatar} ${staff.name}**\n\nPriority: ${priority}\nResponse required: ${requires_response ? "Yes" : "No"}`);
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to call agent");
      return ok(`❌ Failed to contact ${to_agent}: ${err.message}`);
    }
  };
  toolImpls["agent.call"] = agentCall;
  server.registerTool("agent.call", { 
    description: "Call another agent (send message, optional response)", 
    inputSchema: z.object({ 
      from_agent: z.string().describe("Your agent ID"),
      to_agent: z.string().describe("Agent to call"),
      message: z.string().describe("Message content"),
      priority: z.enum(["P1", "P2", "P3", "P4"]).optional().describe("P1=critical, P4=low"),
      requires_response: z.boolean().optional().describe("Whether response is required")
    }) 
  }, agentCall);

  const agentHandoff = async (args: any): Promise<ToolResult> => {
    const { from_agent, to_agent, context, conversation_id } = args;
    
    if (!to_agent || !context) {
      return ok("❌ Error: to_agent and context are required");
    }
    
    const fromStaff = getStaffById(from_agent);
    const toStaff = getStaffById(to_agent);
    
    if (!toStaff) {
      return ok(`❌ Agent "${to_agent}" not found.`);
    }
    
    try {
      await messaging.send({
        from: from_agent,
        to: to_agent,
        content: `🔄 **HANDOFF**\n\nFrom: ${fromStaff?.name || from_agent}\n\nContext:\n${context}`,
        priority: "P2",
        requires_response: true,
        subject: `Handoff from ${from_agent}`,
        tags: ["handoff", "agent-transfer"]
      });
      
      logger.info({ from: from_agent, to: to_agent, conversation_id }, "Agent handoff completed");
      return ok(`✅ Conversation handed off to **${toStaff.avatar} ${toStaff.name}**\n\nThey now have full context and will continue the conversation.`);
    } catch (err: any) {
      logger.error({ err: err.message }, "Handoff failed");
      return ok(`❌ Handoff failed: ${err.message}`);
    }
  };
  toolImpls["agent.handoff"] = agentHandoff;
  server.registerTool("agent.handoff", { 
    description: "Handoff conversation to another agent (they take over)", 
    inputSchema: z.object({ 
      from_agent: z.string().describe("Your agent ID"),
      to_agent: z.string().describe("Agent to handoff to"),
      context: z.string().describe("Conversation context and summary"),
      conversation_id: z.string().optional().describe("Optional conversation/thread ID")
    }) 
  }, agentHandoff);

  const agentMeeting = async (args: any): Promise<ToolResult> => {
    const { from_agent, participants, topic, urgency = "normal" } = args;
    
    if (!participants || participants.length === 0) {
      return ok("❌ Error: participants array is required");
    }
    
    const validParticipants = participants.filter((id: string) => getStaffById(id));
    if (validParticipants.length === 0) {
      return ok("❌ No valid agents found in participants list");
    }
    
    try {
      // Send meeting request to all participants
      const promises = validParticipants.map(async (agentId: string) => {
        const staff = getStaffById(agentId);
        await messaging.send({
          from: from_agent,
          to: agentId,
          content: `🏛 **BOARD MEETING CALLED**\n\nCalled by: ${getStaffById(from_agent)?.name || from_agent}\n\nTopic: ${topic}\nUrgency: ${urgency}\n\nPlease respond with your input.`,
          priority: urgency === "urgent" ? "P1" : "P2",
          requires_response: true,
          subject: `Meeting: ${topic}`,
          tags: ["meeting", "board"]
        });
      });
      
      await Promise.all(promises);
      
      logger.info({ caller: from_agent, participants: validParticipants, topic }, "Board meeting called");
      
      const names = validParticipants.map((id: string) => {
        const s = getStaffById(id);
        return s ? `${s.avatar} ${s.name}` : id;
      }).join(", ");
      
      return ok(`🏛 **Board Meeting Called**\n\nTopic: ${topic}\nUrgency: ${urgency}\n\nParticipants:\n${names}\n\nAll agents have been notified and will respond.`);
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to call meeting");
      return ok(`❌ Failed to call meeting: ${err.message}`);
    }
  };
  toolImpls["agent.meeting"] = agentMeeting;
  server.registerTool("agent.meeting", { 
    description: "Call a board meeting with multiple agents", 
    inputSchema: z.object({ 
      from_agent: z.string().describe("Your agent ID (caller)"),
      participants: z.array(z.string()).describe("List of agent IDs to invite"),
      topic: z.string().describe("Meeting topic"),
      urgency: z.enum(["normal", "urgent"]).optional().describe("Meeting urgency")
    }) 
  }, agentMeeting);

  // === CONTEXT & RECALL TOOLS ===

  const agentWake = async (args: any): Promise<ToolResult> => {
    const context = await contextManager.getWakeContext(args.agent_id);
    const formatted = contextManager.formatWakeContext(context);
    return ok(formatted);
  };
  toolImpls["agent.wake"] = agentWake;
  server.registerTool("agent.wake", { 
    description: "Get wake-up context for agent (inject on activation)", 
    inputSchema: z.object({ agent_id: z.string() }) 
  }, agentWake);

  const memoryRecall = async (args: any): Promise<ToolResult> => {
    const result = await contextManager.recall({
      agent_id: args.agent_id,
      query: args.query,
      top_k: args.top_k || 10
    });
    
    const lines: string[] = [`🔍 **Search: "${args.query}"** (${result.total_found} results)\n`];
    for (const r of result.results) {
      const icon = r.type === "message" ? "💬" : r.type === "task" ? "📋" : r.type === "memory" ? "🧠" : "🏛";
      lines.push(`${icon} **[${r.type}]** ${r.summary}`);
      lines.push(`   Relevance: ${(r.relevance * 100).toFixed(0)}% | ID: ${r.id}`);
    }
    return ok(lines.join("\n"));
  };
  toolImpls["memory.recall"] = memoryRecall;
  server.registerTool("memory.recall", { 
    description: "Search across messages, tasks, and memory", 
    inputSchema: z.object({ 
      agent_id: z.string(), 
      query: z.string(), 
      top_k: z.number().optional() 
    }) 
  }, memoryRecall);

  const messageGetThread = async (args: any): Promise<ToolResult> => {
    const thread = await contextManager.getFullThread(args.thread_id);
    if (!thread) return ok(`Thread ${args.thread_id} not found`);
    
    const lines: string[] = [`💬 **Thread: ${thread.subject}**\n`];
    for (const msg of [] as any[]) {
      const ts = new Date(msg.created_at).toISOString().slice(0, 16);
      const respondedFlag = msg.responded ? " ✅" : msg.requires_response ? " ⏳" : "";
      lines.push(`[${ts}] **${msg.from}** → ${msg.to}${respondedFlag}`);
      lines.push(`   ${msg.content}`);
    }
    return ok(lines.join("\n"));
  };
  toolImpls["message.getThread"] = messageGetThread;
  server.registerTool("message.getThread", { 
    description: "Read full message thread (like checking phone)", 
    inputSchema: z.object({ thread_id: z.string() }) 
  }, messageGetThread);

  const taskGet = async (args: any): Promise<ToolResult> => {
    const card = await contextManager.getFullTask(args.card_id);
    if (!card) return ok(`Task ${args.card_id} not found`);
    
    const lines: string[] = [
      `📋 **${card.title}**`,
      `Status: ${card.status}`,
      `Priority: ${card.priority}`,
      card.due ? `Due: ${card.due}` : "",
      `Description: ${card.description}`,
      card.tags?.length ? `Tags: ${card.tags.join(", ")}` : ""
    ];
    return ok(lines.filter(Boolean).join("\n"));
  };
  toolImpls["task.get"] = taskGet;
  server.registerTool("task.get", { 
    description: "Get full task details", 
    inputSchema: z.object({ card_id: z.string() }) 
  }, taskGet);

  // === ORGANIZATION TOOLS ===
  
  const orgChart = async (): Promise<ToolResult> => ok(getOrgChart());
  toolImpls["org.chart"] = orgChart;
  server.registerTool("org.chart", { description: "Show organization chart", inputSchema: z.object({}) }, orgChart);

  const staffList = async (): Promise<ToolResult> => {
    const staff = getCoreStaffIds().map(id => { const s = getStaffById(id); return s ? `${s.avatar} ${s.name} — ${s.title}` : ""; }).filter(Boolean).join("\n");
    return ok(`**Core Staff:**\n\n${staff}`);
  };
  toolImpls["staff.list"] = staffList;
  server.registerTool("staff.list", { description: "List core staff", inputSchema: z.object({}) }, staffList);

  const staffGet = async (args: any): Promise<ToolResult> => {
    const staff = getStaffById(args.id);
    if (!staff) return ok(`Staff "${args.id}" not found`);
    return ok(`${staff.avatar} **${staff.name}** — ${staff.title}\n\nAutonomy: Level ${staff.autonomyLevel}\nBoard Seat: ${staff.boardSeat ? "Yes" : "No"}\nReports To: ${staff.reportsTo || "CEO"}\n\nDatabases:\n${staff.databases.join("\n")}\n\nKanban Columns:\n${staff.kanbanColumns.join(" → ")}`);
  };
  toolImpls["staff.get"] = staffGet;
  server.registerTool("staff.get", { description: "Get staff details", inputSchema: z.object({ id: z.string() }) }, staffGet);

  // === MEMORY TOOLS ===
  
  const memoryUpsert = async (args: any): Promise<ToolResult> => {
    const id = await memory.upsertEvent({ ...args });
    return ok(id);
  };
  toolImpls["memory.upsert"] = memoryUpsert;
  server.registerTool("memory.upsert", { description: "Save memory", inputSchema: z.object({ agent_id: z.string(), type: z.enum(["note","obs","io","log"]), content: z.string(), importance: z.number().min(0).max(1).optional(), tags: z.array(z.string()).optional() }) }, memoryUpsert);

  const memorySearch = async (args: any): Promise<ToolResult> => {
    const items = await memory.search(args.agent_id, args.query, args.top_k || 5);
    return ok(JSON.stringify(items, null, 2));
  };
  toolImpls["memory.search"] = memorySearch;
  server.registerTool("memory.search", { description: "Search LanceDB memory", inputSchema: z.object({ agent_id: z.string(), query: z.string(), top_k: z.number().optional() }) }, memorySearch);

  // === KANBAN TOOLS ===
  
  const boardAddCard = async (args: any): Promise<ToolResult> => {
    const cardId = await kanban.addCard(args.agent_id, args.title, args.description || "", args.priority || "P3", args.due || null, args.tags || []);
    await memory.upsertEvent({ agent_id: args.agent_id, type: "note", content: `Task: ${args.title}`, importance: 0.5, tags: ["kanban","create"] });
    logger.info({ cardId, title: args.title }, "Card added");
    return ok(cardId);
  };
  toolImpls["board.addCard"] = boardAddCard;
  server.registerTool("board.addCard", { description: "Add Kanban task", inputSchema: z.object({ agent_id: z.string(), title: z.string(), description: z.string().optional(), priority: z.string().optional(), due: z.string().optional(), tags: z.array(z.string()).optional() }) }, boardAddCard);

  const boardMoveCard = async (args: any): Promise<ToolResult> => {
    await kanban.moveCard(args.card_id, args.status);
    logger.info({ card_id: args.card_id, status: args.status }, "Card moved");
    return ok("ok");
  };
  toolImpls["board.moveCard"] = boardMoveCard;
  server.registerTool("board.moveCard", { description: "Move card", inputSchema: z.object({ card_id: z.string(), status: z.enum(["Backlog","Todo","In Progress","Blocked","Review","Done"]) }) }, boardMoveCard);

  const boardGet = async (args: any): Promise<ToolResult> => {
    const board = await kanban.getBoard(args.agent_id);
    if (!board) return ok(`Board not found for agent ${args.agent_id}`);
    
    const lines: string[] = [`📋 **${board.name}'s Board**\n`];
    for (const col of board.columns) {
      lines.push(`**${col.name}** (${col.cards.length})`);
      for (const card of col.cards.slice(0, 5)) {
        lines.push(`  • ${card.title} [${card.priority}]${card.due ? ` (due: ${card.due})` : ""}`);
      }
      if (col.cards.length > 5) lines.push(`  ... and ${col.cards.length - 5} more`);
    }
    return ok(lines.join("\n"));
  };
  toolImpls["board.get"] = boardGet;
  server.registerTool("board.get", { description: "Get Kanban board", inputSchema: z.object({ agent_id: z.string() }) }, boardGet);

  const boardViewReports = async (args: any): Promise<ToolResult> => {
    const managerId = args.manager_id;
    const manager = getStaffById(managerId);
    if (!manager) return ok(`Manager ${managerId} not found`);

    const reports = await kanban.viewReportsBoard(managerId);
    if (reports.length === 0) {
      return ok(`${manager.name} has no direct reports with boards.`);
    }

    const lines: string[] = [`👥 **${manager.name}'s Team Boards**\n`];
    for (const { agent_id, board } of reports) {
      const report = getStaffById(agent_id);
      const totalCards = board.columns.reduce((sum, c) => sum + c.cards.length, 0);
      lines.push(`**${report?.name || agent_id}** (${totalCards} cards)`);
      if (totalCards > 0) {
        const inProgress = board.columns.find(c => c.name === "In Progress")?.cards.length || 0;
        const blocked = board.columns.find(c => c.name === "Blocked")?.cards.length || 0;
        lines.push(`  └─ In Progress: ${inProgress}, Blocked: ${blocked}`);
      }
    }
    return ok(lines.join("\n"));
  };
  toolImpls["board.viewReports"] = boardViewReports;
  server.registerTool("board.viewReports", { description: "Manager view of all reports' boards", inputSchema: z.object({ manager_id: z.string() }) }, boardViewReports);

  const boardReassign = async (args: any): Promise<ToolResult> => {
    await kanban.reassignCard(args.card_id, args.from_agent_id, args.to_agent_id, args.manager_id);
    return ok(`Card reassigned from ${args.from_agent_id} to ${args.to_agent_id}`);
  };
  toolImpls["board.reassign"] = boardReassign;
  server.registerTool("board.reassign", { 
    description: "Manager reassign card between reports", 
    inputSchema: z.object({ 
      card_id: z.string(), 
      from_agent_id: z.string(), 
      to_agent_id: z.string(),
      manager_id: z.string().describe("Manager ID performing the reassignment")
    }) 
  }, boardReassign);

  const boardEscalate = async (args: any): Promise<ToolResult> => {
    await kanban.escalateCard(args.card_id, args.to_manager_id, args.reason);
    return ok(`Card escalated to ${args.to_manager_id}: ${args.reason}`);
  };
  toolImpls["board.escalate"] = boardEscalate;
  server.registerTool("board.escalate", { description: "Escalate blocked card to manager", inputSchema: z.object({ card_id: z.string(), to_manager_id: z.string(), reason: z.string() }) }, boardEscalate);

  // === MESSAGING TOOLS ===

  const messageSend = async (args: any): Promise<ToolResult> => {
    const thread = await messaging.send({
      from: args.from,
      to: args.to,
      content: args.content,
      priority: args.priority || "P3",
      requires_response: args.requires_response || false,
      subject: args.subject,
      tags: args.tags
    });
    return ok(`Message sent to ${args.to}. Thread ID: ${thread.id}`);
  };
  toolImpls["message.send"] = messageSend;
  server.registerTool("message.send", { 
    description: "Send message to another agent", 
    inputSchema: z.object({ 
      from: z.string(), 
      to: z.string(), 
      content: z.string(), 
      priority: z.enum(["P1", "P2", "P3", "P4"]).optional(),
      requires_response: z.boolean().optional(),
      subject: z.string().optional(),
      tags: z.array(z.string()).optional()
    }) 
  }, messageSend);

  const messageReply = async (args: any): Promise<ToolResult> => {
    const thread = await messaging.reply({
      thread_id: args.thread_id,
      from: args.from,
      content: args.content,
      requires_response: args.requires_response || false,
      tags: args.tags
    });
    return ok(`Reply sent. Thread updated: ${thread.id}`);
  };
  toolImpls["message.reply"] = messageReply;
  server.registerTool("message.reply", { 
    description: "Reply to message thread", 
    inputSchema: z.object({ 
      thread_id: z.string(), 
      from: z.string(), 
      content: z.string(),
      requires_response: z.boolean().optional(),
      tags: z.array(z.string()).optional()
    }) 
  }, messageReply);

  const messageSearch = async (args: any): Promise<ToolResult> => {
    const results = await messaging.searchMessages({
      agent_id: args.agent_id,
      query: args.query,
      top_k: args.top_k || 10,
      from_agent: args.from_agent,
      priority: args.priority,
      date_from: args.date_from,
      date_to: args.date_to
    });
    
    const lines: string[] = [`🔍 **Messages for ${args.agent_id}** (${results.length} results)\n`];
    for (const r of results) {
      lines.push(`[${r.message.priority}] ${r.message.from} → ${r.message.to}`);
      lines.push(`   "${r.snippet}"`);
      lines.push(`   Thread: ${r.thread.id} | Score: ${(r.relevance_score * 100).toFixed(0)}%\n`);
    }
    return ok(lines.join("\n"));
  };
  toolImpls["message.search"] = messageSearch;
  server.registerTool("message.search", { 
    description: "Search message history with semantic search", 
    inputSchema: z.object({ 
      agent_id: z.string(), 
      query: z.string(), 
      top_k: z.number().optional(),
      from_agent: z.string().optional(),
      priority: z.enum(["P1", "P2", "P3", "P4"]).optional(),
      date_from: z.number().optional(),
      date_to: z.number().optional()
    }) 
  }, messageSearch);

  const messageGetThreads = async (args: any): Promise<ToolResult> => {
    const threads = await messaging.getThreadsForAgent(args.agent_id, args.limit || 20);
    const lines: string[] = [`📬 **Threads for ${args.agent_id}** (${threads.length})\n`];
    for (const thread of threads) {
      const other = thread.participants.find(p => p !== args.agent_id);
      const unread = 0; // thread.messages not available, simplified(m => m.to === args.agent_id && !m.read).length || 0;
      lines.push(`• ${thread.subject} (with ${other}) - ${new Date(thread.updated_at).toISOString().slice(0, 16)}${unread > 0 ? ` 🔴 ${unread} unread` : ""}`);
    }
    return ok(lines.join("\n"));
  };
  toolImpls["message.getThreads"] = messageGetThreads;
  server.registerTool("message.getThreads", { description: "Get all threads for agent", inputSchema: z.object({ agent_id: z.string(), limit: z.number().optional() }) }, messageGetThreads);

  const messageMarkRead = async (args: any): Promise<ToolResult> => {
    await messaging.markAsRead(args.agent_id, args.thread_id);
    return ok("Messages marked as read");
  };
  toolImpls["message.markRead"] = messageMarkRead;
  server.registerTool("message.markRead", { 
    description: "Mark messages as read", 
    inputSchema: z.object({ agent_id: z.string(), thread_id: z.string().optional() }) 
  }, messageMarkRead);

  const messageEscalate = async (args: any): Promise<ToolResult> => {
    const escalation = await messaging.escalate({
      thread_id: args.thread_id,
      from: args.from,
      to: args.to,
      reason: args.reason
    });
    return ok(`Escalated to ${args.to}. Escalation ID: ${escalation.id}`);
  };
  toolImpls["message.escalate"] = messageEscalate;
  server.registerTool("message.escalate", { 
    description: "Escalate thread to superior", 
    inputSchema: z.object({ 
      thread_id: z.string(), 
      from: z.string(), 
      to: z.string(), 
      reason: z.string() 
    }) 
  }, messageEscalate);

  const agentInbox = async (args: any): Promise<ToolResult> => {
    const { agent_id, include_read = false } = args;
    const context = await messaging.getActiveContext(agent_id);
    
    const lines: string[] = [`📬 **Inbox for ${agent_id}**\n`];
    lines.push(`Unread: ${context.unread_count} | Pending Responses: ${context.pending_responses.length}\n`);
    
    if (context.pending_responses.length > 0) {
      lines.push(`**⏳ Requires Response:**`);
      for (const msg of context.pending_responses) {
        const fromStaff = getStaffById(msg.from);
        const fromName = fromStaff ? `${fromStaff.avatar} ${fromStaff.name}` : msg.from;
        lines.push(`- [${msg.priority}] From ${fromName}: ${msg.content.slice(0, 80)}...`);
      }
      lines.push("");
    }
    
    if (context.active_threads.length > 0) {
      lines.push(`**💬 Active Threads:**`);
      for (const thread of context.active_threads.slice(0, 5)) {
        const other = thread.participants.find(p => p !== agent_id);
        const otherStaff = getStaffById(other || "");
        const otherName = otherStaff ? `${otherStaff.avatar} ${otherStaff.name}` : other;
        lines.push(`- ${thread.subject} (with ${otherName})`);
      }
    }
    
    if (context.recent_escalations.length > 0) {
      lines.push(`\n**🔺 Escalations:**`);
      for (const esc of context.recent_escalations) {
        lines.push(`- From ${esc.from}: ${esc.reason.slice(0, 50)}...`);
      }
    }
    
    return ok(lines.join("\n"));
  };
  toolImpls["agent.inbox"] = agentInbox;
  server.registerTool("agent.inbox", {
    description: "View agent's message inbox - unread messages, pending responses, and active threads",
    inputSchema: z.object({
      agent_id: z.string().describe("Agent ID to check inbox for"),
      include_read: z.boolean().optional().default(false)
    })
  }, agentInbox);

  // === MEETING GOVERNANCE TOOLS ===

  const meetingPropose = async (args: any): Promise<ToolResult> => {
    const proposal = await meetings.propose({
      proposer: args.proposer,
      title: args.title,
      reason: args.reason,
      urgency: args.urgency || "P3"
    });
    return ok(`Meeting proposed: ${proposal.id}\nVotes needed: ${proposal.required_votes}/${getCoreStaffIds().length}\nDeadline: ${new Date(proposal.voting_deadline).toISOString()}`);
  };
  toolImpls["meeting.propose"] = meetingPropose;
  server.registerTool("meeting.propose", { 
    description: "Propose board meeting", 
    inputSchema: z.object({ 
      proposer: z.string(), 
      title: z.string(), 
      reason: z.string(), 
      urgency: z.enum(["P1", "P2", "P3", "P4"]).optional() 
    }) 
  }, meetingPropose);

  const meetingVote = async (args: any): Promise<ToolResult> => {
    const result = await meetings.vote({
      meeting_id: args.meeting_id,
      voter: args.voter,
      vote: args.vote
    });
    const yesVotes = Object.values(result.votes).filter(v => v === "yes").length;
    return ok(`Vote recorded. Current: ${yesVotes}/${result.required_votes} yes votes. Status: ${result.status}`);
  };
  toolImpls["meeting.vote"] = meetingVote;
  server.registerTool("meeting.vote", { 
    description: "Vote on meeting proposal", 
    inputSchema: z.object({ 
      meeting_id: z.string(), 
      voter: z.string(), 
      vote: z.enum(["yes", "no", "abstain"]) 
    }) 
  }, meetingVote);

  const meetingGet = async (args: any): Promise<ToolResult> => {
    const proposal = await meetings.getProposal(args.meeting_id);
    if (!proposal) return ok(`Meeting ${args.meeting_id} not found`);
    
    const lines: string[] = [
      `🏛 **${proposal.title}**`,
      `Proposed by: ${proposal.proposer}`,
      `Urgency: ${proposal.urgency}`,
      `Status: ${proposal.status}`,
      `Reason: ${proposal.reason}`,
      `Votes: ${JSON.stringify(proposal.votes)}`,
      `Required: ${proposal.required_votes}`,
      proposal.scheduled_time ? `Scheduled: ${new Date(proposal.scheduled_time).toISOString()}` : ""
    ];
    return ok(lines.filter(Boolean).join("\n"));
  };
  toolImpls["meeting.get"] = meetingGet;
  server.registerTool("meeting.get", { description: "Get meeting proposal", inputSchema: z.object({ meeting_id: z.string() }) }, meetingGet);

  const meetingRecordMinutes = async (args: any): Promise<ToolResult> => {
    const minutes = await meetings.recordMinutes({
      meeting_id: args.meeting_id,
      decisions: args.decisions,
      action_items: args.action_items,
      attendees: args.attendees,
      recorded_by: args.recorded_by
    });
    return ok(`Minutes recorded. ${minutes.decisions.length} decisions, ${minutes.action_items.length} action items.`);
  };
  toolImpls["meeting.recordMinutes"] = meetingRecordMinutes;
  server.registerTool("meeting.recordMinutes", { 
    description: "Record meeting minutes", 
    inputSchema: z.object({ 
      meeting_id: z.string(), 
      decisions: z.array(z.string()), 
      action_items: z.array(z.object({ description: z.string(), assignee: z.string(), due_date: z.string().optional() })), 
      attendees: z.array(z.string()), 
      recorded_by: z.string() 
    }) 
  }, meetingRecordMinutes);

  // === HIRING & DELEGATION TOOLS ===

  const hireCreate = async (args: any): Promise<ToolResult> => {
    const contract = await hiring.create({
      role: args.role,
      reports_to: args.reports_to,
      budget: args.budget,
      tasks: args.tasks
    });
    return ok(`Hired: ${contract.role} (ID: ${contract.agent_id})\nReports to: ${contract.reports_to}`);
  };
  toolImpls["hire.create"] = hireCreate;
  server.registerTool("hire.create", { 
    description: "Hire auxiliary staff", 
    inputSchema: z.object({ 
      role: z.string(), 
      reports_to: z.string(), 
      budget: z.number().optional(), 
      tasks: z.array(z.string()) 
    }) 
  }, hireCreate);

  const hireFire = async (args: any): Promise<ToolResult> => {
    const contract = await hiring.fire({
      agent_id: args.agent_id,
      reason: args.reason
    });
    return ok(`Released: ${contract.role}\nReason: ${contract.termination_reason}`);
  };
  toolImpls["hire.fire"] = hireFire;
  server.registerTool("hire.fire", { 
    description: "Release auxiliary staff", 
    inputSchema: z.object({ 
      agent_id: z.string(), 
      reason: z.string() 
    }) 
  }, hireFire);

  const delegateTo = async (args: any): Promise<ToolResult> => {
    const delegation = await hiring.delegate({
      from: args.from,
      to: args.to,
      task: args.task,
      description: args.description,
      priority: args.priority || "P3",
      deadline: args.deadline
    });
    return ok(`Delegated: ${delegation.task}\nTo: ${delegation.to}\nID: ${delegation.id}`);
  };
  toolImpls["delegate.to"] = delegateTo;
  server.registerTool("delegate.to", { 
    description: "Delegate task to report", 
    inputSchema: z.object({ 
      from: z.string(), 
      to: z.string(), 
      task: z.string(), 
      description: z.string(), 
      priority: z.enum(["P1", "P2", "P3", "P4"]).optional(),
      deadline: z.string().optional() 
    }) 
  }, delegateTo);

  const delegateAccept = async (args: any): Promise<ToolResult> => {
    const delegation = await hiring.acceptDelegation(args.delegation_id);
    return ok(`Delegation accepted: ${delegation.task}`);
  };
  toolImpls["delegate.accept"] = delegateAccept;
  server.registerTool("delegate.accept", { 
    description: "Accept delegated task", 
    inputSchema: z.object({ delegation_id: z.string() }) 
  }, delegateAccept);

  const delegateReject = async (args: any): Promise<ToolResult> => {
    const delegation = await hiring.rejectDelegation(args.delegation_id, args.reason);
    return ok(`Delegation rejected: ${delegation.task}\nReason: ${args.reason}`);
  };
  toolImpls["delegate.reject"] = delegateReject;
  server.registerTool("delegate.reject", { 
    description: "Reject delegated task", 
    inputSchema: z.object({ delegation_id: z.string(), reason: z.string() }) 
  }, delegateReject);

  const delegateUpdate = async (args: any): Promise<ToolResult> => {
    const delegation = await hiring.updateStatus(args.delegation_id, args.status);
    return ok(`Delegation status: ${delegation.status}`);
  };
  toolImpls["delegate.update"] = delegateUpdate;
  server.registerTool("delegate.update", { 
    description: "Update delegation status", 
    inputSchema: z.object({ 
      delegation_id: z.string(), 
      status: z.enum(["pending", "accepted", "in_progress", "blocked", "completed", "rejected"]) 
    }) 
  }, delegateUpdate);

  const delegateGet = async (args: any): Promise<ToolResult> => {
    const delegation = await hiring.getDelegation(args.delegation_id);
    if (!delegation) return ok(`Delegation ${args.delegation_id} not found`);
    
    const lines: string[] = [
      `📋 **${delegation.task}**`,
      `From: ${delegation.from}`,
      `To: ${delegation.to}`,
      `Priority: ${delegation.priority}`,
      `Status: ${delegation.status}`,
      delegation.deadline ? `Deadline: ${delegation.deadline}` : ""
    ];
    return ok(lines.filter(Boolean).join("\n"));
  };
  toolImpls["delegate.get"] = delegateGet;
  server.registerTool("delegate.get", { description: "Get delegation details", inputSchema: z.object({ delegation_id: z.string() }) }, delegateGet);

  const hireGetTeam = async (args: any): Promise<ToolResult> => {
    const contracts = await hiring.getContractsForManager(args.manager_id);
    if (contracts.length === 0) {
      return ok(`${args.manager_id} has no team members.`);
    }
    
    const lines: string[] = [`👥 **Team for ${args.manager_id}**\n`];
    for (const contract of contracts) {
      lines.push(`• ${contract.role} (${contract.agent_id})`);
      lines.push(`  └─ Tasks: ${contract.tasks.join(", ")}`);
    }
    return ok(lines.join("\n"));
  };
  toolImpls["hire.getTeam"] = hireGetTeam;
  server.registerTool("hire.getTeam", { description: "Get manager's team", inputSchema: z.object({ manager_id: z.string() }) }, hireGetTeam);

  // === HEARTBEAT & NOTIFY ===
  
  const heartbeatRun = async (): Promise<ToolResult> => { logger.info("Heartbeat"); return ok("Audit started"); };
  toolImpls["heartbeat.runNow"] = heartbeatRun;
  server.registerTool("heartbeat.runNow", { description: "Trigger audit", inputSchema: z.object({}) }, heartbeatRun);

  const notifyTg = async (args: any): Promise<ToolResult> => {
    const { text, priority = "info" } = args;
    const sent = await sendTelegramMessage(text);
    if (sent) {
      logger.info({ text: text.substring(0, 50), priority }, "Telegram notification sent");
      return ok(`✅ Notification sent to Telegram`);
    } else {
      logger.warn({ text: text.substring(0, 50) }, "Failed to send Telegram notification");
      return ok(`⚠️ Telegram not configured - notification logged only`);
    }
  };
  toolImpls["notify.telegram"] = notifyTg;
  server.registerTool("notify.telegram", { 
    description: "Send proactive notification to user via Telegram. Use for urgent alerts, important findings, or when user action is needed.", 
    inputSchema: z.object({ 
      text: z.string().describe("Notification message"),
      priority: z.enum(["info", "warning", "urgent"]).optional().default("info")
    }) 
  }, notifyTg);

  // === LIFEOS FULL SUITE TOOLS ===
  
  const lifeosQuery = async (args: any): Promise<ToolResult> => {
    const results = await lifeos.query({
      database: args.database,
      filter_property: args.filter_property,
      filter_value: args.filter_value,
      limit: args.limit || 50
    });
    return ok(JSON.stringify(results, null, 2));
  };
  toolImpls["lifeos.query"] = lifeosQuery;
  server.registerTool("lifeos.query", {
    description: "Query any LifeOS database",
    inputSchema: z.object({
      database: z.enum(LIFEOS_DATABASES as unknown as [string, ...string[]]),
      filter_property: z.string().optional(),
      filter_value: z.string().optional(),
      limit: z.number().optional()
    })
  }, lifeosQuery);

  const lifeosFind = async (args: any): Promise<ToolResult> => {
    const results = await lifeos.find({ database: args.database, search: args.search, limit: args.limit || 10 });
    return ok(JSON.stringify(results, null, 2));
  };
  toolImpls["lifeos.find"] = lifeosFind;
  server.registerTool("lifeos.find", {
    description: "Find entries in LifeOS database",
    inputSchema: z.object({ database: z.enum(LIFEOS_DATABASES as unknown as [string, ...string[]]), search: z.string(), limit: z.number().optional() })
  }, lifeosFind);

  const lifeosCreate = async (args: any): Promise<ToolResult> => {
    const result = await lifeos.create({ database: args.database, name: args.name, properties: args.properties });
    return ok(JSON.stringify(result, null, 2));
  };
  toolImpls["lifeos.create"] = lifeosCreate;
  server.registerTool("lifeos.create", {
    description: "Create entry in LifeOS database",
    inputSchema: z.object({ database: z.enum(LIFEOS_DATABASES as unknown as [string, ...string[]]), name: z.string(), properties: z.record(z.unknown()) })
  }, lifeosCreate);

  const lifeosUpdate = async (args: any): Promise<ToolResult> => {
    await lifeos.update({ database: args.database, page_id: args.page_id, properties: args.properties });
    return ok("Updated");
  };
  toolImpls["lifeos.update"] = lifeosUpdate;
  server.registerTool("lifeos.update", {
    description: "Update entry in LifeOS database",
    inputSchema: z.object({ database: z.enum(LIFEOS_DATABASES as unknown as [string, ...string[]]), page_id: z.string(), properties: z.record(z.unknown()) })
  }, lifeosUpdate);

  // Specialized convenience tools
  toolImpls["lifeos.projects.active"] = async (): Promise<ToolResult> => { const r = await lifeos.getActiveProjects(); return ok(JSON.stringify(r, null, 2)); };
  toolImpls["lifeos.goals.quarterly"] = async (): Promise<ToolResult> => { const r = await lifeos.getQuarterlyGoals(); return ok(JSON.stringify(r, null, 2)); };
  toolImpls["lifeos.tasks.active"] = async (): Promise<ToolResult> => { const r = await lifeos.getActiveTasks(); return ok(JSON.stringify(r, null, 2)); };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Strategos MCP running");

  const executor: ToolExecutor = {
    executeTool: async (name, args) => { const impl = toolImpls[name]; if (!impl) throw new Error(`Unknown: ${name}`); return impl(args); }
  };

  // === REPORTS & SESSIONS TOOLS ===
  
  const reportsSave = async (args: any): Promise<ToolResult> => {
    const rs = await getReportsAndSessions();
    const report = await rs.saveReport({
      agent_id: args.agent_id,
      period: args.period,
      summary: args.summary,
      metrics: args.metrics,
      actions: args.actions
    });
    return ok(`Report saved: ${report.id}`);
  };
  toolImpls["reports.save"] = reportsSave;
  server.registerTool("reports.save", {
    description: "Save a report (storage-only)",
    inputSchema: z.object({ agent_id: z.string(), period: z.string(), summary: z.string(), metrics: z.record(z.unknown()).optional(), actions: z.array(z.object({ description: z.string(), assignee: z.string().optional(), due: z.string().optional() })).optional() })
  }, reportsSave);

  const reportsGetLatest = async (args: any): Promise<ToolResult> => {
    const rs = await getReportsAndSessions();
    const reports = await rs.getLatestReports(args.agent_id, args.limit || 5);
    return ok(JSON.stringify(reports, null, 2));
  };
  toolImpls["reports.getLatest"] = reportsGetLatest;
  server.registerTool("reports.getLatest", {
    description: "Get latest reports for agent",
    inputSchema: z.object({ agent_id: z.string(), limit: z.number().optional() })
  }, reportsGetLatest);

  const sessionsCreate = async (args: any): Promise<ToolResult> => {
    const rs = await getReportsAndSessions();
    const session = await rs.createSession(args.agent_id, args.chat_id);
    return ok(session.id);
  };
  toolImpls["sessions.create"] = sessionsCreate;
  server.registerTool("sessions.create", {
    description: "Create a new session",
    inputSchema: z.object({ agent_id: z.string(), chat_id: z.string() })
  }, sessionsCreate);

  const sessionsGet = async (args: any): Promise<ToolResult> => {
    const rs = await getReportsAndSessions();
    const session = await rs.getSession(args.session_id);
    return ok(session ? JSON.stringify(session, null, 2) : "Session not found");
  };
  toolImpls["sessions.get"] = sessionsGet;
  server.registerTool("sessions.get", {
    description: "Get session by ID",
    inputSchema: z.object({ session_id: z.string() })
  }, sessionsGet);

  const sessionsGetActive = async (args: any): Promise<ToolResult> => {
    const rs = await getReportsAndSessions();
    const session = await rs.getActiveSession(args.agent_id, args.chat_id);
    return ok(session ? JSON.stringify(session, null, 2) : "No active session");
  };
  toolImpls["sessions.getActive"] = sessionsGetActive;
  server.registerTool("sessions.getActive", {
    description: "Get active session for agent+chat",
    inputSchema: z.object({ agent_id: z.string(), chat_id: z.string() })
  }, sessionsGetActive);

  const sessionsLogStep = async (args: any): Promise<ToolResult> => {
    const rs = await getReportsAndSessions();
    const step = await rs.logStep({
      session_id: args.session_id,
      step_num: args.step_num,
      step_type: args.step_type,
      tool: args.tool,
      args_hash: args.args_hash,
      obs_summary: args.obs_summary
    });
    return ok(`Step logged: ${step.id}`);
  };
  toolImpls["sessions.logStep"] = sessionsLogStep;
  server.registerTool("sessions.logStep", {
    description: "Log a session step",
    inputSchema: z.object({ session_id: z.string(), step_num: z.number(), step_type: z.enum(["thought", "tool_call", "observation", "final"]), tool: z.string().optional(), args_hash: z.string().optional(), obs_summary: z.string().optional() })
  }, sessionsLogStep);

  const sessionsGetSteps = async (args: any): Promise<ToolResult> => {
    const rs = await getReportsAndSessions();
    const steps = await rs.getSessionSteps(args.session_id, args.limit || 10);
    return ok(JSON.stringify(steps, null, 2));
  };
  toolImpls["sessions.getSteps"] = sessionsGetSteps;
  server.registerTool("sessions.getSteps", {
    description: "Get session steps",
    inputSchema: z.object({ session_id: z.string(), limit: z.number().optional() })
  }, sessionsGetSteps);

  return { server, ctx: { memory, kanban, messaging, meetings, hiring }, executor };
}
