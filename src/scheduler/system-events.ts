// System Event Queue — In-memory, session-scoped event injection for scheduled tasks
// Pattern: scheduled tasks push events here → heartbeat runner peeks and injects into agent prompts
// Based on OpenClaw's system-events.ts architecture

import { logger } from "../logger";
import { AsyncMutex } from "../runtime/async-mutex";
export { currentTimeLine, isSilentAck, stripHeartbeatToken } from "../runtime/utils";

export interface SystemEvent {
  id: string;
  agentId: string;
  text: string;
  contextKey: string;       // e.g., "cron:job-id", "exec:task-id", "heartbeat:domain-check"
  timestamp: number;
  priority: "P1" | "P2" | "P3" | "P4";
}

const MAX_EVENTS_PER_AGENT = 20;
const EVENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Consecutive no-change ack tracking — exponential backoff for passive heartbeats
let consecutiveAcks: Map<string, number> = new Map();
let lastAckTime: Map<string, number> = new Map();

// Active hours configuration (local time)
export const ACTIVE_HOURS = { start: 7, end: 23 }; // 7 AM - 11 PM

// Night-time heartbeat interval multiplier (every N heartbeats instead of every one)
const NIGHT_SKIP_INTERVAL = 8; // Only fire every 8th heartbeat at night (= every 2 hours)
let nightHeartbeatCount = 0;

let eventQueue: Map<string, SystemEvent[]> = new Map();

// Module-level mutex for all mutable state access
const moduleMutex = new AsyncMutex();

function getAgentEvents(agentId: string): SystemEvent[] {
  return eventQueue.get(agentId) || [];
}

function setAgentEvents(agentId: string, events: SystemEvent[]): void {
  eventQueue.set(agentId, events);
}

let idCounter = 0;

function generateId(): string {
  return `evt-${Date.now()}-${++idCounter}`;
}

/** Internal unlocked version — callers must hold moduleMutex */
function enqueueInternal(params: {
  agentId: string;
  text: string;
  contextKey: string;
  priority?: "P1" | "P2" | "P3" | "P4";
}): SystemEvent {
  const event: SystemEvent = {
    id: generateId(),
    agentId: params.agentId,
    text: params.text,
    contextKey: params.contextKey,
    timestamp: Date.now(),
    priority: params.priority || "P3",
  };

  const events = getAgentEvents(params.agentId);

  // Enforce max events per agent — drop oldest
  if (events.length >= MAX_EVENTS_PER_AGENT) {
    const dropped = events.shift();
    logger.warn({ eventId: dropped?.id, agentId: params.agentId }, "Event queue full, dropping oldest");
  }

  events.push(event);
  setAgentEvents(params.agentId, events);

  logger.info({ eventId: event.id, agentId: params.agentId, contextKey: params.contextKey }, "System event enqueued");
  return event;
}

export class SystemEventQueue {
  /**
   * Enqueue a system event for an agent.
   * Events are peeked during the next heartbeat and injected into the prompt.
   */
  static async enqueue(params: {
    agentId: string;
    text: string;
    contextKey: string;
    priority?: "P1" | "P2" | "P3" | "P4";
  }): Promise<SystemEvent> {
    const release = await moduleMutex.acquire("system-events");
    try {
      return enqueueInternal(params);
    } finally {
      release();
    }
  }

  /**
   * Enqueue with coalescence — replaces existing events with the same contextKey
   * instead of appending. Prevents 20 identical heartbeat blocks from stacking.
   */
  static async enqueueCoalesced(params: {
    agentId: string;
    text: string;
    contextKey: string;
    priority?: "P1" | "P2" | "P3" | "P4";
  }): Promise<SystemEvent> {
    const release = await moduleMutex.acquire("system-events");
    try {
      const events = getAgentEvents(params.agentId);

      // Check if an event with this contextKey already exists
      const existingIndex = events.findIndex(e => e.contextKey === params.contextKey);
      if (existingIndex !== -1) {
        // Replace existing event with updated text and timestamp
        const updated: SystemEvent = {
          ...events[existingIndex],
          text: params.text,
          timestamp: Date.now(),
          priority: params.priority || events[existingIndex].priority,
        };
        events[existingIndex] = updated;
        setAgentEvents(params.agentId, events);
        logger.debug({ agentId: params.agentId, contextKey: params.contextKey }, "System event coalesced (replaced)");
        return updated;
      }

      // No existing event — add new one
      return enqueueInternal(params);
    } finally {
      release();
    }
  }

  /**
   * Peek at pending events for an agent without removing them.
   * Used by heartbeat runner to decide what to inject into the prompt.
   */
  static async peek(agentId: string): Promise<SystemEvent[]> {
    const release = await moduleMutex.acquire("system-events");
    try {
      const events = getAgentEvents(agentId);

      // Purge expired events
      const now = Date.now();
      const valid = events.filter(e => (now - e.timestamp) < EVENT_TTL_MS);
      if (valid.length !== events.length) {
        setAgentEvents(agentId, valid);
      }

      return valid;
    } finally {
      release();
    }
  }

  /**
   * Peek events filtered by context type (e.g., only cron events).
   */
  static async peekByContext(agentId: string, contextPrefix: string): Promise<SystemEvent[]> {
    const events = await this.peek(agentId);
    return events.filter(e => e.contextKey.startsWith(contextPrefix));
  }

  /**
   * Peek only the LATEST event per contextKey.
   * Prevents duplicate injection of the same event type into the prompt.
   * This is the PRIMARY method heartbeat should use — not peek().
   */
  static async peekLatest(agentId: string): Promise<SystemEvent[]> {
    const events = await this.peek(agentId);
    // Deduplicate by contextKey, keeping the most recent timestamp
    const map = new Map<string, SystemEvent>();
    for (const e of events) {
      const existing = map.get(e.contextKey);
      if (!existing || e.timestamp > existing.timestamp) {
        map.set(e.contextKey, e);
      }
    }
    return Array.from(map.values());
  }

  /**
   * Check if any events exist for an agent.
   */
  static async hasEvents(agentId: string): Promise<boolean> {
    const events = await this.peek(agentId);
    return events.length > 0;
  }

  /**
   * Clear all pending events for an agent after they've been processed.
   */
  static async clear(agentId: string): Promise<number> {
    const release = await moduleMutex.acquire("system-events");
    try {
      const events = getAgentEvents(agentId);
      const count = events.length;
      if (count > 0) {
        setAgentEvents(agentId, []);
        logger.info({ agentId, count }, "System events cleared");
      }
      return count;
    } finally {
      release();
    }
  }

  /**
   * Clear specific events by context key.
   */
  static async clearByContext(agentId: string, contextKey: string): Promise<number> {
    const release = await moduleMutex.acquire("system-events");
    try {
      const events = getAgentEvents(agentId);
      const before = events.length;
      const remaining = events.filter(e => e.contextKey !== contextKey);
      setAgentEvents(agentId, remaining);
      const cleared = before - remaining.length;
      if (cleared > 0) {
        logger.info({ agentId, contextKey, cleared }, "Events cleared by context");
      }
      return cleared;
    } finally {
      release();
    }
  }

  /**
   * Get event count for monitoring.
   */
  static stats(): { total: number; byAgent: Record<string, number> } {
    const byAgent: Record<string, number> = {};
    let total = 0;
    for (const [agentId, events] of eventQueue) {
      byAgent[agentId] = events.length;
      total += events.length;
    }
    return { total, byAgent };
  }

  /**
   * Reset all events (for testing or shutdown).
   */
  static reset(): void {
    eventQueue = new Map();
    consecutiveAcks = new Map();
    lastAckTime = new Map();
    nightHeartbeatCount = 0;
    logger.info("System event queue reset");
  }

  // =========================================================================
  // Consecutive ACK Tracking — Exponential backoff for no-change cycles
  // =========================================================================

  /**
   * Record a HEARTBEAT_OK ack. Returns true if the agent should skip
   * the next heartbeat due to too many consecutive no-change cycles.
   */
  static async recordAck(agentId: string): Promise<{ shouldSkip: boolean; consecutiveCount: number }> {
    const release = await moduleMutex.acquire("system-events");
    try {
      const count = (consecutiveAcks.get(agentId) || 0) + 1;
      consecutiveAcks.set(agentId, count);
      lastAckTime.set(agentId, Date.now());

      logger.debug({ agentId, count }, "Consecutive heartbeat ack recorded");

      // After 3 consecutive acks: warn
      // After 6: skip heartbeats until a real event resets the counter
      if (count >= 6) {
        logger.info({ agentId, count }, "Too many consecutive HEARTBEAT_OK — entering sleep mode");
        return { shouldSkip: true, consecutiveCount: count };
      }

      return { shouldSkip: false, consecutiveCount: count };
    } finally {
      release();
    }
  }

  /**
   * Reset the consecutive ack counter (called when the agent finds something actionable).
   */
  static async resetAck(agentId: string): Promise<void> {
    const release = await moduleMutex.acquire("system-events");
    try {
      const prev = consecutiveAcks.get(agentId) || 0;
      consecutiveAcks.set(agentId, 0);
      if (prev > 0) {
        logger.info({ agentId, prevCount: prev }, "Consecutive ack counter reset — agent found actionable item");
      }
    } finally {
      release();
    }
  }

  /**
   * Get the current consecutive ack count for monitoring.
   */
  static getAckCount(agentId: string): number {
    return consecutiveAcks.get(agentId) || 0;
  }

  // =========================================================================
  // Active Hours — Reduce night-time heartbeat frequency
  // =========================================================================

  /**
   * Check if current time is within active hours.
   */
  static isActiveHours(): boolean {
    const hour = new Date().getHours();
    return hour >= ACTIVE_HOURS.start && hour < ACTIVE_HOURS.end;
  }

  /**
   * Check if this heartbeat should fire. During night hours, only fires
   * every Nth call (default: every 8th = every 2 hours at 15min intervals).
   */
  static async shouldFireHeartbeat(): Promise<boolean> {
    const release = await moduleMutex.acquire("system-events");
    try {
      if (this.isActiveHours()) return true;

      nightHeartbeatCount++;
      if (nightHeartbeatCount >= NIGHT_SKIP_INTERVAL) {
        nightHeartbeatCount = 0;
        logger.debug("Night heartbeat window — firing (every 2h)");
        return true;
      }

      logger.debug("Night heartbeat window — skipping (count: " + nightHeartbeatCount + "/" + NIGHT_SKIP_INTERVAL + ")");
      return false;
    } finally {
      release();
    }
  }
}

/**
 * Build a heartbeat prompt section from pending system events.
 * Uses peekLatest semantics — only the most recent event per contextKey.
 * Prevents duplicate injection of the same event type.
 */
export function buildSystemEventPrompt(events: SystemEvent[]): string {
  if (events.length === 0) return "";

  const sections: string[] = [];

  // Group by context type
  const cronEvents = events.filter(e => e.contextKey.startsWith("cron:"));
  const execEvents = events.filter(e => e.contextKey.startsWith("exec:"));
  const heartbeatEvents = events.filter(e => e.contextKey.startsWith("heartbeat:"));
  const otherEvents = events.filter(e =>
    !e.contextKey.startsWith("cron:") &&
    !e.contextKey.startsWith("exec:") &&
    !e.contextKey.startsWith("heartbeat:")
  );

  if (cronEvents.length > 0) {
    sections.push("## Scheduled Tasks Due");
    sections.push("The following scheduled tasks have been triggered. Execute them and report results:");
    sections.push("");
    for (const event of cronEvents) {
      sections.push(`### Task: ${event.contextKey.replace("cron:", "")}`);
      sections.push(event.text);
      sections.push("");
    }
  }

  if (execEvents.length > 0) {
    sections.push("## Completed Async Tasks");
    sections.push("The following async tasks you started earlier have completed:");
    sections.push("");
    for (const event of execEvents) {
      sections.push(`### Result: ${event.contextKey.replace("exec:", "")}`);
      sections.push(event.text);
      sections.push("");
    }
  }

  // Heartbeat events — only show ONE, the latest
  if (heartbeatEvents.length > 0) {
    // Sort by timestamp, take the latest
    const latest = heartbeatEvents.sort((a, b) => b.timestamp - a.timestamp)[0];
    sections.push("## Current Task");
    sections.push(latest.text);
    sections.push("");
  }

  if (otherEvents.length > 0) {
    sections.push("## Pending Events");
    for (const event of otherEvents) {
      sections.push(`### ${event.contextKey}`);
      sections.push(event.text);
      sections.push("");
    }
  }

  return sections.join("\n");
}
