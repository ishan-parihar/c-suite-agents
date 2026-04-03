// Message Processor - Polls for messages and triggers agent responses

import { logger } from "../logger.js";
import { getCoreStaffIds } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { getOpenCodeClient } from "../acp/opencode-client.js";
import { AgentContextManager } from "../organic/context.js";
import { Kanban } from "../kanban/sqlite.js";
import { Memory } from "../memory/lancedb.js";
import { getSessionManager, validateAgentIdentity } from "../auth/session.js";
import { getStaffById } from "../staff/core-staff.js";
import { getPromptForRole } from "../staff/prompts.js";

interface AgentSessionCache {
  sessionId: string;
  lastUsed: number;
}

export class MessageProcessor {
  private intervalMs: number;
  private running = false;
  private sessionCache: Map<string, AgentSessionCache> = new Map();
  private sessionTimeoutMs: number = 30 * 60 * 1000; // 30 minutes

  constructor(
    private kanban: Kanban,
    private memory: Memory,
    intervalMs: number = 30000 // 30 seconds default
  ) {
    this.intervalMs = intervalMs;
  }

  async start() {
    if (this.running) {
      logger.warn("Message processor already running");
      return;
    }

    this.running = true;
    logger.info({ intervalMs: this.intervalMs }, "Message processor started");

    // Initial processing
    await this.processAllAgents();

    // Schedule periodic processing
    setInterval(() => this.processAllAgents(), this.intervalMs);
  }

  stop() {
    this.running = false;
    logger.info("Message processor stopped");
  }

  private async processAllAgents() {
    if (!this.running) return;

    const messaging = await getMessagingSystem();
    const acp = getOpenCodeClient();
    const contextManager = new AgentContextManager(this.kanban, this.memory);

    for (const agentId of getCoreStaffIds()) {
      try {
        await this.processAgent(agentId, messaging, acp, contextManager);
      } catch (err: any) {
        logger.error({ agentId, err: err.message }, "Failed to process agent messages");
      }
    }
  }

  private async processAgent(
    agentId: string,
    messaging: any,
    acp: any,
    contextManager: AgentContextManager
  ) {
    // Get pending responses
    const context = await messaging.getActiveContext(agentId);

    if (context.pending_responses.length === 0 && context.unread_count === 0) {
      return; // Nothing to process
    }

    logger.info(
      { agentId, pending: context.pending_responses.length, unread: context.unread_count },
      "Processing agent messages"
    );

    // Ensure OpenCode session for this agent
    const sessionId = await this.ensureAgentSession(agentId, acp);

    // Process each pending response
    for (const msg of context.pending_responses) {
      try {
        // Build prompt with message context
        const wakeCtx = await contextManager.getWakeContext(agentId);
        const prompt = this.buildAgentResponsePrompt(msg, wakeCtx);

        // Get agent response via OpenCode
        const result = await acp.sendMessage(sessionId, prompt);

        // Send reply via messaging system
        await messaging.reply({
          thread_id: msg.thread_id,
          from: agentId,
          content: result.text,
          requires_response: false
        });

        logger.info({ agentId, threadId: msg.thread_id }, "Agent responded to message");
      } catch (err: any) {
        logger.error(
          { agentId, threadId: msg.thread_id, err: err.message },
          "Failed to process message"
        );
      }
    }

    // Mark all messages as read
    await messaging.markAsRead(agentId);
  }

  private async ensureAgentSession(agentId: string, acp: any): Promise<string> {
    const cached = this.sessionCache.get(agentId);
    const now = Date.now();

    if (cached && now - cached.lastUsed < this.sessionTimeoutMs) {
      cached.lastUsed = now;
      return cached.sessionId;
    }

    // Create new session
    const sessionId = await acp.createSession(process.cwd());
    this.sessionCache.set(agentId, { sessionId, lastUsed: now });

    logger.info({ agentId, sessionId }, "Created new agent session");
    return sessionId;
  }

  private buildAgentResponsePrompt(message: any, wakeCtx: any): string {
    const staff = getStaffById(message.from);
    const fromName = staff ? `${staff.avatar} ${staff.name}` : message.from;
    
    // Get agent's system prompt
    const promptData = getPromptForRole(message.to);
    const systemPrompt = promptData ? promptData.prompt : "You are a helpful AI assistant.";

    return `${systemPrompt}

---

You have a new message that requires your response.

## Message Context
From: ${fromName}
Priority: ${message.priority}
Thread: ${message.thread_id}

## Message Content
${message.content}

## Your Current Context
${wakeCtx.summary || "No additional context available"}

---

Respond naturally and conversationally. This is a message from a colleague, not a user command. Be helpful, concise, and authentic.`;
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [agentId, cache] of this.sessionCache.entries()) {
      if (now - cache.lastUsed > this.sessionTimeoutMs) {
        this.sessionCache.delete(agentId);
        logger.info({ agentId }, "Expired agent session removed from cache");
      }
    }
  }
}

let messageProcessor: MessageProcessor | null = null;

export async function startMessageProcessor(kanban: Kanban, memory: Memory) {
  if (!messageProcessor) {
    messageProcessor = new MessageProcessor(kanban, memory);
    await messageProcessor.start();
  }
  return messageProcessor;
}

export function getMessageProcessor(): MessageProcessor | null {
  return messageProcessor;
}
