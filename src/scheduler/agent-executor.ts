// Agent Executor - Main autonomous execution loop for proactive agent behavior

import { logger } from "../logger.js";
import { getCoreStaffIds, getStaffById } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { getOpenCodeClient } from "../acp/opencode-client.js";
import { AgentContextManager } from "../organic/context.js";
import { Kanban } from "../kanban/sqlite.js";
import { Memory } from "../memory/lancedb.js";
import { InactivityTracker } from "./inactivity-tracker.js";
import { getPromptForRole } from "../staff/prompts.js";

export interface AgentExecutorConfig {
  checkIntervalMs: number;
  proactiveCheckIntervalMs: number;
  userInactivityThresholdMs: number;
}

const DEFAULT_CONFIG: AgentExecutorConfig = {
  checkIntervalMs: 30000, // 30 seconds - check for messages
  proactiveCheckIntervalMs: 5 * 60 * 1000, // 5 minutes - proactive checks during inactivity
  userInactivityThresholdMs: 60 * 60 * 1000 // 1 hour - consider user inactive after this
};

export class AgentExecutor {
  private running = false;
  private config: AgentExecutorConfig;
  private inactivityTracker: InactivityTracker;
  private sessionCache: Map<string, { sessionId: string; lastUsed: number }> = new Map();
  private sessionTimeoutMs: number = 30 * 60 * 1000;

  constructor(
    private kanban: Kanban,
    private memory: Memory,
    config: Partial<AgentExecutorConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.inactivityTracker = new InactivityTracker(this.config.userInactivityThresholdMs);
  }

  async start() {
    if (this.running) {
      logger.warn("Agent executor already running");
      return;
    }

    this.running = true;
    logger.info("Agent executor started");

    // Start inactivity tracker
    await this.inactivityTracker.start();

    // Main execution loop
    this.runExecutionLoop();

    // Proactive check loop (slower)
    this.runProactiveLoop();
  }

  stop() {
    this.running = false;
    this.inactivityTracker.stop();
    logger.info("Agent executor stopped");
  }

  private async runExecutionLoop() {
    const loop = async () => {
      if (!this.running) return;

      try {
        await this.checkAndExecuteAgents();
      } catch (err: any) {
        logger.error({ err: err.message }, "Agent execution loop error");
      }

      setTimeout(loop, this.config.checkIntervalMs);
    };

    loop();
  }

  private async runProactiveLoop() {
    const loop = async () => {
      if (!this.running) return;

      try {
        const isUserInactive = this.inactivityTracker.isUserInactive();
        
        if (isUserInactive) {
          logger.info("User inactive - triggering proactive agent checks");
          await this.triggerProactiveChecks();
        }
      } catch (err: any) {
        logger.error({ err: err.message }, "Proactive check loop error");
      }

      setTimeout(loop, this.config.proactiveCheckIntervalMs);
    };

    loop();
  }

  private async checkAndExecuteAgents() {
    const messaging = await getMessagingSystem();
    const acp = getOpenCodeClient();
    const contextManager = new AgentContextManager(this.kanban, this.memory);

    for (const agentId of getCoreStaffIds()) {
      try {
        await this.executeAgent(agentId, messaging, acp, contextManager);
      } catch (err: any) {
        logger.error({ agentId, err: err.message }, "Failed to execute agent");
      }
    }
  }

  private async executeAgent(
    agentId: string,
    messaging: any,
    acp: any,
    contextManager: AgentContextManager
  ) {
    const context = await messaging.getActiveContext(agentId);

    // Check if agent needs to act
    const hasPendingResponses = context.pending_responses.length > 0;
    const hasUnreadMessages = context.unread_count > 0;
    const hasActiveThreads = context.active_threads.length > 0;

    if (!hasPendingResponses && !hasUnreadMessages) {
      return; // Nothing to do
    }

    logger.info(
      {
        agentId,
        pending: context.pending_responses.length,
        unread: context.unread_count,
        activeThreads: context.active_threads.length
      },
      "Executing agent"
    );

    // Ensure OpenCode session
    const sessionId = await this.ensureAgentSession(agentId, acp);

    // Build comprehensive context
    const wakeCtx = await contextManager.getWakeContext(agentId);

    // Build prompt
    const prompt = this.buildExecutionPrompt(agentId, context, wakeCtx);

    // Get agent response
    const result = await acp.sendMessage(sessionId, prompt);

    // Process any agent actions (calls, handoffs, etc.)
    await this.processAgentActions(agentId, result.text, messaging);

    logger.info({ agentId }, "Agent execution complete");
  }

  private async triggerProactiveChecks() {
    const messaging = await getMessagingSystem();
    const acp = getOpenCodeClient();
    const contextManager = new AgentContextManager(this.kanban, this.memory);

    for (const agentId of getCoreStaffIds()) {
      try {
        const staff = getStaffById(agentId);
        if (!staff || staff.autonomyLevel < 3) continue; // Only autonomous agents

        const sessionId = await this.ensureAgentSession(agentId, acp);
        const wakeCtx = await contextManager.getWakeContext(agentId);

        const prompt = this.buildProactivePrompt(agentId, wakeCtx);
        const result = await acp.sendMessage(sessionId, prompt);

        // If agent has something to report, send as message to user
        if (result.text && result.text.trim().length > 0) {
          logger.info({ agentId }, "Proactive check generated output");
          // Could send to user via notify.telegram or store as insight
        }
      } catch (err: any) {
        logger.error({ agentId, err: err.message }, "Proactive check failed");
      }
    }
  }

  private async ensureAgentSession(agentId: string, acp: any): Promise<string> {
    const cached = this.sessionCache.get(agentId);
    const now = Date.now();

    if (cached && now - cached.lastUsed < this.sessionTimeoutMs) {
      cached.lastUsed = now;
      return cached.sessionId;
    }

    const sessionId = await acp.createSession(process.cwd());
    this.sessionCache.set(agentId, { sessionId, lastUsed: now });

    return sessionId;
  }

  private buildExecutionPrompt(agentId: string, context: any, wakeCtx: any): string {
    const promptData = getPromptForRole(agentId);
    const systemPrompt = promptData ? promptData.prompt : "You are a helpful AI assistant.";
    
    const lines: string[] = [systemPrompt, ""];
    lines.push(`---`);
    lines.push(``);
    lines.push(`You're working on your responsibilities as ${agentId}.`);
    lines.push("");

    if (context.pending_responses.length > 0) {
      lines.push(`Messages Requiring Response (${context.pending_responses.length}):`);
      for (const msg of context.pending_responses) {
        lines.push(`- From: ${msg.from}, Priority: ${msg.priority}: ${msg.content.substring(0, 100)}...`);
      }
      lines.push("");
    }

    if (context.active_threads.length > 0) {
      lines.push(`Active Conversations (${context.active_threads.length}):`);
      for (const thread of context.active_threads.slice(0, 3)) {
        lines.push(`- ${thread.subject} (updated: ${new Date(thread.updated_at).toLocaleString()})`);
      }
      lines.push("");
    }

    if (wakeCtx.summary) {
      lines.push(`Recent Context:`);
      lines.push(wakeCtx.summary);
      lines.push("");
    }

    lines.push(`---`);
    lines.push(`Respond to any pending messages. Be conversational and helpful.`);

    return lines.join("\n");
  }

  private buildProactivePrompt(agentId: string, wakeCtx: any): string {
    const staff = getStaffById(agentId);
    const promptData = getPromptForRole(agentId);
    const systemPrompt = promptData ? promptData.prompt : "You are a helpful AI assistant.";

    return `${systemPrompt}

---

You're ${agentId} (${staff?.title}). The user hasn't been active for a while.

Your Responsibilities:
${staff?.systemPrompt || "Manage your domain proactively."}

Current Context:
${wakeCtx.summary || "No recent activity"}

---

Review your domain for anything needing attention. If you notice something important, prepare a brief, friendly nudge. If everything is fine, you don't need to send anything.

Be conversational, not report-style. Keep it brief.`;
  }

  private async processAgentActions(agentId: string, responseText: string, messaging: any) {
    // Parse response for agent actions (agent.call, agent.handoff, etc.)
    // This is a simplified version - full implementation would parse tool calls
    logger.debug({ agentId, responseLength: responseText.length }, "Processing agent actions");
  }

  recordUserActivity() {
    this.inactivityTracker.recordActivity();
  }

  isUserInactive(): boolean {
    return this.inactivityTracker.isUserInactive();
  }
}

let agentExecutor: AgentExecutor | null = null;

export async function startAgentExecutor(kanban: Kanban, memory: Memory, config?: Partial<AgentExecutorConfig>) {
  if (!agentExecutor) {
    agentExecutor = new AgentExecutor(kanban, memory, config);
    await agentExecutor.start();
  }
  return agentExecutor;
}

export function getAgentExecutor(): AgentExecutor | null {
  return agentExecutor;
}
