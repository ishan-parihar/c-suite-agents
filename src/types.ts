import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Memory } from "./memory/lancedb.js";
import type { Kanban } from "./kanban/sqlite.js";
import type { HierarchicalMemory } from "./memory/hierarchical.js";
import type { MessagingSystem } from "./organic/messaging.js";
import type { MeetingGovernance } from "./organic/meetings.js";
import type { HiringSystem } from "./organic/hiring.js";

export type ToolExecutor = {
  executeTool: (name: string, args: Record<string, unknown>) => Promise<any>;
};

export type StrategosRuntime = {
  server: McpServer;
  ctx: { 
    memory: Memory; 
    kanban: Kanban;
    hierarchicalMemory?: HierarchicalMemory;
    messaging?: MessagingSystem;
    meetings?: MeetingGovernance;
    hiring?: HiringSystem;
  };
  executor: ToolExecutor;
};
