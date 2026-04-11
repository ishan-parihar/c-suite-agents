// Agent Context Management — Wake-up Context & Memory Recall

import { logger } from "../logger";
import { getMessagingSystem, type MessageSearchResult, type MessageThread } from "./messaging";
import { getMeetingGovernance } from "./meetings";
import { getHiringSystem } from "./hiring";
import { getStaffById } from "../staff/core-staff";
import { Kanban, type KanbanBoard } from "../kanban/sqlite";
import { Memory } from "../memory/lancedb";
import { getBehavioralProfile, formatBehavioralPrompt } from "../memory/behavioral-profile";

export interface AgentWakeContext {
  agent_id: string;
  timestamp: number;
  
  // Immediate priorities (conscious mind)
  urgent_items: {
    pending_responses: number;
    unread_messages: number;
    blocked_tasks: number;
    escalations: number;
    meeting_votes_needed: number;
  };
  
  // Active context (working memory ~7±2 items)
  active_threads: Array<{
    thread_id: string;
    with: string;
    subject: string;
    last_message: string;
    priority: string;
    requires_action: boolean;
  }>;
  
  // Today's focus
  todays_tasks: Array<{
    card_id: string;
    title: string;
    priority: string;
    due?: string;
    status: string;
  }>;
  
  // Recent activity (last 24h)
  recent_activity: string[];
  
  // Quick recall handles (can search for more)
  memory_handles: {
    can_search_messages: boolean;
    can_search_tasks: boolean;
    can_search_memory: boolean;
  };
}

export interface RecallResult {
  query: string;
  results: Array<{
    type: "message" | "task" | "memory" | "meeting";
    id: string;
    summary: string;
    relevance: number;
    metadata: Record<string, any>;
  }>;
  total_found: number;
}

export class AgentContextManager {
  private kanban: Kanban;
  private memory: Memory;

  constructor(kanban: Kanban, memory: Memory) {
    this.kanban = kanban;
    this.memory = memory;
  }

  // Generate wake-up context for an agent
  async getWakeContext(agent_id: string): Promise<AgentWakeContext> {
    const staff = getStaffById(agent_id);
    const messaging = await getMessagingSystem();
    const meetings = getMeetingGovernance();
    const hiring = await getHiringSystem();

    logger.info({ agent_id }, "Generating wake context");

    // Get messaging context
    const msgContext = await messaging.getActiveContext(agent_id);

    // Get Kanban board
    const board = await this.kanban.getBoard(agent_id);
    const blockedTasks = board?.columns.find(c => c.name === "Blocked")?.cards.length || 0;
    const inProgressTasks = board?.columns.find(c => c.name === "In Progress")?.cards.slice(0, 5) || [];

    // Get active meetings requiring votes
    const activeProposals = await meetings.getActiveProposals();
    const votesNeeded = activeProposals.filter(p => !p.votes[agent_id]).length;

    // Get delegations
    const delegations = await hiring.getActiveDelegations();
    const pendingDelegations = delegations.filter(d => d.to === agent_id && d.status === "pending");

    // Build active threads summary (limit to 7±2 for working memory)
    const active_threads = msgContext.active_threads.slice(0, 7).map(t => {
      const lastMsg = undefined; // Simplified - would need async map
      const other = t.participants.find(p => p !== agent_id);
      return {
        thread_id: t.id,
        with: other || "unknown",
        subject: t.subject,
        last_message: "",
        priority: "P3",
        requires_action: false
      };
    });

    // Build today's tasks
    const todays_tasks = inProgressTasks.map(card => ({
      card_id: card.id,
      title: card.title,
      priority: card.priority,
      due: card.due || undefined,
      status: card.status
    }));

    // Recent activity (from memory)
    const recentMemories = await this.memory.search(agent_id, "recent activity", 5);
    const recent_activity = recentMemories.map((m: any) => m.content || "").slice(0, 5);

    const context: AgentWakeContext = {
      agent_id,
      timestamp: Date.now(),
      urgent_items: {
        pending_responses: msgContext.pending_responses.length,
        unread_messages: msgContext.unread_count,
        blocked_tasks: blockedTasks,
        escalations: msgContext.recent_escalations.length,
        meeting_votes_needed: votesNeeded
      },
      active_threads,
      todays_tasks,
      recent_activity,
      memory_handles: {
        can_search_messages: true,
        can_search_tasks: true,
        can_search_memory: true
      }
    };

    return context;
  }

  // Format wake context as system prompt injection
  async formatWakeContext(context: AgentWakeContext): Promise<string> {
    const lines: string[] = [];
    
    lines.push(`## 🧠 Context for ${context.agent_id}`);
    lines.push(`**Time:** ${new Date(context.timestamp).toISOString()}`);
    lines.push("");

    // Urgent items (red flags)
    const urgent = context.urgent_items;
    if (urgent.pending_responses > 0 || urgent.unread_messages > 0 || urgent.blocked_tasks > 0) {
      lines.push("### ⚠️ Immediate Attention");
      if (urgent.pending_responses > 0) lines.push(`- **${urgent.pending_responses}** messages require response`);
      if (urgent.unread_messages > 0) lines.push(`- **${urgent.unread_messages}** unread messages`);
      if (urgent.blocked_tasks > 0) lines.push(`- **${urgent.blocked_tasks}** tasks blocked`);
      if (urgent.escalations > 0) lines.push(`- **${urgent.escalations}** escalations pending`);
      if (urgent.meeting_votes_needed > 0) lines.push(`- **${urgent.meeting_votes_needed}** meeting votes needed`);
      lines.push("");
    }

    // Active conversations
    if (context.active_threads.length > 0) {
      lines.push("### 💬 Active Conversations");
      for (const thread of context.active_threads) {
        const actionFlag = thread.requires_action ? " ⚡" : "";
        lines.push(`- **${thread.with}**: ${thread.subject} [${thread.priority}]${actionFlag}`);
        if (thread.last_message) {
          lines.push(`  └─ "${thread.last_message}"`);
        }
      }
      lines.push("");
    }

    // Today's tasks
    if (context.todays_tasks.length > 0) {
      lines.push("### 📋 Today's Focus");
      for (const task of context.todays_tasks) {
        lines.push(`- [${task.priority}] ${task.title}${task.due ? ` (due: ${task.due})` : ""}`);
      }
      lines.push("");
    }

    // Memory handles
    lines.push("### 🔍 Memory Access");
    lines.push("You can search for more information using:");
    lines.push("- `memory.search(agent_id, query)` — Search your memory");
    lines.push("- `message.search(agent_id, query)` — Search message history");
    lines.push("- `board.get(agent_id)` — View full Kanban board");
    lines.push("- `message.getThread(thread_id)` — Read full conversation");
    lines.push("");

    // If there are unread messages, tell agent how to read them
    if (urgent.unread_messages > 0) {
      lines.push("### 📥 Read Your Unread Messages");
      lines.push(`You have **${urgent.unread_messages}** unread messages. Use \`message.getUnread({ agent_id: "${context.agent_id}" })\` to read them all with full content.`);
      if (context.agent_id === "ceo-strategic") {
        lines.push("These are reports from other agents about their domain checks. Read them before responding to the user.");
      }
      lines.push("");
    }

    const behavioralPrompt = await formatBehavioralPrompt(await getBehavioralProfile(context.agent_id));
    if (behavioralPrompt) {
      lines.push(behavioralPrompt);
      lines.push("");
    }

    return lines.join("\n");
  }

  // Search across all memory systems
  async recall({
    agent_id,
    query,
    top_k = 10
  }: {
    agent_id: string;
    query: string;
    top_k?: number;
  }): Promise<RecallResult> {
    const messaging = await getMessagingSystem();
    const meetings = getMeetingGovernance();
    const hiring = await getHiringSystem();

    const results: RecallResult["results"] = [];

    // Search messages
    const msgResults = await messaging.searchMessages({
      agent_id,
      query,
      top_k: Math.floor(top_k / 2)
    });

    for (const r of msgResults) {
      results.push({
        type: "message",
        id: r.message.id,
        summary: `${r.message.from} → ${r.message.to}: ${r.snippet}`,
        relevance: r.relevance_score,
        metadata: {
          thread_id: r.thread.id,
          priority: r.message.priority,
          created_at: r.message.created_at
        }
      });
    }

    // Search memory (LanceDB)
    const memoryResults = await this.memory.search(agent_id, query, Math.floor(top_k / 3));
    for (const r of memoryResults) {
      results.push({
        type: "memory",
        id: r.id || "",
        summary: r.content || "",
        relevance: r.score || 0.5,
        metadata: {
          type: r.type,
          tags: r.tags,
          created_at: r.ts || r.created_at
        }
      });
    }

    // Search tasks (Kanban)
    const board = await this.kanban.getBoard(agent_id);
    if (board) {
      const allCards = board.columns.flatMap(c => c.cards);
      const matchingCards = allCards.filter(card => 
        card.title.toLowerCase().includes(query.toLowerCase()) ||
        card.description.toLowerCase().includes(query.toLowerCase())
      ).slice(0, Math.floor(top_k / 4));

      for (const card of matchingCards) {
        results.push({
          type: "task",
          id: card.id,
          summary: `${card.title} [${card.status}]`,
          relevance: 0.7,
          metadata: {
            status: card.status,
            priority: card.priority,
            due: card.due
          }
        });
      }
    }

    // Search meetings
    const activeProposals = await meetings.getActiveProposals();
    const matchingMeetings = activeProposals.filter(p =>
      p.title.toLowerCase().includes(query.toLowerCase()) ||
      p.reason.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 2);

    for (const m of matchingMeetings) {
      results.push({
        type: "meeting",
        id: m.id,
        summary: `${m.title} (${m.status})`,
        relevance: 0.6,
        metadata: {
          urgency: m.urgency,
          proposer: m.proposer,
          votes: m.votes
        }
      });
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    return {
      query,
      results: results.slice(0, top_k),
      total_found: results.length
    };
  }

  // Get specific message thread (like "pulling out phone to check chats")
  async getFullThread(thread_id: string): Promise<MessageThread | null> {
    const messaging = await getMessagingSystem();
    return messaging.getThread(thread_id);
  }

  // Get full task details
  async getFullTask(card_id: string): Promise<any> {
    return await this.kanban.getCard(card_id);
  }
}

// Export for use in MCP server
export { getMessagingSystem, getMeetingGovernance, getHiringSystem };
