// Message Processor - Polls for messages and triggers agent responses

import { logger } from "../logger.js";
import { getCoreStaffIds, getStaffById } from "../staff/core-staff.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { getNativeRuntime } from "../runtime/native-agent-runtime.js";
import { AgentContextManager } from "../organic/context.js";
import { Kanban } from "../kanban/sqlite.js";
import { Memory } from "../memory/lancedb.js";
import { getSessionRegistry } from "./session-registry.js";
import { autoStore, autoRecall } from "../memory/auto.js";

const AGENT_ID_MAP: Record<string, string> = {
  "ceo-strategic": "ceo-strategic",
  "coo-productivity": "coo-productivity",
  "cfo-financial": "cfo-financial",
  "cmo-content": "cmo-content",
  "cro-relational": "cro-relational",
  "physician-health": "cpso-health",
  "cpo-psychologist": "cpo-psychologist",
  "cio-intelligence": "cio-intelligence",
};

export class MessageProcessor {
  private intervalMs: number;
  private running = false;
  private timerId: ReturnType<typeof setInterval> | null = null;

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
    this.timerId = setInterval(() => {
      if (this.running) this.processAllAgents();
    }, this.intervalMs);
  }

  stop() {
    this.running = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    logger.info("Message processor stopped");
  }

  private async processAllAgents() {
    if (!this.running) return;

    const messaging = await getMessagingSystem();
    const contextManager = new AgentContextManager(this.kanban, this.memory);

    for (const agentId of getCoreStaffIds()) {
      try {
        await this.processAgent(agentId, messaging, contextManager);
      } catch (err: any) {
        logger.error({ agentId, err: err.message }, "Failed to process agent messages");
      }
    }
  }

  private async processAgent(
    agentId: string,
    messaging: any,
    contextManager: AgentContextManager
  ) {
    // Get pending responses
    const context = await messaging.getActiveContext(agentId);

    if (context.pending_responses.length === 0 && context.unread_count === 0) {
      return; // Nothing to process
    }

    // Filter out self-messages (ceo-strategic → ceo-strategic threads have only 1 participant)
    const validResponses = context.pending_responses.filter((msg: any) => msg.from !== agentId);
    if (validResponses.length === 0 && context.unread_count === 0) {
      return;
    }

    logger.info(
      { agentId, pending: context.pending_responses.length, unread: context.unread_count },
      "Processing agent messages"
    );

    const sessionRegistry = getSessionRegistry();
    let sessionId = await sessionRegistry.getOrCreate(agentId, {});
    const runtime = getNativeRuntime();

    // Process each valid pending response
    for (const msg of validResponses) {
      try {
        const wakeCtx = await contextManager.getWakeContext(agentId);

        // AUTO RECALL: Fetch relevant memories before building delta
        const recallText = await autoRecall({
          agentId,
          queryText: msg.content,
          trigger: "inter_agent_message",
        });

        const delta = this.buildAgentResponseDelta(msg, wakeCtx, recallText);
        const nativeAgentId = AGENT_ID_MAP[agentId] || agentId;
        const result = await runtime.sendMessage(sessionId, delta, nativeAgentId);
        await sessionRegistry.touch(sessionId);

        // Send reply via messaging system
        await messaging.reply({
          thread_id: msg.thread_id,
          from: agentId,
          content: result.text,
          requires_response: false
        });

        // AUTO STORE: Save the conversation turn automatically
        await autoStore({
          agentId,
          inputText: msg.content,
          outputText: result.text || "",
          trigger: "inter_agent_message",
          context: {
            from: msg.from,
            threadId: msg.thread_id,
          },
        });

        logger.info({ agentId, threadId: msg.thread_id }, "Agent responded to message");
      } catch (err: any) {
        // Skip broken threads (e.g., single-participant self-messages)
        logger.warn(
          { agentId, threadId: msg.thread_id, err: err.message },
          "Skipping broken thread, marking as read"
        );
        await messaging.markAsRead(agentId, msg.thread_id);
      }
    }

    // Mark all messages as read
    await messaging.markAsRead(agentId);
  }

  private buildAgentResponseDelta(message: any, wakeCtx: any, recallText: string = ""): string {
    const staff = getStaffById(message.from);
    const fromName = staff ? `${staff.avatar} ${staff.name}` : message.from;

    const lines: string[] = [];

    // Inject recalled memories first (if any)
    if (recallText) {
      lines.push(recallText);
      lines.push("");
    }

    lines.push(
      `## Message from ${fromName}`,
      `Priority: ${message.priority}`,
      `Thread: ${message.thread_id}`,
      '',
      message.content,
    );

    if (wakeCtx.summary) {
      lines.push('');
      lines.push(`## Your Context`);
      lines.push(wakeCtx.summary);
    }

    lines.push('');
    lines.push(`---`);
    lines.push(`Respond naturally and conversationally. This is a message from a colleague, not a user command.`);

    return lines.join('\n');
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
