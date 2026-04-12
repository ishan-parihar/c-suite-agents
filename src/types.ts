import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "http";
import type { Memory } from "./memory/lancedb";
import type { MemoryFacade } from "./memory/index";
import type { Kanban } from "./kanban/sqlite";
import type { HierarchicalMemory } from "./memory/hierarchical";
import type { MessagingSystem } from "./organic/messaging";
import type { MeetingGovernance } from "./organic/meetings";
import type { HiringSystem } from "./organic/hiring";

export type ToolExecutor = {
  executeTool: (name: string, args: Record<string, unknown>) => Promise<any>;
};

export type OperantRuntime = {
  server?: McpServer;
  httpServer?: Server;
  ctx: { 
    memory: Memory; 
    memoryFacade?: MemoryFacade;
    kanban: Kanban;
    hierarchicalMemory?: HierarchicalMemory;
    messaging?: MessagingSystem;
    meetings?: MeetingGovernance;
    hiring?: HiringSystem;
  };
  executor: ToolExecutor;
  shutdown: () => Promise<void>;
};
