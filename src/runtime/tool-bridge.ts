// Tool Bridge — Maps Strategos MCP tools to LLM tool-calling format
// Provides tool definitions (JSON Schema) and execution wrappers

import { z } from "zod";
import { logger } from "../logger.js";
import { createFsReadTool } from "./tools/fs-read.js";
import { createFsWriteTool } from "./tools/fs-write.js";
import { createFsEditTool } from "./tools/fs-edit.js";
import { createBashTool } from "./tools/bash-exec.js";

export type PermissionTier = "read" | "write" | "danger";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  permissionTier?: PermissionTier;
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
          query: { type: "string", description: "Natural language search query" },
          top_k: { type: "number", description: "Max results (default: 10)" },
          scopes: { type: "array", items: { type: "string", enum: ["personal", "project", "company"] }, description: "Scopes to search" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "memory.recall": {
      name: "memory.recall",
      description: "Cross-search: searches across memory, messages, and tasks simultaneously. Use for broad recall beyond just memory.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          top_k: { type: "number", description: "Max results" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "memory.upsert": {
      name: "memory.upsert",
      description: "Save a memory with scope, type, and automatic deduplication.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["personal", "project", "company"], description: "Memory scope" },
          kind: { type: "string", enum: ["episodic", "semantic", "procedural"], description: "Memory kind" },
          type: { type: "string", enum: ["note", "obs", "io", "log", "decision", "meeting", "insight"], description: "Memory type" },
          content: { type: "string", description: "Memory content" },
          importance: { type: "number", minimum: 0, maximum: 1, description: "Importance 0-1" },
          tags: { type: "array", items: { type: "string" }, description: "Tags" },
        },
        required: ["type", "content"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "memory.forget": {
      name: "memory.forget",
      description: "Delete memories by ID or by tag+agent combination.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["personal", "project", "company"], description: "Memory scope" },
          id: { type: "string", description: "Specific memory ID to delete" },
          tag: { type: "string", description: "Tag to delete all matching memories" },
        },
        required: ["scope"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "memory.consolidate": {
      name: "memory.consolidate",
      description: "Consolidate related memories into a single summary.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["personal", "project", "company"], description: "Memory scope" },
          tag: { type: "string", description: "Tag to consolidate" },
        },
        required: ["scope", "tag"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "memory.stats": {
      name: "memory.stats",
      description: "Show memory statistics — total entries per scope, per-agent breakdown.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      permissionTier: "read",
    },

    // Tool discovery
    "tool.search": {
      name: "tool.search",
      description: "Search for available tools by keyword. Returns matching tool names, descriptions, and parameters. Use when you need a tool but don't know its exact name.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What you're trying to do (e.g., 'send notification', 'search memory', 'check budget')" },
          maxResults: { type: "number", description: "Max results to return (default: 5)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },

    // Kanban tools
    "board.get": {
      name: "board.get",
      description: "Review your Kanban board — shows all cards grouped by column. Use to check workload, find blocked tasks, or assess overall progress before reporting.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      permissionTier: "read",
    },
    "board.addCard": {
      name: "board.addCard",
      description: "Create a new task card on your Kanban board. Use when a new task is identified during work, assigned to you, or discovered from conversations.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short, descriptive task title" },
          description: { type: "string", description: "Detailed task description with context and acceptance criteria" },
          priority: { type: "string", enum: ["P1", "P2", "P3", "P4"], description: "Task priority: P1=critical, P2=high, P3=normal, P4=low" },
          due: { type: "string", description: "Due date in ISO format (e.g., '2026-04-15') or relative (e.g., 'tomorrow', 'next week')" },
          tags: { type: "array", items: { type: "string" }, description: "Labels for categorization (e.g., 'bug', 'feature', 'urgent')" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "board.moveCard": {
      name: "board.moveCard",
      description: "Move a card to a different column. Use when task status changes (starting work → 'In Progress', finishing → 'Done', hitting obstacle → 'Blocked').",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string", description: "The card ID to move" },
          status: { type: "string", description: "Target column name (must match agent's board columns)" },
        },
        required: ["card_id", "status"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "board.viewReports": {
      name: "board.viewReports",
      description: "Manager view of all direct reports' Kanban boards. Shows card counts and status summaries. Use to monitor team workload and identify bottlenecks.",
      parameters: {
        type: "object",
        properties: {
          manager_id: { type: "string", description: "The manager's agent ID whose reports to view" },
        },
        required: ["manager_id"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "board.reassign": {
      name: "board.reassign",
      description: "Reassign a card from one report to another. Use when redistributing workload or when a report is overloaded/unavailable. Requires manager authority.",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string", description: "The card ID to reassign" },
          from_agent_id: { type: "string", description: "Current owner's agent ID" },
          to_agent_id: { type: "string", description: "New owner's agent ID" },
          manager_id: { type: "string", description: "The manager's agent ID performing the reassignment" },
        },
        required: ["card_id", "from_agent_id", "to_agent_id", "manager_id"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "board.escalate": {
      name: "board.escalate",
      description: "Escalate a blocked card to your manager with a reason. Use when you cannot resolve a blocker yourself and need managerial intervention.",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string", description: "The blocked card ID to escalate" },
          to_manager_id: { type: "string", description: "The manager's agent ID to escalate to" },
          reason: { type: "string", description: "Explanation of why the card is blocked and needs escalation" },
        },
        required: ["card_id", "to_manager_id", "reason"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },

    // Messaging tools
    "message.send": {
      name: "message.send",
      description: "Send an async message to another agent. Use for requests, updates, or questions. Set requires_response=true when you need a reply.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient agent ID" },
          content: { type: "string", description: "Message body — be clear and specific about what you need" },
          priority: { type: "string", enum: ["P1", "P2", "P3", "P4"], description: "Message priority: P1=urgent, P2=high, P3=normal, P4=low" },
          requires_response: { type: "boolean", description: "Set true when you need the recipient to reply" },
          subject: { type: "string", description: "Brief subject line summarizing the message purpose" },
          tags: { type: "array", items: { type: "string" }, description: "Labels for categorization (e.g., 'question', 'update', 'decision')" },
        },
        required: ["to", "content"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "message.reply": {
      name: "message.reply",
      description: "Reply to an existing message thread. Use to continue a conversation. Always include thread_id from the original message.",
      parameters: {
        type: "object",
        properties: {
          thread_id: { type: "string", description: "The thread ID to reply to" },
          content: { type: "string", description: "Reply message body" },
          requires_response: { type: "boolean", description: "Set true when you need a further reply" },
          tags: { type: "array", items: { type: "string" }, description: "Additional labels for the reply" },
        },
        required: ["thread_id", "content"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "message.getThread": {
      name: "message.getThread",
      description: "Read the full message thread — like checking a conversation history. Use before replying to understand context.",
      parameters: {
        type: "object",
        properties: {
          thread_id: { type: "string", description: "The thread ID to read" },
        },
        required: ["thread_id"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "message.getThreads": {
      name: "message.getThreads",
      description: "List all active message threads for your agent. Use to see who's contacted you and what conversations are ongoing.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max threads to return (default: 20)" },
        },
        required: [],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "message.search": {
      name: "message.search",
      description: "Search message history with semantic search. Use to find past conversations, decisions, or references by topic.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — describe what you're looking for" },
          top_k: { type: "number", description: "Max results to return (default: 10)" },
          priority: { type: "string", enum: ["P1", "P2", "P3", "P4"], description: "Filter by message priority" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "message.markRead": {
      name: "message.markRead",
      description: "Mark messages or an entire thread as read. Use after reviewing unread messages to clear them from your inbox.",
      parameters: {
        type: "object",
        properties: {
          thread_id: { type: "string", description: "Thread ID to mark as read (omit to mark all as read)" },
        },
        required: [],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "message.escalate": {
      name: "message.escalate",
      description: "Escalate a message thread to a superior agent. Use when an issue is above your authority or requires higher-level decision.",
      parameters: {
        type: "object",
        properties: {
          thread_id: { type: "string", description: "The thread ID to escalate" },
          to: { type: "string", description: "Superior agent ID to escalate to" },
          reason: { type: "string", description: "Why this thread needs escalation" },
        },
        required: ["thread_id", "to", "reason"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "message.getUnread": {
      name: "message.getUnread",
      description: "Get all unread messages with full content. Use to check what other agents have sent you. After reading, call message.markRead to clear.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", default: 20, description: "Max unread messages to return (default: 20)" },
        },
        required: [],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "agent.inbox": {
      name: "agent.inbox",
      description: "View your message inbox summary — unread count, pending responses, active threads, and escalations. Use as your first action to check communications.",
      parameters: {
        type: "object",
        properties: {
          include_read: { type: "boolean", default: false, description: "Include already-read messages (default: false)" },
          include_content: { type: "boolean", default: false, description: "Include full message content in response (default: false)" },
        },
        required: [],
        additionalProperties: false,
      },
      permissionTier: "read",
    },

    // Agent management
    "agent.create": {
      name: "agent.create",
      description: "Create new agent with Kanban board and memory",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique agent identifier (lowercase, hyphens allowed)" },
          name: { type: "string", description: "Display name for the agent" },
          role: { type: "string", description: "Agent's role or job title (e.g., 'COO-Productivity')" },
          model: { type: "string", description: "LLM model to use (e.g., 'gpt-4', 'claude-3', 'qwen2.5')" },
          tools: { type: "array", items: { type: "string" }, description: "List of tool names this agent has access to" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "agent.spawn": {
      name: "agent.spawn",
      description: "Spawn sub-agent with dedicated board and memory",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task description" },
          role: { type: "string", description: "Role for the spawned agent (e.g., 'researcher', 'coder')" },
          project_dir: { type: "string", description: "Project directory path for the spawned agent to work in" },
        },
        required: ["task"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "agent.list": {
      name: "agent.list",
      description: "List all active agents in the organization. Use to discover who's available before sending messages or calling meetings.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      permissionTier: "read",
    },

    // Agent communication
    "agent.handoff": {
      name: "agent.handoff",
      description: "Hand off a conversation to another agent — they take over with full context. Use when a topic is outside your domain and better handled by another agent.",
      parameters: {
        type: "object",
        properties: {
          to_agent: { type: "string", description: "Target agent ID to hand off to" },
          context: { type: "string", description: "Summary of conversation context to transfer" },
          conversation_id: { type: "string", description: "The conversation/session ID being handed off" },
        },
        required: ["to_agent", "context"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "agent.meeting": {
      name: "agent.meeting",
      description: "Call a board meeting with multiple agents. Use for decisions requiring group consensus or cross-functional coordination.",
      parameters: {
        type: "object",
        properties: {
          participants: { type: "array", items: { type: "string" }, description: "List of agent IDs to invite to the meeting" },
          topic: { type: "string", description: "Meeting topic or agenda item" },
          urgency: { type: "string", enum: ["normal", "urgent"], description: "Meeting urgency level" },
        },
        required: ["participants", "topic"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "boardmeeting.run": {
      name: "boardmeeting.run",
      description: "Trigger an immediate board meeting. System-level tool accessible to CEO agent.",
      parameters: {
        type: "object",
        properties: {
          objective: { type: "string", description: "Optional objective/focus for the meeting" },
        },
        required: [],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "boardmeeting.status": {
      name: "boardmeeting.status",
      description: "Get current board meeting state if a meeting is active. Returns meeting ID, status, current turn, and objective.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      permissionTier: "read",
    },
    "agent.wake": {
      name: "agent.wake",
      description: "Get wake-up context for an agent — recent activity, pending items, and state summary. Inject this on activation to restore context.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "The agent ID to get wake-up context for" },
        },
        required: ["agent_id"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },

    // Organization tools
    "org.chart": {
      name: "org.chart",
      description: "Display the full organization chart showing hierarchy and reporting structure. Use to understand who reports to whom.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      permissionTier: "read",
    },
    "staff.list": {
      name: "staff.list",
      description: "List core staff members with their roles. Use for quick reference of the C-suite team.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      permissionTier: "read",
    },
    "staff.get": {
      name: "staff.get",
      description: "Get detailed info about a staff member — role, databases, Kanban columns, reporting. Use before delegating or messaging to understand their capabilities.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Staff member's agent ID" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },

    // Meeting governance
    "meeting.propose": {
      name: "meeting.propose",
      description: "Propose a new board meeting with title, reason, and urgency. Triggers a voting process among staff.",
      parameters: {
        type: "object",
        properties: {
          proposer: { type: "string", description: "Agent ID of the person proposing the meeting" },
          title: { type: "string", description: "Meeting title" },
          reason: { type: "string", description: "Why this meeting is needed" },
          urgency: { type: "string", enum: ["P1", "P2", "P3", "P4"], description: "Meeting urgency level" },
        },
        required: ["proposer", "title", "reason"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "meeting.vote": {
      name: "meeting.vote",
      description: "Vote yes/no/abstain on a meeting proposal. Required for quorum — meetings need majority approval.",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "The meeting proposal ID to vote on" },
          voter: { type: "string", description: "Agent ID of the voter" },
          vote: { type: "string", enum: ["yes", "no", "abstain"], description: "Your vote" },
        },
        required: ["meeting_id", "voter", "vote"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "meeting.get": {
      name: "meeting.get",
      description: "Get details of a meeting proposal including current votes, status, and deadline.",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "The meeting proposal ID" },
        },
        required: ["meeting_id"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "meeting.recordMinutes": {
      name: "meeting.recordMinutes",
      description: "Record meeting outcomes — decisions, action items with assignees/due dates, and attendees. Use after a meeting concludes.",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "The meeting ID to record minutes for" },
          decisions: { type: "array", items: { type: "string" }, description: "List of decisions made during the meeting" },
          action_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string", description: "What needs to be done" },
                assignee: { type: "string", description: "Agent ID responsible for this action item" },
                due_date: { type: "string", description: "Due date in ISO format" },
              },
              required: ["description", "assignee"],
              additionalProperties: false,
            },
            description: "Action items with assignees and optional due dates",
          },
          attendees: { type: "array", items: { type: "string" }, description: "List of agent IDs who attended" },
          recorded_by: { type: "string", description: "Agent ID of the person recording the minutes" },
        },
        required: ["meeting_id", "decisions", "action_items", "attendees", "recorded_by"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },

    // Hiring & delegation
    "hire.create": {
      name: "hire.create",
      description: "Hire auxiliary staff with role, manager, budget, and task list. Use when you need dedicated capacity for a specific responsibility.",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string", description: "Role/title for the new hire (e.g., 'QA Engineer', 'Data Analyst')" },
          reports_to: { type: "string", description: "Manager agent ID the new hire reports to" },
          budget: { type: "number", description: "Budget allocation for this hire" },
          tasks: { type: "array", items: { type: "string" }, description: "List of tasks/responsibilities for this role" },
        },
        required: ["role", "reports_to", "tasks"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "hire.fire": {
      name: "hire.fire",
      description: "Release auxiliary staff with a reason. Use when a contract is complete, underperforming, or no longer needed.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent ID of the auxiliary staff to release" },
          reason: { type: "string", description: "Reason for releasing this staff member" },
        },
        required: ["agent_id", "reason"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "hire.getTeam": {
      name: "hire.getTeam",
      description: "Get all auxiliary staff reporting to a manager with their tasks. Use to review team composition.",
      parameters: {
        type: "object",
        properties: {
          manager_id: { type: "string", description: "Manager agent ID whose team to retrieve" },
        },
        required: ["manager_id"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "delegate.to": {
      name: "delegate.to",
      description: "Delegate a task to a direct report with description, priority, and optional deadline. Use to distribute work down the chain of command.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Agent ID of the direct report to delegate to" },
          task: { type: "string", description: "Short task title" },
          description: { type: "string", description: "Detailed task description with context and expectations" },
          priority: { type: "string", enum: ["P1", "P2", "P3", "P4"], description: "Task priority: P1=critical, P2=high, P3=normal, P4=low" },
          deadline: { type: "string", description: "Deadline in ISO format or relative (e.g., '2026-04-15', 'end of week')" },
        },
        required: ["to", "task", "description"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "delegate.accept": {
      name: "delegate.accept",
      description: "Accept a delegated task from your manager. Use to acknowledge and take ownership of assigned work.",
      parameters: {
        type: "object",
        properties: {
          delegation_id: { type: "string", description: "The delegation ID to accept" },
        },
        required: ["delegation_id"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "delegate.reject": {
      name: "delegate.reject",
      description: "Reject a delegated task with a reason. Use when you lack capacity, authority, or the task is outside your scope.",
      parameters: {
        type: "object",
        properties: {
          delegation_id: { type: "string", description: "The delegation ID to reject" },
          reason: { type: "string", description: "Why you're rejecting this delegation" },
        },
        required: ["delegation_id", "reason"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "delegate.update": {
      name: "delegate.update",
      description: "Update a delegation's status (pending→accepted→in_progress→blocked→completed→rejected). Use to track progress.",
      parameters: {
        type: "object",
        properties: {
          delegation_id: { type: "string", description: "The delegation ID to update" },
          status: { type: "string", enum: ["pending", "accepted", "in_progress", "blocked", "completed", "rejected"], description: "New status for the delegation" },
        },
        required: ["delegation_id", "status"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "delegate.get": {
      name: "delegate.get",
      description: "Get full details of a delegation including task, priority, deadline, and current status.",
      parameters: {
        type: "object",
        properties: {
          delegation_id: { type: "string", description: "The delegation ID to retrieve" },
        },
        required: ["delegation_id"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },

    // Reports
    "reports.save": {
      name: "reports.save",
      description: "Save a periodic report with summary, metrics, and action items. Use for daily/weekly status reporting to your manager.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "Reporting period (e.g., 'daily', 'weekly', '2026-04-07')" },
          summary: { type: "string", description: "Executive summary of the reporting period" },
          metrics: { type: "object", description: "Key metrics as key-value pairs (e.g., {tasks_completed: 5, blockers: 1})" },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string", description: "Action item description" },
                assignee: { type: "string", description: "Agent ID responsible" },
                due: { type: "string", description: "Due date in ISO format" },
              },
              required: ["description"],
              additionalProperties: false,
            },
            description: "Follow-up action items with optional assignees and due dates",
          },
        },
        required: ["period", "summary"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "reports.getLatest": {
      name: "reports.getLatest",
      description: "Get the most recent reports for an agent. Use to review past performance or understand recent activity.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max reports to return (default: 5)" },
        },
        required: [],
        additionalProperties: false,
      },
      permissionTier: "read",
    },

    // Notifications (CEO only)
    "notify.telegram": {
      name: "notify.telegram",
      description: "Send a notification to the user (Ishan) via Telegram. ONLY use for critical, time-sensitive items requiring immediate human attention.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Notification message text" },
          priority: { type: "string", enum: ["info", "warning", "urgent"], default: "info", description: "Notification priority level" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },

    // Heartbeat
    "heartbeat.runNow": {
      name: "heartbeat.runNow",
      description: "Trigger an immediate system health audit — checks all agents, pending messages, board status, and cron jobs. Use when you suspect something is wrong or before making org-level decisions.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      permissionTier: "read",
    },

    // Task
    "task.get": {
      name: "task.get",
      description: "Get full task details from Kanban by card ID. Use to understand a specific task's description, priority, due date, and tags.",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string", description: "The card/task ID to retrieve details for" },
        },
        required: ["card_id"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },

    // Cron / Scheduling
    "cron.status": {
      name: "cron.status",
      description: "Check your scheduled tasks — shows active, paused, and total counts with next run times. Use to review your automation schedule.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      permissionTier: "read",
    },

    "cron.list": {
      name: "cron.list",
      description: "List all your scheduled tasks with details — action, schedule, run count, failure count. Use includeDisabled=true to see paused/completed ones.",
      parameters: {
        type: "object",
        properties: {
          includeDisabled: { type: "boolean", description: "Include paused/completed tasks (default: false)" },
        },
        required: [],
        additionalProperties: false,
      },
      permissionTier: "read",
    },

    "cron.create": {
      name: "cron.create",
      description: "Create a scheduled task. Supports cron expressions, intervals, one-shot, and event-triggered schedules. Use this for recurring reports, periodic checks, delayed actions, and automated workflows.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short task name (e.g., 'Daily Report', 'Weekly Review')" },
          description: { type: "string", description: "Detailed description of what the task should do" },
          schedule_type: { type: "string", enum: ["interval", "cron", "once", "on_event"], description: "Schedule type: 'interval' (every N seconds), 'cron' (cron expression), 'once' (specific time), 'on_event' (triggered by event name)" },
          cron_expression: { type: "string", description: "Cron expression for schedule_type='cron' (e.g., '0 8 * * *' = daily at 8 AM, '*/30 * * * *' = every 30 min)" },
          interval_seconds: { type: "number", description: "Seconds between runs for schedule_type='interval' (e.g., 86400 = daily)" },
          trigger_time: { type: "number", description: "Unix timestamp (ms) for schedule_type='once'" },
          event_name: { type: "string", description: "Event name for schedule_type='on_event' (use with cron.trigger)" },
          action: { type: "string", enum: ["query_database", "check_kanban", "send_report", "call_agent", "custom_prompt", "telegram_notify"], description: "What action to perform: 'query_database' (query LifeOS), 'check_kanban' (review board), 'send_report' (generate status report), 'call_agent' (message another agent), 'custom_prompt' (run custom instructions), 'telegram_notify' (send Telegram notification - CEO only)" },
          action_params: { type: "object", description: "Parameters for the action. For custom_prompt: { prompt: 'your instructions' }. For call_agent: { to_agent: 'agent-id', message: 'message text' }. For telegram_notify: { text: 'notification text' }. For query_database: { query: 'what to look for' }. Add priority: 'P1'|'P2'|'P3'|'P4' to set report priority (default P3). Add notify_user: true to deliver results to user via Telegram (CEO only) or to CEO internally (non-CEO)." },
        },
        required: ["name", "description", "schedule_type", "action"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },

    "cron.pause": {
      name: "cron.pause",
      description: "Pause a scheduled task by ID. Use to temporarily disable automation without deleting it.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task ID to pause" },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },

    "cron.resume": {
      name: "cron.resume",
      description: "Resume a previously paused scheduled task by ID. Use to reactivate paused automation.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task ID to resume" },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },

    "cron.delete": {
      name: "cron.delete",
      description: "Delete a scheduled task permanently by ID. Use when a task is no longer needed.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task ID to delete" },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },

    "cron.run": {
      name: "cron.run",
      description: "Trigger an event-based task immediately by event name. Use to fire all tasks listening for a specific event.",
      parameters: {
        type: "object",
        properties: {
          event_name: { type: "string", description: "The event name to trigger (e.g., 'user-login', 'daily-briefing')" },
        },
        required: ["event_name"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },

    // Filesystem tools
    "fs.read": {
      name: "fs.read",
      description: "Read the contents of a file in your workspace directory. Returns the full file content.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path to the file, relative to your workspace directory." },
          agent_id: { type: "string", description: "Your agent ID (auto-injected by the runtime)." },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
      permissionTier: "read",
    },
    "fs.write": {
      name: "fs.write",
      description: "Write content to a file in your workspace directory. Creates the file if it doesn't exist. Use append=true to add to the end of an existing file.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path to the file, relative to your workspace directory." },
          content: { type: "string", description: "Content to write to the file." },
          agent_id: { type: "string", description: "Your agent ID (auto-injected by the runtime)." },
          append: { type: "boolean", description: "If true, append to the end of the file. Default: false (overwrite)." },
        },
        required: ["file_path", "content"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "fs.edit": {
      name: "fs.edit",
      description: "Make a precise edit to a file in your workspace. Replaces old_string with new_string. The old_string must match the file content exactly.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path to the file, relative to your workspace directory." },
          old_string: { type: "string", description: "The exact text to replace." },
          new_string: { type: "string", description: "The new text to insert." },
          agent_id: { type: "string", description: "Your agent ID (auto-injected by the runtime)." },
        },
        required: ["file_path", "old_string", "new_string"],
        additionalProperties: false,
      },
      permissionTier: "write",
    },
    "bash": {
      name: "bash",
      description: "Execute a shell command in your workspace directory. The command runs with your workspace as the working directory.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute (e.g., 'ls', 'git', 'node')." },
          args: { type: "array", items: { type: "string" }, description: "Arguments to pass to the command." },
          agent_id: { type: "string", description: "Your agent ID (auto-injected by the runtime)." },
          cwd: { type: "string", description: "Working directory (relative to workspace, default: workspace root)." },
          timeout_ms: { type: "number", description: "Timeout in milliseconds (default: 30000)." },
        },
        required: ["command"],
        additionalProperties: false,
      },
      permissionTier: "danger",
    },
  };

  // Filter to only requested tools
  return toolNames
    .map(name => allTools[name])
    .filter(Boolean) as ToolDefinition[];
}

/**
 * Get all tool definitions without filtering.
 * Used by tool-search for discovery.
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return buildToolDefinitions([
    "memory.search", "memory.recall", "memory.upsert", "memory.forget",
    "memory.consolidate", "memory.stats",
    "board.get", "board.addCard", "board.moveCard", "board.viewReports",
    "board.reassign", "board.escalate",
    "message.send", "message.reply", "message.getThread", "message.getThreads",
    "message.search", "message.markRead", "message.escalate", "message.getUnread",
    "agent.inbox",
    "agent.create", "agent.spawn", "agent.list",
    "agent.handoff", "agent.meeting", "agent.wake",
    "org.chart", "staff.list", "staff.get",
    "meeting.propose", "meeting.vote", "meeting.get", "meeting.recordMinutes",
    "hire.create", "hire.fire", "hire.getTeam",
    "delegate.to", "delegate.accept", "delegate.reject", "delegate.update", "delegate.get",
    "reports.save", "reports.getLatest",
    "notify.telegram",
    "heartbeat.runNow",
    "task.get",
    "cron.status", "cron.list", "cron.create", "cron.pause", "cron.resume", "cron.delete", "cron.run",
    "tool.search",
    "boardmeeting.run", "boardmeeting.status",
    // Filesystem tools
    "fs.read", "fs.write", "fs.edit", "bash",
  ]);
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
