import { EventEmitter } from "node:events";
import { logger } from "../logger";
import type { MessagePayload, ServerFrame, WsSession } from "./ws-types";
import { serializeFrame } from "./ws-types";

interface QueuedMessage {
  agentId: string;
  payload: MessagePayload;
  seq: number;
  queuedAt: number;
  delivered: boolean;
}

export class MessageBus extends EventEmitter {
  private sessions: Map<string, WsSession> = new Map();
  private offlineQueues: Map<string, QueuedMessage[]> = new Map();
  private globalSeq = 0;
  private maxQueueSize: number;
  private observers: Set<WsSession> = new Set();

  constructor(options?: { maxQueueSize?: number }) {
    super();
    this.maxQueueSize = options?.maxQueueSize ?? 10000;
  }

  syncObservers(observers: ReadonlySet<WsSession>): void {
    this.observers = new Set(observers);
  }

  registerSession(session: WsSession): void {
    this.sessions.set(session.agentId, session);
    logger.info({ agentId: session.agentId, sessionId: session.sessionId }, "WS session registered in message bus");
  }

  unregisterSession(agentId: string): void {
    this.sessions.delete(agentId);
    logger.info({ agentId }, "WS session unregistered from message bus");
  }

  getSession(agentId: string): WsSession | undefined {
    return this.sessions.get(agentId);
  }

  isConnected(agentId: string): boolean {
    return this.sessions.has(agentId);
  }

  private broadcastToObservers(frame: ServerFrame): void {
    for (const observer of this.observers) {
      if (observer.ws.readyState !== 1) continue; // WebSocket.OPEN
      try {
        observer.ws.send(serializeFrame(frame));
      } catch {
        // Ignore send errors — observer will be cleaned up on close
      }
    }
  }

  publish(agentId: string, payload: MessagePayload): boolean {
    const session = this.sessions.get(agentId);

    if (session && session.ws.readyState === 1) {
      const seq = this.nextSeq();
      const frame: ServerFrame = { type: "message", payload, seq };
      try {
        session.ws.send(serializeFrame(frame));
        session.seq = seq;
        session.lastActivity = Date.now();
        logger.debug({ agentId, seq, messageId: payload.message_id }, "Message pushed via WS");
        // Broadcast to observers with the same seq
        if (this.observers.size > 0) {
          this.broadcastToObservers(frame);
        }
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ agentId, err: msg }, "WS push failed, queuing message");
        // FIX 2: On WS send failure, queue the message instead of returning true
        this.queueMessage(agentId, payload);
        return false;
      }
    }

    this.queueMessage(agentId, payload);
    return false;
  }

  private queueMessage(agentId: string, payload: MessagePayload): void {
    let queue = this.offlineQueues.get(agentId);
    if (!queue) {
      queue = [];
      this.offlineQueues.set(agentId, queue);
    }

    if (queue.length >= this.maxQueueSize) {
      queue.shift();
      logger.warn({ agentId, queueSize: this.maxQueueSize }, "Offline queue overflow — oldest message dropped");
    }

    queue.push({
      agentId,
      payload,
      seq: this.nextSeq(),
      queuedAt: Date.now(),
      delivered: false,
    });

    logger.debug({ agentId, queueLength: queue.length }, "Message queued for offline agent");
  }

  replayQueuedMessages(agentId: string, lastSeq: number): number {
    const queue = this.offlineQueues.get(agentId);
    if (!queue || queue.length === 0) return 0;

    const session = this.sessions.get(agentId);
    if (!session) return 0;

    const toDeliver = queue.filter(m => m.seq > lastSeq);
    let delivered = 0;

    for (const msg of toDeliver) {
      if (session.ws.readyState !== 1) break;

      const frame: ServerFrame = { type: "message", payload: msg.payload, seq: msg.seq };
      try {
        session.ws.send(JSON.stringify(frame));
        msg.delivered = true;
        delivered++;
      } catch {
        break;
      }
    }

    const remaining = queue.filter(m => !m.delivered);
    if (remaining.length === 0) {
      this.offlineQueues.delete(agentId);
    } else {
      this.offlineQueues.set(agentId, remaining);
    }

    if (delivered > 0) {
      logger.info({ agentId, delivered, totalQueued: queue.length }, "Replayed queued messages on reconnect");
    }

    return delivered;
  }

  getQueuedCount(agentId: string): number {
    return this.offlineQueues.get(agentId)?.length ?? 0;
  }

  private nextSeq(): number {
    return ++this.globalSeq;
  }

  getStats(): { activeSessions: number; offlineQueues: number; totalQueued: number; globalSeq: number } {
    let totalQueued = 0;
    for (const q of this.offlineQueues.values()) totalQueued += q.length;
    return {
      activeSessions: this.sessions.size,
      offlineQueues: this.offlineQueues.size,
      totalQueued,
      globalSeq: this.globalSeq,
    };
  }
}

let messageBus: MessageBus | null = null;

export function getMessageBus(): MessageBus {
  if (!messageBus) {
    messageBus = new MessageBus();
  }
  return messageBus;
}

export function resetMessageBus(): void {
  messageBus = null;
}
