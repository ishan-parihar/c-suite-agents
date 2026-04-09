import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { logger } from "../logger.js";
import { createImageAnalyzeTool } from "../runtime/tools/image-analyze.js";
import { createImageGenerateTool } from "../runtime/tools/image-generate.js";
import { createTtsSynthesizeTool } from "../runtime/tools/tts-synthesize.js";
import { createFsReadTool } from "../runtime/tools/fs-read.js";
import { createFsWriteTool } from "../runtime/tools/fs-write.js";
import { createFsEditTool } from "../runtime/tools/fs-edit.js";
import { createBashTool } from "../runtime/tools/bash-exec.js";
import { createCodeReadTool } from "../runtime/tools/code-read.js";
import { createCodeWriteTool } from "../runtime/tools/code-write.js";
import { createCodeEditTool } from "../runtime/tools/code-edit.js";
import { Memory } from "../memory/lancedb.js";
import { getMemoryFacade } from "../memory/index.js";
import type { MemoryFacade } from "../memory/index.js";
import { Kanban } from "../kanban/sqlite.js";
import type { StrategosRuntime, ToolExecutor } from "../types.js";
import { v4 as uuidv4 } from "uuid";
import { CORE_STAFF_ROLES, getCoreStaffIds, getOrgChart, getStaffById, getDirectReports } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { getReportsAndSessions } from "./tools-reports.js";
import { getMeetingGovernance } from "../organic/meetings.js";
import { getHiringSystem } from "../organic/hiring.js";
import { AgentContextManager } from "../organic/context.js";
import { sendTelegramMessage } from "../integrations/telegram.js";
import { createServer } from "http";
import { startBoardMeeting, runFullBoardMeeting, getActiveMeeting, getMeeting, getBoardMeetingEngine } from "../organic/board-meeting.js";

type ToolResult = { content: Array<{ type: "text"; text: string }> };
const ok = (text: string): ToolResult => ({ content: [{ type: "text" as const, text }] });

export const toolImpls: Record<string, (args: any) => Promise<ToolResult>> = {};

async function initializeCoreStaff(kanban: Kanban, memory: Memory) {
  logger.info("Initializing core staff...");
  for (const [id, role] of Object.entries(CORE_STAFF_ROLES)) {
    try {
      await kanban.ensureBoard(id, role.name, role.kanbanColumns);
      await memory.ensureAgent(id);
      logger.info({ id, role: role.title }, "Core staff initialized");
    } catch (err: any) {
      logger.error({ id, err: err.message }, "Failed to initialize staff");
    }
  }
  logger.info(`Core staff initialized: ${getCoreStaffIds().length} agents`);
}

export async function startStrategos(): Promise<StrategosRuntime> {
  const memory = await Memory.init(process.env.LANCEDB_DIR || ".lancedb");
  const memoryFacade = await getMemoryFacade();
  const kanban = await Kanban.init(process.env.KANBAN_DB || "kanban.db");
  const messaging = await getMessagingSystem();
  const meetings = getMeetingGovernance();
  const hiring = await getHiringSystem();
  const contextManager = new AgentContextManager(kanban, memory);

  await initializeCoreStaff(kanban, memory);

  // Import scheduler (needed by cron tools in createSessionServer below)
  const { getAgentScheduler } = await import("../scheduler/agent-scheduler.js");

  // Start HTTP server for MCP (SSE transport — compatible with OpenCode remote MCP)
  const MCP_PORT = parseInt(process.env.MCP_PORT || "3001", 10);
  const MAX_SSE_SESSIONS = 20;
  const sseTransports = new Map<string, { transport: SSEServerTransport; server: McpServer }>();
  const sessionAgentMap = new Map<string, string>();
  const ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

  // Factory: create a new McpServer with all tools registered for a given SSE session
  function createSessionServer(callerAgentId?: string): { server: McpServer; toolImpls: Record<string, (args: any) => Promise<ToolResult>> } {
    const sessionServer = new McpServer({ name: "strategos", version: "0.1.0" }, { capabilities: { logging: {} } });
    const sessionToolImpls: Record<string, (args: any) => Promise<ToolResult>> = {};

    // Security: override identity fields with session-bound caller
    function withCallerIdentity(args: any): any {
      if (!callerAgentId) return args;
      const overridden = { ...args };
      // Always inject caller identity — don't check if field exists first
      overridden.from = callerAgentId;
      overridden.from_agent = callerAgentId;
      overridden.agent_id = callerAgentId;
      return overridden;
    }

    // === AGENT MANAGEMENT TOOLS ===
    const agentCreate = async (args: any): Promise<ToolResult> => {
      const agentId = args.id || uuidv4();
      await kanban.ensureBoard(agentId, args.name);
      await memory.ensureAgent(agentId);
      logger.info({ agentId, name: args.name, role: args.role }, "Agent created");
      return ok(`Agent created: ${agentId} (${args.name}${args.role ? ` — ${args.role}` : ""})`);
    };
    sessionToolImpls["agent.create"] = agentCreate;
    sessionServer.registerTool("agent.create", { description: "Create a new agent with dedicated Kanban board and memory. Use when the org needs a new permanent or temporary agent.", inputSchema: z.object({ id: z.string().optional().describe("Agent ID (auto-generated if omitted)"), name: z.string().describe("Agent display name"), role: z.string().optional().describe("Agent role or title"), model: z.string().optional().describe("LLM model to use"), tools: z.array(z.string()).optional().describe("List of tool names available to this agent") }) }, agentCreate);

    const agentSpawn = async (args: any): Promise<ToolResult> => {
      const subAgentId = uuidv4();
      await kanban.ensureBoard(subAgentId, `Sub-agent: ${args.task?.slice(0, 40) || "task"}`);
      await memory.ensureAgent(subAgentId);
      logger.info({ subAgentId, parent: args.agent_id, task: args.task }, "Agent spawned");
      return ok(`Sub-agent spawned: ${subAgentId}\nTask: ${args.task}\nParent: ${args.agent_id}`);
    };
    sessionToolImpls["agent.spawn"] = agentSpawn;
    sessionServer.registerTool("agent.spawn", { description: "Spawn a sub-agent for a specific task with dedicated board and memory. Use for isolated work that shouldn't affect the parent agent's context.", inputSchema: z.object({ agent_id: z.string().describe("Parent agent ID"), task: z.string().describe("Task description"), role: z.string().optional().describe("Sub-agent role"), project_dir: z.string().optional().describe("Project directory context") }) }, agentSpawn);

    const agentList = async (): Promise<ToolResult> => {
      const staffIds = getCoreStaffIds();
      const lines: string[] = ["👥 **Active Agents:**\n"];
      for (const id of staffIds) {
        const s = getStaffById(id);
        if (s) lines.push(`${s.avatar} **${s.name}** (${id}) — ${s.title}`);
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["agent.list"] = agentList;
    sessionServer.registerTool("agent.list", { description: "List all active agents with their roles and avatars. Quick reference of the current team.", inputSchema: z.object({}) }, agentList);

    // === AGENT COMMUNICATION TOOLS ===
    const agentHandoff = async (args: any): Promise<ToolResult> => {
      const { from_agent, to_agent, context, conversation_id } = withCallerIdentity(args);
      if (!to_agent || !context) return ok("❌ Error: to_agent and context are required");
      const fromStaff = getStaffById(from_agent);
      const toStaff = getStaffById(to_agent);
      if (!toStaff) return ok(`❌ Agent "${to_agent}" not found.`);
      try {
        await messaging.send({ from: from_agent, to: to_agent, content: `🔄 **HANDOFF**\n\nFrom: ${fromStaff?.name || from_agent}\n\nContext:\n${context}`, priority: "P2", requires_response: true, subject: `Handoff from ${from_agent}`, tags: ["handoff", "agent-transfer"] });
        logger.info({ from: from_agent, to: to_agent, conversation_id }, "Agent handoff completed");
        return ok(`✅ Conversation handed off to **${toStaff.avatar} ${toStaff.name}**\n\nThey now have full context and will continue the conversation.`);
      } catch (err: any) {
        logger.error({ err: err.message }, "Handoff failed");
        return ok(`❌ Handoff failed: internal error`);
      }
    };
    sessionToolImpls["agent.handoff"] = agentHandoff;
    sessionServer.registerTool("agent.handoff", { description: "Hand off a conversation to another agent — they take over with full context. Use when a topic is outside your domain.", inputSchema: z.object({ from_agent: z.string().describe("Your agent ID"), to_agent: z.string().describe("Agent to handoff to"), context: z.string().describe("Conversation context and summary"), conversation_id: z.string().optional().describe("Optional conversation/thread ID") }) }, agentHandoff);

    const agentMeeting = async (args: any): Promise<ToolResult> => {
      const { from_agent, participants, topic, urgency = "normal" } = withCallerIdentity(args);
      if (!participants || participants.length === 0) return ok("❌ Error: participants array is required");
      const validParticipants = participants.filter((id: string) => getStaffById(id));
      if (validParticipants.length === 0) return ok("❌ No valid agents found in participants list");
      try {
        const results = await Promise.allSettled(validParticipants.map(async (agentId: string) => {
          const staff = getStaffById(agentId);
          await messaging.send({ from: from_agent, to: agentId, content: `🏛 **BOARD MEETING CALLED**\n\nCalled by: ${getStaffById(from_agent)?.name || from_agent}\n\nTopic: ${topic}\nUrgency: ${urgency}\n\nPlease respond with your input.`, priority: urgency === "urgent" ? "P1" : "P2", requires_response: true, subject: `Meeting: ${topic}`, tags: ["meeting", "board"] });
        }));
        const failed = results.filter(r => r.status === "rejected");
        if (failed.length > 0) {
          logger.warn({ failed: failed.length, total: results.length }, "Meeting notification partial failure");
        }
        logger.info({ caller: from_agent, participants: validParticipants, topic }, "Board meeting called");
        const names = validParticipants.map((id: string) => { const s = getStaffById(id); return s ? `${s.avatar} ${s.name}` : id; }).join(", ");
        return ok(`🏛 **Board Meeting Called**\n\nTopic: ${topic}\nUrgency: ${urgency}\n\nParticipants:\n${names}\n\nAll agents have been notified and will respond.`);
      } catch (err: any) {
        logger.error({ err: err.message }, "Failed to call meeting");
        return ok(`❌ Failed to call meeting: internal error`);
      }
    };
    sessionToolImpls["agent.meeting"] = agentMeeting;
    sessionServer.registerTool("agent.meeting", { description: "Call a board meeting with multiple agents. Use for decisions requiring group consensus or cross-functional coordination.", inputSchema: z.object({ from_agent: z.string().describe("Your agent ID (caller)"), participants: z.array(z.string()).describe("List of agent IDs to invite"), topic: z.string().describe("Meeting topic"), urgency: z.enum(["normal", "urgent"]).optional().describe("Meeting urgency") }) }, agentMeeting);

    // === CONTEXT & RECALL TOOLS ===
    const agentWake = async (args: any): Promise<ToolResult> => {
      const context = await contextManager.getWakeContext(args.agent_id);
      const formatted = await contextManager.formatWakeContext(context);
      return ok(formatted);
    };
    sessionToolImpls["agent.wake"] = agentWake;
    sessionServer.registerTool("agent.wake", { description: "Get wake-up context for an agent — recent activity, pending items, state summary. Inject on activation to restore context.", inputSchema: z.object({ agent_id: z.string().describe("Agent ID to get wake context for") }) }, agentWake);

    const memoryRecall = async (args: any): Promise<ToolResult> => {
      const result = await contextManager.recall({ agent_id: args.agent_id, query: args.query, top_k: args.top_k || 10 });
      const lines: string[] = [`🔍 **Search: "${args.query}"** (${result.total_found} results)\n`];
      for (const r of result.results) {
        const icon = r.type === "message" ? "💬" : r.type === "task" ? "📋" : r.type === "memory" ? "🧠" : "🏛";
        lines.push(`${icon} **[${r.type}]** ${r.summary}`);
        lines.push(`   Relevance: ${(r.relevance * 100).toFixed(0)}% | ID: ${r.id}`);
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["memory.recall"] = memoryRecall;
    sessionServer.registerTool("memory.recall", { description: "Search across messages, tasks, and memory for an agent. Use to find past conversations, completed tasks, or stored memories.", inputSchema: z.object({ agent_id: z.string().describe("Agent ID to search within"), query: z.string().describe("Search query"), top_k: z.number().optional().describe("Max results (default: 10)") }) }, memoryRecall);

    const messageGetThread = async (args: any): Promise<ToolResult> => {
      const thread = await contextManager.getFullThread(args.thread_id);
      if (!thread) return ok(`Thread ${args.thread_id} not found`);
      const lines: string[] = [`💬 **Thread: ${thread.subject}**\n`];
      const msgs = await messaging.getThreadMessages(args.thread_id);
      for (const msg of msgs) {
        const ts = new Date(msg.created_at).toISOString().slice(0, 16);
        const respondedFlag = msg.responded ? " ✅" : msg.requires_response ? " ⏳" : "";
        lines.push(`[${ts}] **${msg.from}** → ${msg.to}${respondedFlag}`);
        lines.push(`   ${msg.content}`);
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["message.getThread"] = messageGetThread;
    sessionServer.registerTool("message.getThread", { description: "Read full message thread with all messages in chronological order. Use to review a conversation.", inputSchema: z.object({ thread_id: z.string().describe("Thread ID to read") }) }, messageGetThread);

    const taskGet = async (args: any): Promise<ToolResult> => {
      const card = await contextManager.getFullTask(args.card_id);
      if (!card) return ok(`Task ${args.card_id} not found`);
      const lines: string[] = [`📋 **${card.title}**`, `Status: ${card.status}`, `Priority: ${card.priority}`, card.due ? `Due: ${card.due}` : "", `Description: ${card.description}`, card.tags?.length ? `Tags: ${card.tags.join(", ")}` : ""];
      return ok(lines.filter(Boolean).join("\n"));
    };
    sessionToolImpls["task.get"] = taskGet;
    sessionServer.registerTool("task.get", { description: "Get full details of a task card — status, priority, description, tags. Use to review task context.", inputSchema: z.object({ card_id: z.string().describe("Card/task ID") }) }, taskGet);

    // === ORGANIZATION TOOLS ===
    const orgChart = async (): Promise<ToolResult> => ok(getOrgChart());
    sessionToolImpls["org.chart"] = orgChart;
    sessionServer.registerTool("org.chart", { description: "Display the full organization chart showing hierarchy and reporting structure.", inputSchema: z.object({}) }, orgChart);

    const staffList = async (): Promise<ToolResult> => {
      const staff = getCoreStaffIds().map(id => { const s = getStaffById(id); return s ? `${s.avatar} ${s.name} — ${s.title}` : ""; }).filter(Boolean).join("\n");
      return ok(`**Core Staff:**\n\n${staff}`);
    };
    sessionToolImpls["staff.list"] = staffList;
    sessionServer.registerTool("staff.list", { description: "List core staff members with their roles. Quick reference of the C-suite team.", inputSchema: z.object({}) }, staffList);

    const staffGet = async (args: any): Promise<ToolResult> => {
      const staff = getStaffById(args.id);
      if (!staff) return ok(`Staff "${args.id}" not found`);
      return ok(`${staff.avatar} **${staff.name}** — ${staff.title}\n\nBoard Seat: ${staff.boardSeat ? "Yes" : "No"}\nReports To: ${staff.reportsTo || "CEO"}\n\nDatabases:\n${staff.databases.join("\n")}\n\nKanban Columns:\n${staff.kanbanColumns.join(" → ")}`);
    };
    sessionToolImpls["staff.get"] = staffGet;
    sessionServer.registerTool("staff.get", { description: "Get detailed info about a staff member — role, databases, Kanban columns, reporting.", inputSchema: z.object({ id: z.string().describe("Staff/agent ID") }) }, staffGet);

    // === MEMORY TOOLS ===
    const memoryUpsert = async (args: any): Promise<ToolResult> => {
      if (!memoryFacade) return ok("Error: MemoryFacade not initialized");
      const resolved = withCallerIdentity(args);
      const id = await memoryFacade.upsert({ agent_id: resolved.agent_id, scope: resolved.scope || "personal", kind: resolved.kind || "episodic", type: resolved.type, content: resolved.content, importance: resolved.importance ?? 0.5, tags: resolved.tags || [], project_id: resolved.project_id, task_id: resolved.task_id, thread_id: resolved.thread_id, ttl_hours: resolved.ttl_hours, decay_rate: resolved.decay_rate ?? 0.5, source: resolved.source || "manual" });
      return ok(id ? `Memory saved: ${id}` : "Duplicate — memory already exists");
    };
    sessionToolImpls["memory.upsert"] = memoryUpsert;
    sessionServer.registerTool("memory.upsert", { description: "Save a memory with scope, type, and automatic deduplication. Duplicate content is rejected. Use scope 'personal' for agent-private memories, 'project' for shared project context, 'company' for org-wide knowledge.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), scope: z.enum(["personal", "project", "company"]).optional().describe("Memory scope (default: personal)"), kind: z.enum(["episodic", "semantic", "procedural"]).optional().describe("episodic=events, semantic=facts, procedural=how-to (default: episodic)"), type: z.enum(["note", "obs", "io", "log", "decision", "meeting", "insight"]).describe("Memory type"), content: z.string().describe("Memory content"), importance: z.number().min(0).max(1).optional().describe("Importance 0-1 (default: 0.5)"), tags: z.array(z.string()).optional().describe("Tags for categorization"), project_id: z.string().optional().describe("Project context (for project scope)"), task_id: z.string().optional().describe("Related task ID"), thread_id: z.string().optional().describe("Related conversation thread ID"), ttl_hours: z.number().optional().describe("Hours until this memory expires (null = permanent)"), source: z.enum(["manual", "proactive", "scheduled", "conversation", "system"]).optional().describe("How this memory was created") }) }, memoryUpsert);

    const memorySearch = async (args: any): Promise<ToolResult> => {
      if (!memoryFacade) return ok("Error: MemoryFacade not initialized");
      const resolved = withCallerIdentity(args);
      const results = await memoryFacade.search({ agent_id: resolved.agent_id, query: resolved.query, scopes: resolved.scopes || ["personal"], kinds: resolved.kinds, tags: resolved.tags, tag_match: resolved.tag_match || "any", date_from: resolved.date_from ? new Date(resolved.date_from).getTime() : undefined, date_to: resolved.date_to ? new Date(resolved.date_to).getTime() : undefined, min_importance: resolved.min_importance, top_k: resolved.top_k || 10 });
      if (results.length === 0) return ok(`No memories found for "${resolved.query}"`);
      const lines = results.map((r: any) => { const age = Date.now() - r.ts; const ageStr = age < 3600000 ? `${Math.floor(age/60000)}m ago` : age < 86400000 ? `${Math.floor(age/3600000)}h ago` : `${Math.floor(age/86400000)}d ago`; return `[${r.type}|${r.kind}|${r.scope}] (${ageStr}, ${(r.importance*100).toFixed(0)}%) ${r.content.slice(0, 300)}`; });
      return ok(`Found ${results.length} memories for "${resolved.query}":\n\n${lines.join("\n")}`);
    };
    sessionToolImpls["memory.search"] = memorySearch;
    sessionServer.registerTool("memory.search", { description: "Search memory with vector similarity + metadata filters. Returns results sorted by combined score (vector distance 60% + importance 25% + recency 15%). Use scopes to search personal, project, or company memory. Use tags for exact matching.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), query: z.string().describe("Natural language search query"), scopes: z.array(z.enum(["personal", "project", "company"])).optional().describe("Scopes to search (default: [personal])"), kinds: z.array(z.enum(["episodic", "semantic", "procedural"])).optional().describe("Filter by memory kind"), tags: z.array(z.string()).optional().describe("Filter by tags"), tag_match: z.enum(["any", "all"]).optional().describe("Tag match mode (default: any)"), date_from: z.string().optional().describe("Start date (ISO string)"), date_to: z.string().optional().describe("End date (ISO string)"), min_importance: z.number().min(0).max(1).optional().describe("Minimum importance threshold"), top_k: z.number().optional().describe("Max results (default: 10)") }) }, memorySearch);

    // === KANBAN TOOLS ===
    const boardAddCard = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const cardId = await kanban.addCard(resolved.agent_id, resolved.title, resolved.description || "", resolved.priority || "P3", resolved.due || null, resolved.tags || [], resolved.project_id);
      await memory.upsertEvent({ agent_id: resolved.agent_id, type: "note", content: `Task: ${resolved.title}`, importance: 0.5, tags: ["kanban","create"] });
      logger.info({ cardId, title: resolved.title }, "Card added");
      return ok(cardId);
    };
    sessionToolImpls["board.addCard"] = boardAddCard;
    sessionServer.registerTool("board.addCard", { description: "Create a new task card on your Kanban board. Use when a new task is identified during work or from conversations.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), title: z.string().describe("Task title"), description: z.string().optional().describe("Task description"), priority: z.string().optional().describe("Priority P1-P4 (default: P3)"), due: z.string().optional().describe("Due date (ISO string)"), tags: z.array(z.string()).optional().describe("Tags for categorization"), project_id: z.string().optional().describe("Associated project ID") }) }, boardAddCard);

    const boardMoveCard = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      // Validate status against the agent's actual board columns
      const board = await kanban.getBoard(resolved.agent_id);
      if (board && !board.columns.some(c => c.name === args.status)) {
        const available = board.columns.map(c => c.name).join(", ");
        return ok(`❌ Invalid column "${args.status}". Available columns: ${available}`);
      }
      await kanban.moveCard(resolved.agent_id, args.card_id, args.status);
      logger.info({ card_id: args.card_id, status: args.status }, "Card moved");
      return ok("ok");
    };
    sessionToolImpls["board.moveCard"] = boardMoveCard;
    sessionServer.registerTool("board.moveCard", { description: "Move a card to a different column. Use when task status changes.", inputSchema: z.object({ card_id: z.string().describe("Card ID to move"), status: z.string().describe("Target column name (must match agent's board columns)") }) }, boardMoveCard);

    const boardGet = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const board = await kanban.getBoard(resolved.agent_id);
      if (!board) return ok(`Board not found for agent ${resolved.agent_id}`);
      const lines: string[] = [`📋 **${board.name}'s Board**\n`];
      for (const col of board.columns) {
        lines.push(`**${col.name}** (${col.cards.length})`);
        for (const card of col.cards.slice(0, 5)) lines.push(`  • ${card.title} [${card.priority}]${card.due ? ` (due: ${card.due})` : ""}`);
        if (col.cards.length > 5) lines.push(`  ... and ${col.cards.length - 5} more`);
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["board.get"] = boardGet;
    sessionServer.registerTool("board.get", { description: "Review your Kanban board — shows all cards grouped by column. Use to check workload and progress.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID") }) }, boardGet);

    const boardViewReports = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const managerId = resolved.manager_id;
      const manager = getStaffById(managerId);
      if (!manager) return ok(`Manager ${managerId} not found`);
      const reports = await kanban.viewReportsBoard(managerId);
      if (reports.length === 0) return ok(`${manager.name} has no direct reports with boards.`);
      const lines: string[] = [`👥 **${manager.name}'s Team Boards**\n`];
      for (const { agent_id, board } of reports) {
        const report = getStaffById(agent_id);
        const totalCards = board.columns.reduce((sum, c) => sum + c.cards.length, 0);
        lines.push(`**${report?.name || agent_id}** (${totalCards} cards)`);
        if (totalCards > 0) { const inProgress = board.columns.find(c => c.name === "In Progress")?.cards.length || 0; const blocked = board.columns.find(c => c.name === "Blocked")?.cards.length || 0; lines.push(`  └─ In Progress: ${inProgress}, Blocked: ${blocked}`); }
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["board.viewReports"] = boardViewReports;
    sessionServer.registerTool("board.viewReports", { description: "Manager view of all direct reports' Kanban boards. Shows card counts and status summaries.", inputSchema: z.object({ manager_id: z.string().describe("Manager agent ID") }) }, boardViewReports);

    const boardReassign = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      await kanban.reassignCard(resolved.card_id, resolved.from_agent_id, resolved.to_agent_id, resolved.manager_id);
      return ok(`Card reassigned from ${resolved.from_agent_id} to ${resolved.to_agent_id}`);
    };
    sessionToolImpls["board.reassign"] = boardReassign;
    sessionServer.registerTool("board.reassign", { description: "Reassign a card from one report to another. Requires manager authority.", inputSchema: z.object({ card_id: z.string().describe("Card ID to reassign"), from_agent_id: z.string().describe("Current assignee agent ID"), to_agent_id: z.string().describe("New assignee agent ID"), manager_id: z.string().describe("Manager ID performing the reassignment") }) }, boardReassign);

    const boardEscalate = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      await kanban.escalateCard(resolved.card_id, resolved.agent_id || resolved.from, resolved.to_manager_id, resolved.reason);
      return ok(`Card escalated to ${resolved.to_manager_id}: ${resolved.reason}`);
    };
    sessionToolImpls["board.escalate"] = boardEscalate;
    sessionServer.registerTool("board.escalate", { description: "Escalate a blocked card to your manager with a reason.", inputSchema: z.object({ card_id: z.string().describe("Card ID to escalate"), to_manager_id: z.string().describe("Manager agent ID to escalate to"), reason: z.string().describe("Why this card is blocked or needs escalation") }) }, boardEscalate);

    // === MESSAGING TOOLS ===
    const messageSend = async (args: any): Promise<ToolResult> => {
      try {
        const resolved = withCallerIdentity(args);
        if (!resolved.to) return ok("❌ Error: 'to' (recipient agent ID) is required");
        if (!resolved.content) return ok("❌ Error: 'content' (message body) is required");
        const thread = await messaging.send({ from: resolved.from, to: resolved.to, content: resolved.content, priority: resolved.priority || "P3", requires_response: resolved.requires_response || false, subject: resolved.subject, tags: resolved.tags });
        return ok(`Message sent to ${resolved.to}. Thread ID: ${thread.id}`);
      } catch (err: any) {
        const msg = err?.message || String(err);
        logger.error({ err: msg }, "message.send failed");
        return ok(`❌ Error: ${msg}`);
      }
    };
    sessionToolImpls["message.send"] = messageSend;
    sessionServer.registerTool("message.send", { description: "Send an async message to another agent. Use for requests, updates, or questions.", inputSchema: z.object({ from: z.string().describe("Your agent ID"), to: z.string().describe("Recipient agent ID"), content: z.string().describe("Message content"), priority: z.enum(["P1", "P2", "P3", "P4"]).optional().describe("Priority level (default: P3)"), requires_response: z.boolean().optional().describe("Whether a response is expected"), subject: z.string().optional().describe("Thread subject line"), tags: z.array(z.string()).optional().describe("Tags for categorization") }) }, messageSend);

    const messageReply = async (args: any): Promise<ToolResult> => {
      try {
        const resolved = withCallerIdentity(args);
        if (!resolved.thread_id) return ok("❌ Error: 'thread_id' is required");
        if (!resolved.content) return ok("❌ Error: 'content' (reply body) is required");
        const thread = await messaging.reply({ thread_id: resolved.thread_id, from: resolved.from, content: resolved.content, requires_response: resolved.requires_response || false, tags: resolved.tags });
        return ok(`Reply sent. Thread updated: ${thread.id}`);
      } catch (err: any) {
        const msg = err?.message || String(err);
        logger.error({ err: msg }, "message.reply failed");
        return ok(`❌ Error: ${msg}`);
      }
    };
    sessionToolImpls["message.reply"] = messageReply;
    sessionServer.registerTool("message.reply", { description: "Reply to an existing message thread. Use to continue a conversation.", inputSchema: z.object({ thread_id: z.string().describe("Thread ID to reply to"), from: z.string().describe("Your agent ID"), content: z.string().describe("Reply content"), requires_response: z.boolean().optional().describe("Whether a response is expected"), tags: z.array(z.string()).optional().describe("Tags for categorization") }) }, messageReply);

    const messageSearch = async (args: any): Promise<ToolResult> => {
      const results = await messaging.searchMessages({ agent_id: args.agent_id, query: args.query, top_k: args.top_k || 10, from_agent: args.from_agent, priority: args.priority, date_from: args.date_from, date_to: args.date_to });
      const lines: string[] = [`🔍 **Messages for ${args.agent_id}** (${results.length} results)\n`];
      for (const r of results) { lines.push(`[${r.message.priority}] ${r.message.from} → ${r.message.to}`); lines.push(`   "${r.snippet}"`); lines.push(`   Thread: ${r.thread.id} | Score: ${(r.relevance_score * 100).toFixed(0)}%\n`); }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["message.search"] = messageSearch;
    sessionServer.registerTool("message.search", { description: "Search message history with semantic search. Use to find past conversations or decisions.", inputSchema: z.object({ agent_id: z.string().describe("Agent ID to search within"), query: z.string().describe("Search query"), top_k: z.number().optional().describe("Max results (default: 10)"), from_agent: z.string().optional().describe("Filter by sender agent ID"), priority: z.enum(["P1", "P2", "P3", "P4"]).optional().describe("Filter by priority"), date_from: z.number().optional().describe("Start timestamp (ms)"), date_to: z.number().optional().describe("End timestamp (ms)") }) }, messageSearch);

    const messageGetThreads = async (args: any): Promise<ToolResult> => {
      const threads = await messaging.getThreadsForAgent(args.agent_id, args.limit || 20);
      const lines: string[] = [`📬 **Threads for ${args.agent_id}** (${threads.length})\n`];
      for (const thread of threads) { const other = thread.participants.find(p => p !== args.agent_id); const unread = 0; lines.push(`• ${thread.subject} (with ${other}) - ${new Date(thread.updated_at).toISOString().slice(0, 16)}${unread > 0 ? ` 🔴 ${unread} unread` : ""}`); }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["message.getThreads"] = messageGetThreads;
    sessionServer.registerTool("message.getThreads", { description: "List all active message threads for your agent.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), limit: z.number().optional().describe("Max threads to return (default: 20)") }) }, messageGetThreads);

    const messageMarkRead = async (args: any): Promise<ToolResult> => {
      await messaging.markAsRead(args.agent_id, args.thread_id);
      return ok("Messages marked as read");
    };
    sessionToolImpls["message.markRead"] = messageMarkRead;
    sessionServer.registerTool("message.markRead", { description: "Mark messages or a thread as read. Use after reviewing to clear from inbox.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), thread_id: z.string().optional().describe("Specific thread ID (omit to mark all as read)") }) }, messageMarkRead);

    const messageEscalate = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const escalation = await messaging.escalate({ thread_id: resolved.thread_id, from: resolved.from, to: resolved.to, reason: resolved.reason });
      return ok(`Escalated to ${resolved.to}. Escalation ID: ${escalation.id}`);
    };
    sessionToolImpls["message.escalate"] = messageEscalate;
    sessionServer.registerTool("message.escalate", { description: "Escalate a message thread to a superior agent.", inputSchema: z.object({ thread_id: z.string().describe("Thread ID to escalate"), from: z.string().describe("Your agent ID"), to: z.string().describe("Superior agent ID to escalate to"), reason: z.string().describe("Reason for escalation") }) }, messageEscalate);

    const agentInbox = async (args: any): Promise<ToolResult> => {
      const { agent_id, include_read = false, include_content = false } = args;
      const context = await messaging.getActiveContext(agent_id);
      const unreadMessages = include_content
        ? await messaging.getUnreadMessages(agent_id, 20)
        : [];
      const lines: string[] = [`📬 **Inbox for ${agent_id}**\n`];
      lines.push(`Unread: ${context.unread_count} | Pending Responses: ${context.pending_responses.length}\n`);
      if (include_content && unreadMessages.length > 0) {
        lines.push(`**📥 Unread Messages (${unreadMessages.length}):**`);
        for (const msg of unreadMessages.slice(0, 10)) {
          const fromStaff = getStaffById(msg.from);
          const fromName = fromStaff ? `${fromStaff.avatar} ${fromStaff.name}` : msg.from;
          const ts = new Date(msg.created_at).toISOString().slice(0, 16);
          lines.push(`---`);
          lines.push(`**[${msg.priority}] ${fromName} at ${ts}:**`);
          lines.push(`${msg.content}`);
          lines.push("");
        }
        if (unreadMessages.length > 10) lines.push(`- ... and ${unreadMessages.length - 10} more`);
        lines.push("");
      } else if (!include_content && context.unread_count > 0) {
        const previewMessages = await messaging.getUnreadMessages(agent_id, 10);
        lines.push(`**📥 Unread Messages (${context.unread_count}):**`);
        for (const msg of previewMessages.slice(0, 10)) {
          const fromStaff = getStaffById(msg.from);
          const fromName = fromStaff ? `${fromStaff.avatar} ${fromStaff.name}` : msg.from;
          const ts = new Date(msg.created_at).toISOString().slice(0, 16);
          const preview = msg.content.length > 120 ? msg.content.slice(0, 120) + "..." : msg.content;
          lines.push(`- [${msg.priority}] ${fromName} at ${ts}: ${preview}`);
        }
        if (context.unread_count > 10) lines.push(`- ... and ${context.unread_count - 10} more (use include_content=true for full messages)`);
        lines.push("");
      }
      if (context.pending_responses.length > 0) { lines.push(`**⏳ Requires Response:**`); for (const msg of context.pending_responses) { const fromStaff = getStaffById(msg.from); const fromName = fromStaff ? `${fromStaff.avatar} ${fromStaff.name}` : msg.from; lines.push(`- [${msg.priority}] From ${fromName}: ${msg.content.slice(0, 80)}...`); } lines.push(""); }
      if (context.active_threads.length > 0) { lines.push(`**💬 Active Threads:**`); for (const thread of context.active_threads.slice(0, 5)) { const other = thread.participants.find(p => p !== agent_id); const otherStaff = getStaffById(other || ""); const otherName = otherStaff ? `${otherStaff.avatar} ${otherStaff.name}` : other; lines.push(`- ${thread.subject} (with ${otherName})`); } }
      if (context.recent_escalations.length > 0) { lines.push(`\n**🔺 Escalations:**`); for (const esc of context.recent_escalations) { lines.push(`- From ${esc.from}: ${esc.reason.slice(0, 50)}...`); } }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["agent.inbox"] = agentInbox;
    sessionServer.registerTool("agent.inbox", { description: "View your message inbox summary — unread count, pending responses, active threads, escalations.", inputSchema: z.object({ agent_id: z.string().describe("Agent ID to check inbox for"), include_read: z.boolean().optional().default(false).describe("Include read messages in results"), include_content: z.boolean().optional().default(false).describe("When true, return full message content instead of previews") }) }, agentInbox);

    const messageGetUnread = async (args: any): Promise<ToolResult> => {
      const { agent_id, limit = 20 } = args;
      const unread = await messaging.getUnreadMessages(agent_id, limit);
      if (unread.length === 0) return ok(`📬 No unread messages for ${agent_id}`);
      const lines: string[] = [`📬 **Unread Messages for ${agent_id}** (${unread.length})\n`];
      for (const msg of unread) { const fromStaff = getStaffById(msg.from); const fromName = fromStaff ? `${fromStaff.avatar} ${fromStaff.name}` : msg.from; const ts = new Date(msg.created_at).toISOString().slice(0, 16); const tags = msg.tags ? msg.tags.filter((t: string) => t !== "internal" && t !== "proactive-report").join(", ") : ""; lines.push(`---`); lines.push(`**From:** ${fromName} | **Priority:** ${msg.priority} | **Time:** ${ts}`); if (tags) lines.push(`**Tags:** ${tags}`); lines.push(`**Content:**\n${msg.content}`); lines.push(""); }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["message.getUnread"] = messageGetUnread;
    sessionServer.registerTool("message.getUnread", { description: "Get all unread messages for an agent with full content. Use this to read reports from other agents. After reading, use message.markRead to clear them.", inputSchema: z.object({ agent_id: z.string().describe("Agent ID whose unread messages to fetch"), limit: z.number().optional().default(20).describe("Max messages to return") }) }, messageGetUnread);

    // === MEETING GOVERNANCE TOOLS ===
    const meetingPropose = async (args: any): Promise<ToolResult> => {
      const proposal = await meetings.propose({ proposer: args.proposer, title: args.title, reason: args.reason, urgency: args.urgency || "P3" });
      return ok(`Meeting proposed: ${proposal.id}\nVotes needed: ${proposal.required_votes}/${getCoreStaffIds().length}\nDeadline: ${new Date(proposal.voting_deadline).toISOString()}`);
    };
    sessionToolImpls["meeting.propose"] = meetingPropose;
    sessionServer.registerTool("meeting.propose", { description: "Propose a new board meeting with title, reason, and urgency. Triggers voting process.", inputSchema: z.object({ proposer: z.string().describe("Agent ID proposing the meeting"), title: z.string().describe("Meeting title"), reason: z.string().describe("Why this meeting is needed"), urgency: z.enum(["P1", "P2", "P3", "P4"]).optional().describe("Meeting urgency (default: P3)") }) }, meetingPropose);

    const meetingVote = async (args: any): Promise<ToolResult> => {
      const result = await meetings.vote({ meeting_id: args.meeting_id, voter: args.voter, vote: args.vote });
      const yesVotes = Object.values(result.votes).filter(v => v === "yes").length;
      return ok(`Vote recorded. Current: ${yesVotes}/${result.required_votes} yes votes. Status: ${result.status}`);
    };
    sessionToolImpls["meeting.vote"] = meetingVote;
    sessionServer.registerTool("meeting.vote", { description: "Vote yes/no/abstain on a meeting proposal. Required for quorum.", inputSchema: z.object({ meeting_id: z.string().describe("Meeting proposal ID"), voter: z.string().describe("Your agent ID"), vote: z.enum(["yes", "no", "abstain"]).describe("Your vote") }) }, meetingVote);

    const meetingGet = async (args: any): Promise<ToolResult> => {
      const proposal = await meetings.getProposal(args.meeting_id);
      if (!proposal) return ok(`Meeting ${args.meeting_id} not found`);
      const votesStr = (() => { try { return JSON.stringify(proposal.votes); } catch { return "{}"; } })();
      const lines: string[] = [`🏛 **${proposal.title}**`, `Proposed by: ${proposal.proposer}`, `Urgency: ${proposal.urgency}`, `Status: ${proposal.status}`, `Reason: ${proposal.reason}`, `Votes: ${votesStr}`, `Required: ${proposal.required_votes}`, proposal.scheduled_time ? `Scheduled: ${new Date(proposal.scheduled_time).toISOString()}` : ""];
      return ok(lines.filter(Boolean).join("\n"));
    };
    sessionToolImpls["meeting.get"] = meetingGet;
    sessionServer.registerTool("meeting.get", { description: "Get details of a meeting proposal including votes, status, and deadline.", inputSchema: z.object({ meeting_id: z.string().describe("Meeting proposal ID") }) }, meetingGet);

    const meetingRecordMinutes = async (args: any): Promise<ToolResult> => {
      const minutes = await meetings.recordMinutes({ meeting_id: args.meeting_id, decisions: args.decisions, action_items: args.action_items, attendees: args.attendees, recorded_by: args.recorded_by });
      return ok(`Minutes recorded. ${minutes.decisions.length} decisions, ${minutes.action_items.length} action items.`);
    };
    sessionToolImpls["meeting.recordMinutes"] = meetingRecordMinutes;
    sessionServer.registerTool("meeting.recordMinutes", { description: "Record meeting outcomes — decisions, action items with assignees/due dates, and attendees.", inputSchema: z.object({ meeting_id: z.string().describe("Meeting ID"), decisions: z.array(z.string()).describe("List of decisions made"), action_items: z.array(z.object({ description: z.string().describe("Action item description"), assignee: z.string().describe("Responsible agent ID"), due_date: z.string().optional().describe("Due date (ISO string)") })).describe("Action items from the meeting"), attendees: z.array(z.string()).describe("Agent IDs who attended"), recorded_by: z.string().describe("Agent ID recording the minutes") }) }, meetingRecordMinutes);

    // === HIRING & DELEGATION TOOLS ===
    const hireCreate = async (args: any): Promise<ToolResult> => {
      const contract = await hiring.create({ role: args.role, reports_to: args.reports_to, budget: args.budget, tasks: args.tasks });
      return ok(`Hired: ${contract.role} (ID: ${contract.agent_id})\nReports to: ${contract.reports_to}`);
    };
    sessionToolImpls["hire.create"] = hireCreate;
    sessionServer.registerTool("hire.create", { description: "Hire auxiliary staff with role, manager, budget, and task list.", inputSchema: z.object({ role: z.string().describe("Staff role/title"), reports_to: z.string().describe("Manager agent ID"), budget: z.number().optional().describe("Budget allocation"), tasks: z.array(z.string()).describe("List of tasks/responsibilities") }) }, hireCreate);

    const hireFire = async (args: any): Promise<ToolResult> => {
      const contract = await hiring.fire({ agent_id: args.agent_id, reason: args.reason });
      return ok(`Released: ${contract.role}\nReason: ${contract.termination_reason}`);
    };
    sessionToolImpls["hire.fire"] = hireFire;
    sessionServer.registerTool("hire.fire", { description: "Release auxiliary staff with a reason.", inputSchema: z.object({ agent_id: z.string().describe("Staff agent ID to release"), reason: z.string().describe("Reason for termination") }) }, hireFire);

    const delegateTo = async (args: any): Promise<ToolResult> => {
      const delegation = await hiring.delegate({ from: args.from, to: args.to, task: args.task, description: args.description, priority: args.priority || "P3", deadline: args.deadline });
      return ok(`Delegated: ${delegation.task}\nTo: ${delegation.to}\nID: ${delegation.id}`);
    };
    sessionToolImpls["delegate.to"] = delegateTo;
    sessionServer.registerTool("delegate.to", { description: "Delegate a task to a direct report with description, priority, and optional deadline.", inputSchema: z.object({ from: z.string().describe("Your agent ID (manager)"), to: z.string().describe("Report agent ID"), task: z.string().describe("Task name/title"), description: z.string().describe("Detailed task description"), priority: z.enum(["P1", "P2", "P3", "P4"]).optional().describe("Priority level (default: P3)"), deadline: z.string().optional().describe("Deadline (ISO string)") }) }, delegateTo);

    const delegateAccept = async (args: any): Promise<ToolResult> => {
      const delegation = await hiring.acceptDelegation(args.delegation_id);
      return ok(`Delegation accepted: ${delegation.task}`);
    };
    sessionToolImpls["delegate.accept"] = delegateAccept;
    sessionServer.registerTool("delegate.accept", { description: "Accept a delegated task from your manager.", inputSchema: z.object({ delegation_id: z.string().describe("Delegation ID to accept") }) }, delegateAccept);

    const delegateReject = async (args: any): Promise<ToolResult> => {
      const delegation = await hiring.rejectDelegation(args.delegation_id, args.reason);
      return ok(`Delegation rejected: ${delegation.task}\nReason: ${args.reason}`);
    };
    sessionToolImpls["delegate.reject"] = delegateReject;
    sessionServer.registerTool("delegate.reject", { description: "Reject a delegated task with a reason.", inputSchema: z.object({ delegation_id: z.string().describe("Delegation ID to reject"), reason: z.string().describe("Why you're rejecting this task") }) }, delegateReject);

    const delegateUpdate = async (args: any): Promise<ToolResult> => {
      const delegation = await hiring.updateStatus(args.delegation_id, args.status);
      return ok(`Delegation status: ${delegation.status}`);
    };
    sessionToolImpls["delegate.update"] = delegateUpdate;
    sessionServer.registerTool("delegate.update", { description: "Update a delegation's status to track progress.", inputSchema: z.object({ delegation_id: z.string().describe("Delegation ID to update"), status: z.enum(["pending", "accepted", "in_progress", "blocked", "completed", "rejected"]).describe("New status") }) }, delegateUpdate);

    const delegateGet = async (args: any): Promise<ToolResult> => {
      const delegation = await hiring.getDelegation(args.delegation_id);
      if (!delegation) return ok(`Delegation ${args.delegation_id} not found`);
      const lines: string[] = [`📋 **${delegation.task}**`, `From: ${delegation.from}`, `To: ${delegation.to}`, `Priority: ${delegation.priority}`, `Status: ${delegation.status}`, delegation.deadline ? `Deadline: ${delegation.deadline}` : ""];
      return ok(lines.filter(Boolean).join("\n"));
    };
    sessionToolImpls["delegate.get"] = delegateGet;
    sessionServer.registerTool("delegate.get", { description: "Get full details of a delegation.", inputSchema: z.object({ delegation_id: z.string().describe("Delegation ID") }) }, delegateGet);

    const hireGetTeam = async (args: any): Promise<ToolResult> => {
      const contracts = await hiring.getContractsForManager(args.manager_id);
      if (contracts.length === 0) return ok(`${args.manager_id} has no team members.`);
      const lines: string[] = [`👥 **Team for ${args.manager_id}**\n`];
      for (const contract of contracts) { lines.push(`• ${contract.role} (${contract.agent_id})`); lines.push(`  └─ Tasks: ${contract.tasks.join(", ")}`); }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["hire.getTeam"] = hireGetTeam;
    sessionServer.registerTool("hire.getTeam", { description: "Get all auxiliary staff reporting to a manager with their tasks.", inputSchema: z.object({ manager_id: z.string().describe("Manager agent ID") }) }, hireGetTeam);

    // === TEAM HEALTH ===
    const agentStatus = async (args: { agent_id: string }): Promise<ToolResult> => {
      const { getAgentHealthRegistry } = await import("../scheduler/agent-health.js");
      const { getStaffById } = await import("../staff/core-staff.js");
      const health = getAgentHealthRegistry().getStatus(args.agent_id);
      const staff = getStaffById(args.agent_id);
      if (!health) return ok(`No health data for ${args.agent_id}`);
      const statusEmoji: Record<string, string> = { healthy: "🟢", degraded: "🟡", silent: "⚫", error: "🔴" };
      const emoji = statusEmoji[health.status] || "⚪";
      const lines = [
        `${emoji} **${staff?.name || args.agent_id}** — ${staff?.title || ""}`,
        `Status: **${health.status}**`,
        `Last heartbeat: ${health.lastHeartbeat > 0 ? new Date(health.lastHeartbeat).toLocaleTimeString() : "never"}`,
        `Last response: ${health.lastResponse > 0 ? new Date(health.lastResponse).toLocaleTimeString() : "never"}`,
        `Pending messages: ${health.pendingMessages}`,
        `Consecutive failures: ${health.consecutiveFailures}`,
        `Errors (24h): ${health.errorCount24h}`,
      ];
      return ok(lines.join("\n"));
    };
    sessionToolImpls["agent.status"] = agentStatus;
    sessionServer.registerTool("agent.status", { description: "Get agent health and workload status — heartbeat recency, pending messages, failure counts.", inputSchema: z.object({ agent_id: z.string().describe("Agent ID to check") }) }, agentStatus);

    const orgHealth = async (): Promise<ToolResult> => {
      const { getAgentHealthRegistry } = await import("../scheduler/agent-health.js");
      const team = getAgentHealthRegistry().getTeamStatus();
      const statusEmoji: Record<string, string> = { healthy: "🟢", degraded: "🟡", silent: "⚫", error: "🔴" };
      const silent = getAgentHealthRegistry().getSilentAgents();
      const lines = ["🏢 **Team Health Overview**\n"];
      for (const h of team) {
        const emoji = statusEmoji[h.status] || "⚪";
        lines.push(`${emoji} **${h.name}** — ${h.status} | PM: ${h.pendingMessages} | F: ${h.consecutiveFailures}`);
      }
      if (silent.length > 0) {
        lines.push(`\n⚠️ **Silent agents**: ${silent.join(", ")}`);
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["org.health"] = orgHealth;
    sessionServer.registerTool("org.health", { description: "Get team-wide health overview with silent agent detection. Shows status for all agents at a glance.", inputSchema: z.object({}) }, orgHealth);

    // === BOARD MEETING TOOLS ===
    const boardmeetingRun = async (args: any): Promise<ToolResult> => {
      // CEO-only enforcement: runtime identity check
      if (callerAgentId && callerAgentId !== "ceo-strategic") {
        return ok("❌ Access denied: boardmeeting.run is restricted to the CEO agent.");
      }
      try {
        const meeting = await runFullBoardMeeting(args.objective);
        if (!meeting) return ok("❌ Error: Board meeting engine returned null");
        const turns = meeting.turns?.length ?? 0;
        const reportPreview = meeting.report ? meeting.report.slice(0, 500) : "No report generated.";
        return ok(`✅ Board meeting completed: ${meeting.id}\nTurns: ${turns}\nStatus: ${meeting.status}${args.objective ? `\nObjective: ${args.objective}` : ""}\n\n${reportPreview}${meeting.report && meeting.report.length > 500 ? "\n\n[...report truncated]" : ""}`);
      } catch (err: any) {
        const msg = err?.message || String(err);
        logger.error({ err: msg }, "Failed to run board meeting");
        return ok(`❌ Failed to run board meeting: ${msg}`);
      }
    };
    sessionToolImpls["boardmeeting.run"] = boardmeetingRun;
    sessionServer.registerTool("boardmeeting.run", {
      description: "Trigger an immediate board meeting across all agents. CEO-only tool — restricted to ceo-strategic.",
      inputSchema: z.object({ objective: z.string().optional().describe("Optional meeting objective/focus") })
    }, boardmeetingRun);

    const boardmeetingStatus = async (): Promise<ToolResult> => {
      const meeting = getActiveMeeting();
      if (!meeting) return ok("No active board meeting.");
      const statusLines = [
        `🏛 **Board Meeting Status**`,
        `ID: ${meeting.id}`,
        `Date: ${meeting.date}`,
        `Status: ${meeting.status}`,
        meeting.objective ? `Objective: ${meeting.objective}` : "",
        `Turns completed: ${meeting.turns.length}`,
        meeting.started_at ? `Started: ${new Date(meeting.started_at).toISOString()}` : "",
        meeting.concluded_at ? `Concluded: ${new Date(meeting.concluded_at).toISOString()}` : "",
      ].filter(Boolean);
      return ok(statusLines.join("\n"));
    };
    sessionToolImpls["boardmeeting.status"] = boardmeetingStatus;
    sessionServer.registerTool("boardmeeting.status", {
      description: "Get current board meeting state if active — shows ID, turns, objective, and timestamps.",
      inputSchema: z.object({})
    }, boardmeetingStatus);

    const boardmeetingGet = async (args: { meeting_id: string }): Promise<ToolResult> => {
      const meeting = getMeeting(args.meeting_id);
      if (!meeting) return ok(`Meeting ${args.meeting_id} not found`);
      const reportPreview = meeting.report
        ? meeting.report.length > 500
          ? meeting.report.slice(0, 500) + "\n\n[...report truncated]"
          : meeting.report
        : "No report generated.";
      const lines: string[] = [
        `🏛 **Board Meeting: ${meeting.id}**`,
        `Date: ${meeting.date}`,
        `Status: ${meeting.status}`,
        meeting.objective ? `Objective: ${meeting.objective}` : "",
        `Turns completed: ${meeting.turns.length}`,
        meeting.started_at ? `Started: ${new Date(meeting.started_at).toISOString()}` : "",
        meeting.concluded_at ? `Concluded: ${new Date(meeting.concluded_at).toISOString()}` : "",
        "",
        `**Report Preview:**`,
        reportPreview,
      ].filter(Boolean);
      if (meeting.user_decision) {
        lines.push(`\n**User Decision:** ${meeting.user_decision}`);
      }
      if (meeting.user_feedback) {
        lines.push(`**User Feedback:** ${meeting.user_feedback}`);
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["boardmeeting.get"] = boardmeetingGet;
    sessionServer.registerTool("boardmeeting.get", {
      description: "Retrieve a past board meeting by ID — shows date, status, objective, report preview, and any user decisions/feedback.",
      inputSchema: z.object({ meeting_id: z.string().describe("The meeting ID to retrieve") })
    }, boardmeetingGet);

    const boardmeetingList = async (args: { limit?: number; status?: string }): Promise<ToolResult> => {
      const engine = getBoardMeetingEngine();
      if (!engine) return ok("No board meeting engine initialized.");
      const limit = args.limit || 10;
      let sql = "SELECT id, date, status, objective, started_at FROM board_meetings";
      const params: unknown[] = [];
      if (args.status) {
        sql += " WHERE status = ?";
        params.push(args.status);
      }
      sql += " ORDER BY started_at DESC LIMIT ?";
      params.push(limit);
      const rows = (engine as any).queryAllArrays(sql, params);
      if (!rows || rows.length === 0) return ok("No board meetings found.");
      const lines: string[] = [`🏛 **Board Meetings** (${rows.length} results)\n`];
      for (const row of rows) {
        const [id, date, status, objective, startedAt] = row as [string, string, string, string | null, number];
        const obj = objective ? (objective.length > 80 ? objective.slice(0, 80) + "..." : objective) : "(no objective)";
        const ts = startedAt ? new Date(startedAt).toISOString().slice(0, 16) : "unknown";
        lines.push(`• **${id}** | ${date} | ${status} | ${ts}`);
        lines.push(`  └─ ${obj}`);
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["boardmeeting.list"] = boardmeetingList;
    sessionServer.registerTool("boardmeeting.list", {
      description: "List historical board meetings — shows ID, date, status, and objective. Supports optional limit and status filter.",
      inputSchema: z.object({
        limit: z.number().optional().describe("Max meetings to return (default: 10)"),
        status: z.string().optional().describe("Filter by status (e.g., 'delivered', 'approved', 'in_progress')"),
      })
    }, boardmeetingList);

    // === HEARTBEAT & NOTIFY ===
    const heartbeatRun = async (): Promise<ToolResult> => { logger.info("Heartbeat"); return ok("Audit started"); };
    sessionToolImpls["heartbeat.runNow"] = heartbeatRun;
    sessionServer.registerTool("heartbeat.runNow", { description: "Trigger an immediate system health audit.", inputSchema: z.object({}) }, heartbeatRun);

    const notifyTg = async (args: any): Promise<ToolResult> => {
      const { text, priority = "info" } = args;
      const sent = await sendTelegramMessage(text);
      if (sent) { logger.info({ text: text.substring(0, 50), priority }, "Telegram notification sent"); return ok(`✅ Notification sent to Telegram`); }
      else { logger.warn({ text: text.substring(0, 50) }, "Failed to send Telegram notification"); return ok(`⚠️ Telegram not configured - notification logged only`); }
    };
    sessionToolImpls["notify.telegram"] = notifyTg;
    sessionServer.registerTool("notify.telegram", { description: "Send a notification to the user (Ishan) via Telegram. ONLY for critical, time-sensitive items.", inputSchema: z.object({ text: z.string().describe("Notification message"), priority: z.enum(["info", "warning", "urgent"]).optional().default("info").describe("Notification urgency level") }) }, notifyTg);

    // === REPORTS & SESSIONS TOOLS ===
    const reportsSave = async (args: any): Promise<ToolResult> => {
      const rs = await getReportsAndSessions();
      const report = await rs.saveReport({ agent_id: args.agent_id, period: args.period, summary: args.summary, metrics: args.metrics, actions: args.actions });
      return ok(`Report saved: ${report.id}`);
    };
    sessionToolImpls["reports.save"] = reportsSave;
    sessionServer.registerTool("reports.save", { description: "Save a periodic report with summary, metrics, and action items.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), period: z.string().describe("Report period (e.g., '2024-W01')"), summary: z.string().describe("Report summary text"), metrics: z.record(z.unknown()).optional().describe("Key-value metrics data"), actions: z.array(z.object({ description: z.string().describe("Action item description"), assignee: z.string().optional().describe("Responsible agent ID"), due: z.string().optional().describe("Due date (ISO string)") })).optional().describe("Follow-up action items") }) }, reportsSave);

    const reportsGetLatest = async (args: any): Promise<ToolResult> => {
      const rs = await getReportsAndSessions();
      const reports = await rs.getLatestReports(args.agent_id, args.limit || 5);
      try { return ok(JSON.stringify(reports, null, 2)); } catch { return ok("[]"); }
    };
    sessionToolImpls["reports.getLatest"] = reportsGetLatest;
    sessionServer.registerTool("reports.getLatest", { description: "Get the most recent reports for an agent.", inputSchema: z.object({ agent_id: z.string().describe("Agent ID whose reports to fetch"), limit: z.number().optional().describe("Max reports to return (default: 5)") }) }, reportsGetLatest);

    const sessionsCreate = async (args: any): Promise<ToolResult> => {
      const rs = await getReportsAndSessions();
      const session = await rs.createSession(args.agent_id, args.chat_id);
      return ok(session.id);
    };
    sessionToolImpls["sessions.create"] = sessionsCreate;
    sessionServer.registerTool("sessions.create", { description: "Create a new session for an agent and chat combination.", inputSchema: z.object({ agent_id: z.string().describe("Agent ID"), chat_id: z.string().describe("Chat/channel ID") }) }, sessionsCreate);

    const sessionsGet = async (args: any): Promise<ToolResult> => {
      const rs = await getReportsAndSessions();
      const session = await rs.getSession(args.session_id);
      return ok(session ? (() => { try { return JSON.stringify(session, null, 2); } catch { return "Session data error"; } })() : "Session not found");
    };
    sessionToolImpls["sessions.get"] = sessionsGet;
    sessionServer.registerTool("sessions.get", { description: "Get session details by ID.", inputSchema: z.object({ session_id: z.string().describe("Session ID") }) }, sessionsGet);

    const sessionsGetActive = async (args: any): Promise<ToolResult> => {
      const rs = await getReportsAndSessions();
      const session = await rs.getActiveSession(args.agent_id, args.chat_id);
      return ok(session ? (() => { try { return JSON.stringify(session, null, 2); } catch { return "Session data error"; } })() : "No active session");
    };
    sessionToolImpls["sessions.getActive"] = sessionsGetActive;
    sessionServer.registerTool("sessions.getActive", { description: "Get the active session for an agent and chat combination.", inputSchema: z.object({ agent_id: z.string().describe("Agent ID"), chat_id: z.string().describe("Chat/channel ID") }) }, sessionsGetActive);

    const sessionsLogStep = async (args: any): Promise<ToolResult> => {
      const rs = await getReportsAndSessions();
      const step = await rs.logStep({ session_id: args.session_id, step_num: args.step_num, step_type: args.step_type, tool: args.tool, args_hash: args.args_hash, obs_summary: args.obs_summary });
      return ok(`Step logged: ${step.id}`);
    };
    sessionToolImpls["sessions.logStep"] = sessionsLogStep;
    sessionServer.registerTool("sessions.logStep", { description: "Log a step in a session's execution trace.", inputSchema: z.object({ session_id: z.string().describe("Session ID"), step_num: z.number().describe("Step number in sequence"), step_type: z.enum(["thought", "tool_call", "observation", "final"]).describe("Type of step"), tool: z.string().optional().describe("Tool name (for tool_call steps)"), args_hash: z.string().optional().describe("Hash of tool arguments"), obs_summary: z.string().optional().describe("Observation summary") }) }, sessionsLogStep);

    const sessionsGetSteps = async (args: any): Promise<ToolResult> => {
      const rs = await getReportsAndSessions();
      const steps = await rs.getSessionSteps(args.session_id, args.limit || 10);
      try { return ok(JSON.stringify(steps, null, 2)); } catch { return ok("[]"); }
    };
    sessionToolImpls["sessions.getSteps"] = sessionsGetSteps;
    sessionServer.registerTool("sessions.getSteps", { description: "Get execution steps for a session.", inputSchema: z.object({ session_id: z.string().describe("Session ID"), limit: z.number().optional().describe("Max steps to return (default: 10)") }) }, sessionsGetSteps);

    const memoryConsolidate = async (args: any): Promise<ToolResult> => {
      if (!memoryFacade) return ok("Error: MemoryFacade not initialized");
      const id = await memoryFacade.consolidate(args.scope, args.agent_id, args.tag);
      return ok(id ? `Consolidated into memory ${id}` : "Not enough memories to consolidate (need 3+ matching)");
    };
    sessionToolImpls["memory.consolidate"] = memoryConsolidate;
    sessionServer.registerTool("memory.consolidate", { description: "Consolidate related memories into a single summary. Groups memories by tag, asks LLM to summarize, replaces originals. Use for memory hygiene — run periodically on tags with many entries.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), scope: z.enum(["personal", "project", "company"]).describe("Memory scope"), tag: z.string().describe("Tag to consolidate (e.g., 'proactive-work', 'scheduled-task')") }) }, memoryConsolidate);

    const memoryForget = async (args: any): Promise<ToolResult> => {
      if (!memoryFacade) return ok("Error: MemoryFacade not initialized");
      const resolved = withCallerIdentity(args);
      if (resolved.id) { const ok2 = await memoryFacade.forget(resolved.scope, resolved.id); return ok(ok2 ? `Memory ${resolved.id} deleted` : "Memory not found"); }
      if (resolved.tag && resolved.agent_id) { const deleted = await memoryFacade.forgetByTag(resolved.scope, resolved.agent_id, resolved.tag); return ok(`Deleted ${deleted} memories with tag "${resolved.tag}"`); }
      return ok("Error: provide either 'id' or ('tag' + 'agent_id')");
    };
    sessionToolImpls["memory.forget"] = memoryForget;
    sessionServer.registerTool("memory.forget", { description: "Delete memories by ID or by tag+agent combination. Use to clean up outdated or incorrect memories.", inputSchema: z.object({ scope: z.enum(["personal", "project", "company"]).describe("Memory scope"), id: z.string().optional().describe("Specific memory ID to delete"), agent_id: z.string().optional().describe("Agent ID (for tag-based deletion)"), tag: z.string().optional().describe("Tag to delete all matching memories") }) }, memoryForget);

    const memoryStats = async (): Promise<ToolResult> => {
      if (!memoryFacade) return ok("Error: MemoryFacade not initialized");
      const stats = await memoryFacade.stats();
      try { return ok(JSON.stringify(stats, null, 2)); } catch { return ok("{}"); }
    };
    sessionToolImpls["memory.stats"] = memoryStats;
    sessionServer.registerTool("memory.stats", { description: "Show memory statistics — total entries per scope, per-agent breakdown. Use to monitor memory growth.", inputSchema: z.object({}) }, memoryStats);

    // === CRON / SCHEDULING TOOLS ===

    const cronStatus = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const scheduler = await getAgentScheduler();
      const tasks = await scheduler.getTasksForAgent(resolved.agent_id);
      const active = tasks.filter(t => t.enabled && t.status === "active");
      const paused = tasks.filter(t => !t.enabled || t.status === "paused");
      const lines: string[] = [`⏱ **Scheduled Tasks for ${resolved.agent_id}**\n`];
      lines.push(`Active: ${active.length} | Paused: ${paused.length} | Total: ${tasks.length}`);
      if (active.length > 0) {
        lines.push("\n**Active Tasks:**");
        for (const t of active.slice(0, 10)) {
          const nextRun = t.next_run > 0 ? new Date(t.next_run).toLocaleString() : "event-driven";
          const schedType = t.schedule_type === "cron" ? `cron: ${t.cron_expression}` : t.schedule_type === "interval" ? `every ${t.interval_seconds}s` : t.schedule_type === "once" ? `once: ${new Date(t.trigger_time || 0).toLocaleString()}` : `on_event: ${t.event_name}`;
          lines.push(`• **${t.name}** (${t.action}) — ${schedType} — next: ${nextRun} — runs: ${t.run_count}`);
        }
      }
      if (paused.length > 0) {
        lines.push(`\n**Paused/Completed:** ${paused.map(t => t.name).join(", ")}`);
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["cron.status"] = cronStatus;
    sessionServer.registerTool("cron.status", { description: "Check your scheduled tasks — active, paused, total counts with next run times.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID") }) }, cronStatus);

    const cronList = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const scheduler = await getAgentScheduler();
      const tasks = await scheduler.getTasksForAgent(resolved.agent_id, args.includeDisabled || false);
      if (tasks.length === 0) return ok("No scheduled tasks found.");
      const lines: string[] = [`📋 **Scheduled Tasks** (${tasks.length})\n`];
      for (const t of tasks) {
        const status = t.enabled ? (t.status === "active" ? "🟢" : "🟡") : "🔴";
        const nextRun = t.next_run > 0 ? new Date(t.next_run).toLocaleString() : "—";
        lines.push(`${status} **${t.name}** — ${t.action} — next: ${nextRun} — runs: ${t.run_count}, fails: ${t.fail_count}`);
        lines.push(`   ID: \`${t.id}\``);
      }
      return ok(lines.join("\n"));
    };
    sessionToolImpls["cron.list"] = cronList;
    sessionServer.registerTool("cron.list", { description: "List all your scheduled tasks with details. Use includeDisabled=true to see paused/completed ones.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), includeDisabled: z.boolean().optional().describe("Include paused/completed tasks") }) }, cronList);

    const cronCreate = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const scheduler = await getAgentScheduler();
      const task = await scheduler.createTask({
        agent_id: resolved.agent_id,
        name: resolved.name,
        description: resolved.description,
        schedule_type: resolved.schedule_type,
        cron_expression: resolved.cron_expression,
        interval_seconds: resolved.interval_seconds,
        trigger_time: resolved.trigger_time,
        event_name: resolved.event_name,
        action: resolved.action,
        action_params: resolved.action_params || {},
      });
      const nextRun = task.next_run > 0 ? new Date(task.next_run).toLocaleString() : "event-driven";
      return ok(`✅ **Task Created: ${task.name}**\n\nID: \`${task.id}\`\nAction: ${task.action}\nSchedule: ${task.schedule_type} — next: ${nextRun}\nDescription: ${task.description}`);
    };
    sessionToolImpls["cron.create"] = cronCreate;
    sessionServer.registerTool("cron.create", {
      description: "Create a scheduled task — cron, interval, once, or event-triggered. Use for recurring work like reports, health checks, or data syncs.",
      inputSchema: z.object({
        agent_id: z.string().describe("Your agent ID"),
        name: z.string().describe("Task name"),
        description: z.string().describe("Task description"),
        schedule_type: z.enum(["interval", "cron", "once", "on_event"]),
        cron_expression: z.string().regex(/^([0-9*/,.-]+)\s+([0-9*/,.-]+)\s+([0-9*/,.-]+)\s+([0-9*/,.-]+)\s+([0-9*/,.-]+)$/).max(100).optional().describe("Cron expression (for schedule_type='cron')"),
        interval_seconds: z.number().optional().describe("Interval in seconds (for schedule_type='interval')"),
        trigger_time: z.number().optional().describe("Unix timestamp ms (for schedule_type='once')"),
        event_name: z.string().optional().describe("Event name (for schedule_type='on_event')"),
        action: z.enum(["query_database", "check_kanban", "send_report", "call_agent", "custom_prompt", "telegram_notify"]),
        action_params: z.record(z.unknown()).optional().describe("Action-specific parameters"),
      }),
    }, cronCreate);

    const cronPause = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const scheduler = await getAgentScheduler();
      const result = await scheduler.pauseTask(resolved.task_id);
      return result ? ok(`⏸ Task paused: ${resolved.task_id}`) : ok("Task not found");
    };
    sessionToolImpls["cron.pause"] = cronPause;
    sessionServer.registerTool("cron.pause", { description: "Pause a scheduled task by ID.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), task_id: z.string().describe("Task ID to pause") }) }, cronPause);

    const cronResume = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const scheduler = await getAgentScheduler();
      const result = await scheduler.resumeTask(resolved.task_id);
      return result ? ok(`▶️ Task resumed: ${resolved.task_id}`) : ok("Task not found");
    };
    sessionToolImpls["cron.resume"] = cronResume;
    sessionServer.registerTool("cron.resume", { description: "Resume a previously paused scheduled task by ID.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), task_id: z.string().describe("Task ID to resume") }) }, cronResume);

    const cronDelete = async (args: any): Promise<ToolResult> => {
      const resolved = withCallerIdentity(args);
      const scheduler = await getAgentScheduler();
      const result = await scheduler.deleteTask(resolved.task_id);
      return result ? ok(`🗑 Task deleted: ${resolved.task_id}`) : ok("Task not found");
    };
    sessionToolImpls["cron.delete"] = cronDelete;
    sessionServer.registerTool("cron.delete", { description: "Delete a scheduled task permanently by ID.", inputSchema: z.object({ agent_id: z.string().describe("Your agent ID"), task_id: z.string().describe("Task ID to delete") }) }, cronDelete);

    const cronRun = async (args: any): Promise<ToolResult> => {
      const scheduler = await getAgentScheduler();
      const count = await scheduler.triggerTask(args.event_name);
      return ok(count > 0 ? `⚡ Event '${args.event_name}' triggered ${count} task(s)` : `No tasks listening for event '${args.event_name}'`);
    };
    sessionToolImpls["cron.run"] = cronRun;
    sessionServer.registerTool("cron.run", { description: "Trigger an event-based task immediately by event name.", inputSchema: z.object({ event_name: z.string().describe("Event name to trigger") }) }, cronRun);

    // === FILESYSTEM TOOLS ===
    const fsReadTool = createFsReadTool();
    sessionServer.registerTool("fs.read", {
      description: fsReadTool.description,
      inputSchema: z.object({
        file_path: z.string().describe("Path to the file, relative to your workspace directory."),
        agent_id: z.string().optional().describe("Your agent ID (auto-injected)."),
      }),
    }, async (args) => {
      const result = await fsReadTool.execute("mcp", { ...args, agent_id: args.agent_id || callerAgentId });
      const firstText = result.content?.[0]?.text; if (!firstText) return ok("Tool returned empty content"); return ok(firstText);
    });

    const fsWriteTool = createFsWriteTool();
    sessionServer.registerTool("fs.write", {
      description: fsWriteTool.description,
      inputSchema: z.object({
        file_path: z.string().describe("Path to the file, relative to your workspace directory."),
        content: z.string().describe("Content to write."),
        agent_id: z.string().optional().describe("Your agent ID (auto-injected)."),
        append: z.boolean().optional().describe("Append to existing file. Default: false."),
      }),
    }, async (args) => {
      const result = await fsWriteTool.execute("mcp", { ...args, agent_id: args.agent_id || callerAgentId });
      const firstText = result.content?.[0]?.text; if (!firstText) return ok("Tool returned empty content"); return ok(firstText);
    });

    const fsEditTool = createFsEditTool();
    sessionServer.registerTool("fs.edit", {
      description: fsEditTool.description,
      inputSchema: z.object({
        file_path: z.string().describe("Path to the file, relative to your workspace directory."),
        old_string: z.string().describe("Exact text to replace."),
        new_string: z.string().describe("Replacement text."),
        agent_id: z.string().optional().describe("Your agent ID (auto-injected)."),
      }),
    }, async (args) => {
      const result = await fsEditTool.execute("mcp", { ...args, agent_id: args.agent_id || callerAgentId });
      const firstText = result.content?.[0]?.text; if (!firstText) return ok("Tool returned empty content"); return ok(firstText);
    });

    const bashToolInstance = createBashTool();
    sessionServer.registerTool("bash", {
      description: bashToolInstance.description,
      inputSchema: z.object({
        command: z.string().describe("Command to execute (e.g., 'ls', 'git', 'node')."),
        args: z.array(z.string()).optional().describe("Command arguments."),
        agent_id: z.string().optional().describe("Your agent ID (auto-injected)."),
        cwd: z.string().optional().describe("Working directory (relative to workspace)."),
        timeout_ms: z.number().optional().describe("Timeout in ms (default: 30000)."),
      }),
    }, async (args) => {
      const result = await bashToolInstance.execute("mcp", { ...args, agent_id: args.agent_id || callerAgentId });
      const firstText = result.content?.[0]?.text; if (!firstText) return ok("Tool returned empty content"); return ok(firstText);
    });

    // === SOURCE CODE TOOLS (CTO only) ===
    const codeReadTool = createCodeReadTool();
    sessionServer.registerTool("code.read", {
      description: codeReadTool.description,
      inputSchema: z.object({
        file_path: z.string().describe("Path to the file, relative to the source code workspace root."),
        agent_id: z.string().optional().describe("Your agent ID (auto-injected)."),
      }),
    }, async (args) => {
      const result = await codeReadTool.execute("mcp", { ...args, agent_id: args.agent_id || callerAgentId });
      const firstText = result.content?.[0]?.text; if (!firstText) return ok("Tool returned empty content"); return ok(firstText);
    });

    const codeWriteTool = createCodeWriteTool();
    sessionServer.registerTool("code.write", {
      description: codeWriteTool.description,
      inputSchema: z.object({
        file_path: z.string().describe("Path to the file, relative to the source code workspace root."),
        content: z.string().describe("Content to write."),
        agent_id: z.string().optional().describe("Your agent ID (auto-injected)."),
        append: z.boolean().optional().describe("Append to existing file. Default: false."),
      }),
    }, async (args) => {
      const result = await codeWriteTool.execute("mcp", { ...args, agent_id: args.agent_id || callerAgentId });
      const firstText = result.content?.[0]?.text; if (!firstText) return ok("Tool returned empty content"); return ok(firstText);
    });

    const codeEditTool = createCodeEditTool();
    sessionServer.registerTool("code.edit", {
      description: codeEditTool.description,
      inputSchema: z.object({
        file_path: z.string().describe("Path to the file, relative to the source code workspace root."),
        old_string: z.string().describe("The exact text to replace."),
        new_string: z.string().describe("The new text to insert."),
        agent_id: z.string().optional().describe("Your agent ID (auto-injected)."),
      }),
    }, async (args) => {
      const result = await codeEditTool.execute("mcp", { ...args, agent_id: args.agent_id || callerAgentId });
      const firstText = result.content?.[0]?.text; if (!firstText) return ok("Tool returned empty content"); return ok(firstText);
    });

    return { server: sessionServer, toolImpls: sessionToolImpls };
  }

  // Initialize shared tool implementations (for executor + stdio mode)
  const { server: initServer, toolImpls: initTools } = createSessionServer();
  await initServer.close(); // We just needed the tool implementations, not the server
  Object.assign(toolImpls, initTools);

  // Register image and TTS tools (if API configured)
  const imageAnalyze = createImageAnalyzeTool();
  if (imageAnalyze) toolImpls["image.analyze"] = (args) => imageAnalyze.execute("", args);

  const imageGenerate = createImageGenerateTool();
  if (imageGenerate) toolImpls["image.generate"] = (args) => imageGenerate.execute("", args);

  const ttsSynthesize = createTtsSynthesizeTool();
  if (ttsSynthesize) toolImpls["tts.synthesize"] = (args) => ttsSynthesize.execute("", args);

  const httpServer = createServer(async (req, res) => {
    // CORS headers — restrict to same-origin (localhost)
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      if (req.method === "GET") {
        // SSE connection — create a new session
        if (sseTransports.size >= MAX_SSE_SESSIONS) {
          res.writeHead(503, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
          res.end("Too Many Sessions");
          return;
        }
        const agentId = url.searchParams.get("agentId") || undefined;
        const { server: sessionServer, toolImpls: sessionToolImpls } = createSessionServer(agentId);
        const sseTransport = new SSEServerTransport("/mcp", res);

        res.on('close', () => {
          if (!sseTransports.has(sseTransport.sessionId)) {
            sessionServer.close().catch(() => {});
          }
        });

        try {
          await sessionServer.connect(sseTransport);
          sseTransports.set(sseTransport.sessionId, { transport: sseTransport, server: sessionServer });
          if (agentId) sessionAgentMap.set(sseTransport.sessionId, agentId);
        } catch (err: any) {
          logger.error({ err: err.message }, "Failed to connect SSE session");
          if (!res.writableEnded) {
            res.writeHead(500, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
            res.end("Connection Failed");
          }
          sessionServer.close().catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "server close error"));
          return;
        }

        sseTransport.onclose = () => {
          const entry = sseTransports.get(sseTransport.sessionId);
          sseTransports.delete(sseTransport.sessionId);
          sessionAgentMap.delete(sseTransport.sessionId);
          entry?.server.close().catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "SSE session close error"));
          logger.info({ sessionId: sseTransport.sessionId }, "SSE session closed");
        };

        logger.info({ sessionId: sseTransport.sessionId, agentId }, "New SSE session created");
      } else if (req.method === "POST") {
        // Incoming message — route to the correct session
        const sessionId = url.searchParams.get("sessionId");
        const entry = sessionId ? sseTransports.get(sessionId) : undefined;
        const transport = entry?.transport;
        if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: `Session not found: ${sessionId}` }, id: null }));
          return;
        }
        try {
          const MAX_BODY_SIZE = 1024 * 1024; // 1MB
          let body = "";
          let aborted = false;
          req.on("data", chunk => {
            body += chunk;
            if (body.length > MAX_BODY_SIZE) {
              aborted = true;
              req.destroy();
              if (!res.writableEnded) {
                res.writeHead(413, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
                res.end("Payload too large");
              }
              return;
            }
          });
          req.on("end", async () => {
            if (aborted) return;
            try {
              const parsed = JSON.parse(body);
              if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                if ("__proto__" in parsed) delete (parsed as any).__proto__;
              }
              await transport.handlePostMessage(req, res, parsed);
            } catch {
              if (!res.writableEnded) {
                res.writeHead(400, { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
                res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
              }
            }
          });
          req.on("error", (err: Error) => {
            logger.warn({ err: err.message }, "SSE POST stream error");
            if (!res.writableEnded) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
            }
          });
        } catch (err: any) {
          logger.error({ err: err.message }, "POST handling failed");
          if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
          }
        }
      } else {
        res.writeHead(405, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
        res.end("Method Not Allowed");
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
      res.end("Not Found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(MCP_PORT, "127.0.0.1", () => {
      logger.info({ port: MCP_PORT }, "Strategos MCP HTTP server running");
      resolve();
    }).on("error", reject);
});
  httpServer.headersTimeout = 10_000;
  httpServer.requestTimeout = 15_000;
  httpServer.timeout = 30_000;
  httpServer.on("clientError", (err, socket) => { socket.destroy(); });

  // Also connect stdio transport if MCP_STDIO=1 (for direct CLI usage)
  let stdioServer: McpServer | null = null;
  if (process.env.MCP_STDIO === "1") {
    const { server: s, toolImpls: stdioTools } = createSessionServer();
    stdioServer = s;
    Object.assign(toolImpls, stdioTools);
    const stdioTransport = new StdioServerTransport();
    await stdioServer.connect(stdioTransport);
    logger.info("Strategos MCP stdio transport connected");
  }

  const executor: ToolExecutor = {
    executeTool: async (name, args) => { const impl = toolImpls[name]; if (!impl) throw new Error(`Unknown: ${name}`); return impl(args); }
  };

  const shutdown = async () => {
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
    for (const { server } of sseTransports.values()) {
      await server.close().catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "shutdown server close error"));
    }
    sseTransports.clear();
    if (stdioServer) {
      await stdioServer.close().catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "shutdown stdio close error"));
    }
    logger.info("Strategos MCP server shut down");
  };


  return { httpServer, ctx: { memory, memoryFacade, kanban, messaging, meetings, hiring }, executor, shutdown };
}
