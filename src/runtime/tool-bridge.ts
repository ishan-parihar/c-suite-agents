// Tool Bridge — Maps Strategos MCP tools to LLM tool-calling format
// Provides tool definitions (JSON Schema) and execution wrappers

import { z } from "zod";
import { logger } from "../logger.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * Build tool definitions for LLM function calling.
 * Takes the list of available tool names and returns JSON Schema definitions.
 */
export function buildToolDefinitions(toolNames: string[]): ToolDefinition[] {
  const allTools: Record<string, ToolDefinition> = {
    // Memory tools
    "memory.search": {
      name: "memory.search",
      description: "Search memory with vector similarity + metadata filters. Returns results sorted by combined score.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Your agent ID" },
          query: { type: "string", description: "Natural language search query" },
          top_k: { type: "number", description: "Max results (default: 10)" },
          scopes: { type: "array", items: { type: "string", enum: ["personal", "project", "company"] }, description: "Scopes to search" },
        },
        required: ["agent_id", "query"],
      },
    },
    "memory.recall": {
      name: "memory.recall",
      description: "Search across messages, tasks, and memory",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Your agent ID" },
          query: { type: "string", description: "Search query" },
          top_k: { type: "number", description: "Max results" },
        },
        required: ["agent_id", "query"],
      },
    },
    "memory.upsert": {
      name: "memory.upsert",
      description: "Save a memory with scope, type, and automatic deduplication.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Your agent ID" },
          scope: { type: "string", enum: ["personal", "project", "company"], description: "Memory scope" },
          kind: { type: "string", enum: ["episodic", "semantic", "procedural"], description: "Memory kind" },
          type: { type: "string", enum: ["note", "obs", "io", "log", "decision", "meeting", "insight"], description: "Memory type" },
          content: { type: "string", description: "Memory content" },
          importance: { type: "number", minimum: 0, maximum: 1, description: "Importance 0-1" },
          tags: { type: "array", items: { type: "string" }, description: "Tags" },
        },
        required: ["agent_id", "type", "content"],
      },
    },
    "memory.forget": {
      name: "memory.forget",
      description: "Delete memories by ID or by tag+agent combination.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["personal", "project", "company"] },
          id: { type: "string", description: "Specific memory ID to delete" },
          agent_id: { type: "string" },
          tag: { type: "string", description: "Tag to delete all matching memories" },
        },
        required: ["scope"],
      },
    },
    "memory.consolidate": {
      name: "memory.consolidate",
      description: "Consolidate related memories into a single summary.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          scope: { type: "string", enum: ["personal", "project", "company"] },
          tag: { type: "string", description: "Tag to consolidate" },
        },
        required: ["agent_id", "scope", "tag"],
      },
    },
    "memory.stats": {
      name: "memory.stats",
      description: "Show memory statistics — total entries per scope, per-agent breakdown.",
      parameters: { type: "object", properties: {} },
    },

    // Kanban tools
    "board.get": {
      name: "board.get",
      description: "Get Kanban board",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
        },
        required: ["agent_id"],
      },
    },
    "board.addCard": {
      name: "board.addCard",
      description: "Add Kanban task",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string" },
          due: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["agent_id", "title"],
      },
    },
    "board.moveCard": {
      name: "board.moveCard",
      description: "Move card",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string" },
          status: { type: "string", enum: ["Backlog", "Todo", "In Progress", "Blocked", "Review", "Done"] },
        },
        required: ["card_id", "status"],
      },
    },
    "board.viewReports": {
      name: "board.viewReports",
      description: "Manager view of all reports' boards",
      parameters: {
        type: "object",
        properties: {
          manager_id: { type: "string" },
        },
        required: ["manager_id"],
      },
    },
    "board.reassign": {
      name: "board.reassign",
      description: "Manager reassign card between reports",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string" },
          from_agent_id: { type: "string" },
          to_agent_id: { type: "string" },
          manager_id: { type: "string" },
        },
        required: ["card_id", "from_agent_id", "to_agent_id", "manager_id"],
      },
    },
    "board.escalate": {
      name: "board.escalate",
      description: "Escalate blocked card to manager",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string" },
          to_manager_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["card_id", "to_manager_id", "reason"],
      },
    },

    // Messaging tools
    "message.send": {
      name: "message.send",
      description: "Send message to another agent",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          content: { type: "string" },
          priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
          requires_response: { type: "boolean" },
          subject: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["from", "to", "content"],
      },
    },
    "message.reply": {
      name: "message.reply",
      description: "Reply to message thread",
      parameters: {
        type: "object",
        properties: {
          thread_id: { type: "string" },
          from: { type: "string" },
          content: { type: "string" },
          requires_response: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["thread_id", "from", "content"],
      },
    },
    "message.getThread": {
      name: "message.getThread",
      description: "Read full message thread (like checking phone)",
      parameters: {
        type: "object",
        properties: {
          thread_id: { type: "string" },
        },
        required: ["thread_id"],
      },
    },
    "message.getThreads": {
      name: "message.getThreads",
      description: "Get all threads for agent",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["agent_id"],
      },
    },
    "message.search": {
      name: "message.search",
      description: "Search message history with semantic search",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          query: { type: "string" },
          top_k: { type: "number" },
          from_agent: { type: "string" },
          priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
        },
        required: ["agent_id", "query"],
      },
    },
    "message.markRead": {
      name: "message.markRead",
      description: "Mark messages as read",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          thread_id: { type: "string" },
        },
        required: ["agent_id"],
      },
    },
    "message.escalate": {
      name: "message.escalate",
      description: "Escalate thread to superior",
      parameters: {
        type: "object",
        properties: {
          thread_id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          reason: { type: "string" },
        },
        required: ["thread_id", "from", "to", "reason"],
      },
    },
    "message.getUnread": {
      name: "message.getUnread",
      description: "Get all unread messages for an agent with full content.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          limit: { type: "number", default: 20 },
        },
        required: ["agent_id"],
      },
    },
    "agent.inbox": {
      name: "agent.inbox",
      description: "View agent's message inbox — unread messages, pending responses, and active threads",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          include_read: { type: "boolean", default: false },
        },
        required: ["agent_id"],
      },
    },

    // Agent management
    "agent.create": {
      name: "agent.create",
      description: "Create new agent with Kanban board and memory",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          role: { type: "string" },
          model: { type: "string" },
          tools: { type: "array", items: { type: "string" } },
        },
        required: ["name"],
      },
    },
    "agent.spawn": {
      name: "agent.spawn",
      description: "Spawn sub-agent with dedicated board and memory",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Parent agent ID" },
          task: { type: "string", description: "Task description" },
          role: { type: "string" },
          project_dir: { type: "string" },
        },
        required: ["agent_id", "task"],
      },
    },
    "agent.list": {
      name: "agent.list",
      description: "List all active agents",
      parameters: { type: "object", properties: {} },
    },

    // Agent communication
    "agent.call": {
      name: "agent.call",
      description: "Call another agent (send message, optional response)",
      parameters: {
        type: "object",
        properties: {
          from_agent: { type: "string" },
          to_agent: { type: "string" },
          message: { type: "string" },
          priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
          requires_response: { type: "boolean" },
        },
        required: ["from_agent", "to_agent", "message"],
      },
    },
    "agent.handoff": {
      name: "agent.handoff",
      description: "Handoff conversation to another agent (they take over)",
      parameters: {
        type: "object",
        properties: {
          from_agent: { type: "string" },
          to_agent: { type: "string" },
          context: { type: "string" },
          conversation_id: { type: "string" },
        },
        required: ["from_agent", "to_agent", "context"],
      },
    },
    "agent.meeting": {
      name: "agent.meeting",
      description: "Call a board meeting with multiple agents",
      parameters: {
        type: "object",
        properties: {
          from_agent: { type: "string" },
          participants: { type: "array", items: { type: "string" } },
          topic: { type: "string" },
          urgency: { type: "string", enum: ["normal", "urgent"] },
        },
        required: ["from_agent", "participants", "topic"],
      },
    },
    "agent.wake": {
      name: "agent.wake",
      description: "Get wake-up context for agent (inject on activation)",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
        },
        required: ["agent_id"],
      },
    },

    // Organization tools
    "org.chart": {
      name: "org.chart",
      description: "Show organization chart",
      parameters: { type: "object", properties: {} },
    },
    "staff.list": {
      name: "staff.list",
      description: "List core staff",
      parameters: { type: "object", properties: {} },
    },
    "staff.get": {
      name: "staff.get",
      description: "Get staff details",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },

    // Meeting governance
    "meeting.propose": {
      name: "meeting.propose",
      description: "Propose board meeting",
      parameters: {
        type: "object",
        properties: {
          proposer: { type: "string" },
          title: { type: "string" },
          reason: { type: "string" },
          urgency: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
        },
        required: ["proposer", "title", "reason"],
      },
    },
    "meeting.vote": {
      name: "meeting.vote",
      description: "Vote on meeting proposal",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string" },
          voter: { type: "string" },
          vote: { type: "string", enum: ["yes", "no", "abstain"] },
        },
        required: ["meeting_id", "voter", "vote"],
      },
    },
    "meeting.get": {
      name: "meeting.get",
      description: "Get meeting proposal",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string" },
        },
        required: ["meeting_id"],
      },
    },
    "meeting.recordMinutes": {
      name: "meeting.recordMinutes",
      description: "Record meeting minutes",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string" },
          decisions: { type: "array", items: { type: "string" } },
          action_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                assignee: { type: "string" },
                due_date: { type: "string" },
              },
              required: ["description", "assignee"],
            },
          },
          attendees: { type: "array", items: { type: "string" } },
          recorded_by: { type: "string" },
        },
        required: ["meeting_id", "decisions", "action_items", "attendees", "recorded_by"],
      },
    },

    // Hiring & delegation
    "hire.create": {
      name: "hire.create",
      description: "Hire auxiliary staff",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string" },
          reports_to: { type: "string" },
          budget: { type: "number" },
          tasks: { type: "array", items: { type: "string" } },
        },
        required: ["role", "reports_to", "tasks"],
      },
    },
    "hire.fire": {
      name: "hire.fire",
      description: "Release auxiliary staff",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["agent_id", "reason"],
      },
    },
    "hire.getTeam": {
      name: "hire.getTeam",
      description: "Get manager's team",
      parameters: {
        type: "object",
        properties: {
          manager_id: { type: "string" },
        },
        required: ["manager_id"],
      },
    },
    "delegate.to": {
      name: "delegate.to",
      description: "Delegate task to report",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          task: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
          deadline: { type: "string" },
        },
        required: ["from", "to", "task", "description"],
      },
    },
    "delegate.accept": {
      name: "delegate.accept",
      description: "Accept delegated task",
      parameters: {
        type: "object",
        properties: {
          delegation_id: { type: "string" },
        },
        required: ["delegation_id"],
      },
    },
    "delegate.reject": {
      name: "delegate.reject",
      description: "Reject delegated task",
      parameters: {
        type: "object",
        properties: {
          delegation_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["delegation_id", "reason"],
      },
    },
    "delegate.update": {
      name: "delegate.update",
      description: "Update delegation status",
      parameters: {
        type: "object",
        properties: {
          delegation_id: { type: "string" },
          status: { type: "string", enum: ["pending", "accepted", "in_progress", "blocked", "completed", "rejected"] },
        },
        required: ["delegation_id", "status"],
      },
    },
    "delegate.get": {
      name: "delegate.get",
      description: "Get delegation details",
      parameters: {
        type: "object",
        properties: {
          delegation_id: { type: "string" },
        },
        required: ["delegation_id"],
      },
    },

    // Reports
    "reports.save": {
      name: "reports.save",
      description: "Save a report (storage-only)",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          period: { type: "string" },
          summary: { type: "string" },
          metrics: { type: "object" },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                assignee: { type: "string" },
                due: { type: "string" },
              },
              required: ["description"],
            },
          },
        },
        required: ["agent_id", "period", "summary"],
      },
    },
    "reports.getLatest": {
      name: "reports.getLatest",
      description: "Get latest reports for agent",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["agent_id"],
      },
    },

    // Notifications (CEO only)
    "notify.telegram": {
      name: "notify.telegram",
      description: "Send notification to user via Telegram. Only use for critical, time-sensitive items.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          priority: { type: "string", enum: ["info", "warning", "urgent"], default: "info" },
        },
        required: ["text"],
      },
    },

    // Heartbeat
    "heartbeat.runNow": {
      name: "heartbeat.runNow",
      description: "Trigger audit",
      parameters: { type: "object", properties: {} },
    },

    // Task
    "task.get": {
      name: "task.get",
      description: "Get full task details",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string" },
        },
        required: ["card_id"],
      },
    },
  };

  // Filter to only requested tools
  return toolNames
    .map(name => allTools[name])
    .filter(Boolean) as ToolDefinition[];
}

/**
 * Convert MCP tool response to ToolResult format.
 */
export function mcpResponseToToolResult(response: { content: Array<{ type: string; text: string }> }): ToolResult {
  const text = response.content.map(c => c.text).join("\n");
  return { success: true, content: text };
}

/**
 * Create a tool execution wrapper that bridges MCP tool calls.
 */
export function createToolBridge(executor: (name: string, args: Record<string, unknown>) => Promise<any>): ToolExecutor {
  return async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      logger.debug({ tool: name, args: JSON.stringify(args).slice(0, 200) }, "Tool call");
      const result = await executor(name, args);
      if (result?.content) {
        return mcpResponseToToolResult(result);
      }
      return { success: true, content: typeof result === "string" ? result : JSON.stringify(result) };
    } catch (err: any) {
      logger.error({ tool: name, err: err.message }, "Tool execution failed");
      return { success: false, content: "", error: err.message };
    }
  };
}
