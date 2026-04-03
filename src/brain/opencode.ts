// Strategos Brain - Tool executor interface for OpenCode ACP
// OpenCode ACP runs the agentic loop - this just executes tools
// NO LLM CALLS HERE - MCP is tools only

export interface ToolExecutor {
  executeTool(tool: string, args: Record<string, unknown>): Promise<any>;
}

export interface AgentSession {
  session_id: string;
  agent_id: string;
  chat_id: string;
  wake_context?: string;
  steps: Array<{
    step_num: number;
    thought?: string;
    tool_call?: any;
    observation?: string;
  }>;
  started_at: number;
}
