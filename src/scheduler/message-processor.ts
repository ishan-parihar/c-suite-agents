// Message Processor - Polls for messages and triggers agent responses

import { logger } from "../logger";
import { getCoreStaffIds, getStaffById, AGENT_ID_MAP } from "../staff/core-staff";
import { getMessagingSystem } from "../organic/messaging";
import { getNativeRuntime } from "../runtime/native-agent-runtime";
import { AgentContextManager } from "../organic/context";
import { Kanban } from "../kanban/sqlite";
import { Memory } from "../memory/lancedb";
import { getSessionRegistry } from "./session-registry";
import { autoStore, autoRecall } from "../memory/auto";
import { ErrorBus } from "../runtime/error-emitter";
import { AsyncMutex } from "../runtime/async-mutex";

const MAX_THREAD_RETRIES = 3;

export class MessageProcessor {
  private intervalMs: number;
  private running = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private activeConversations = new Map<string, { thread_id: string; round: number; initiated_by: string; started_at: number }>();
  private failedThreads = new Map<string, number>();
  private convMutex = new AsyncMutex();

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

    // Schedule periodic processing (recursive setTimeout prevents overlap)
    this.scheduleNext();
  }

  private scheduleNext() {
    if (!this.running) return;
    this.timerId = setTimeout(() => {
      if (!this.running || this.isProcessing) {
        this.scheduleNext();
        return;
      }
      this.isProcessing = true;
      this.processAllAgents()
        .catch((err) => logger.error({ err: err.message }, "Message processor cycle failed"))
        .finally(() => {
          this.isProcessing = false;
          this.scheduleNext();
        });
    }, this.intervalMs);
    if (this.timerId && typeof this.timerId.unref === "function") this.timerId.unref();
  }

  stop() {
    this.running = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    logger.info("Message processor stopped");
  }

  private async processAllAgents() {
    if (!this.running) return;

    this.cleanupStaleConversations();

    const messaging = await getMessagingSystem();
    const contextManager = new AgentContextManager(this.kanban, this.memory);

    for (const agentId of getCoreStaffIds()) {
      try {
        await this.processAgent(agentId, messaging, contextManager);
      } catch (err: any) {
        logger.error({ agentId, err: err.message }, "Failed to process agent messages");
        ErrorBus.emit({
          type: "message:failed",
          severity: "warn",
          component: "message-processor",
          error: err instanceof Error ? err : new Error(String(err)),
          message: `Message processing failed for agent ${agentId}`,
          context: { agentId },
        });
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

    // Check for conversation-tagged threads
    for (const msg of validResponses) {
      const tags = msg.tags || [];
      if (tags.includes("conversation")) {
        const convKey = `conv:${msg.thread_id}`;
        const release = await this.convMutex.acquire(convKey);
        try {
          const existing = this.activeConversations.get(convKey);

          if (!existing) {
            // New conversation started
            this.activeConversations.set(convKey, {
              thread_id: msg.thread_id,
              round: 1,
              initiated_by: msg.from,
              started_at: Date.now(),
            });
          } else if (existing.round >= 5) {
            // Max rounds reached — inject conclusion reminder
            msg.content = `[This conversation has reached the maximum of 5 rounds. Please provide a clear conclusion and end the conversation.]\n\n${msg.content}`;
          } else {
            existing.round++;
          }
        } finally {
          release();
        }
      }
    }

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

        // Check if this is a conversation conclusion
        const convKey = `conv:${msg.thread_id}`;
        const convRelease = await this.convMutex.acquire(convKey);
        try {
          const conv = this.activeConversations.get(convKey);
          if (conv && result.text) {
            const hasConclusion = /CONCLUSION[:\s]|To conclude|In summary|Final decision|Here's the conclusion/i.test(result.text);

            if (hasConclusion || conv.round >= 5) {
              this.activeConversations.delete(convKey);

              // If initiating agent is the current active agent, deliver conclusion to user
              if (conv.initiated_by === agentId) {
                try {
                  const { sendTelegramMessage } = await import("../integrations/telegram");
                  const { getStaffById } = await import("../staff/core-staff");
                  const staff = getStaffById(agentId);
                  if (staff) {
                    const prefix = `${staff.avatar} **${staff.name}** (${staff.title}):\n\n`;
                    await sendTelegramMessage(`${prefix}${result.text.slice(0, 4000)}`);
                    logger.info({ agentId, threadId: msg.thread_id }, "Conversation conclusion delivered to user");
                  }
                } catch (err: any) {
                  logger.warn({ agentId, err: err.message }, "Failed to deliver conversation conclusion to user");
                }
              }
            }
          }
        } finally {
          convRelease();
        }

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
        const threadKey = `fail:${agentId}:${msg.thread_id}`;
        const failRelease = await this.convMutex.acquire(threadKey);
        try {
          const retries = (this.failedThreads.get(threadKey) || 0) + 1;
          this.failedThreads.set(threadKey, retries);

          if (retries >= MAX_THREAD_RETRIES) {
            logger.error(
              { agentId, threadId: msg.thread_id, retries, err: err.message },
              "Thread permanently failed — archiving after max retries"
            );
            await messaging.markAsRead(agentId, msg.thread_id);
            this.failedThreads.delete(threadKey);
            ErrorBus.emit({
              type: "message:failed",
              severity: "error",
              component: "message-processor",
              error: err instanceof Error ? err : new Error(err.message),
              message: `Thread ${msg.thread_id} failed ${retries} times for ${agentId}`,
              agentId,
              context: { thread_id: msg.thread_id, retries, action: "archived" },
            });
          } else {
            logger.warn(
              { agentId, threadId: msg.thread_id, retries, err: err.message },
              `Thread failed (attempt ${retries}/${MAX_THREAD_RETRIES})`
            );
          }
        } finally {
          failRelease();
        }
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

  private cleanupStaleConversations() {
    const oneHourAgo = Date.now() - 3600000;
    for (const [key, conv] of this.activeConversations) {
      if (conv.started_at < oneHourAgo) {
        this.activeConversations.delete(key);
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
