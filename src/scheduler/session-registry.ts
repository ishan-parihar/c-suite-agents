// SessionRegistry — Persistent SQLite-backed session store for native runtime
// Manages agent sessions with workspace paths, tracks creation/usage, persists conversation history

import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { logger } from "../logger.js";
import { initWorkspace } from "../agents/workspace-manager.js";

export type TransportMode = "ws" | "sse" | "polling";

export interface SessionRecord {
  agent_id: string;
  session_id: string;
  chat_id: string | null;
  title: string;
  workspace_path: string | null;
  created_at: number;
  last_used: number;
  message_count: number;
  compaction_count: number;
  previous_summary: string | null;
  has_real_conversation: number;
}

export interface StoredMessage {
  session_id: string;
  message_index: number;
  role: string;
  content: string | null;
  token_estimate: number;
  is_summary: number;
  compacted: number;
  timestamp: number;
}

export interface StoredToolCall {
  session_id: string;
  tool_index: number;
  id: string;
  name: string;
  arguments: string;
  result: string | null;
  token_estimate: number;
  compacted: number;
  timestamp: number;
}

export class SessionRegistry {
  private db: Database.Database;
  private transportState: Map<string, { mode: TransportMode; connectedAt: number; lastActivity: number }> = new Map();

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");

    this.initSchema();
    this.migrateSessionMessagesNullableContent();
  }

  private migrateColumns(): void {
    for (const col of ["workspace_path TEXT", "compaction_count INTEGER DEFAULT 0", "previous_summary TEXT", "has_real_conversation INTEGER DEFAULT 0"]) {
      try { this.db.exec(`ALTER TABLE sessions ADD COLUMN ${col}`); } catch { }
    }
  }

  private migrateSessionMessagesNullableContent(): void {
    const info = this.db.pragma("table_info(session_messages)") as Array<{ name: string; notnull: number }>;
    const contentCol = info.find(c => c.name === "content");
    if (contentCol && contentCol.notnull === 1) {
      this.db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;
        ALTER TABLE session_messages RENAME TO session_messages_old;
        CREATE TABLE session_messages (
          session_id TEXT NOT NULL,
          message_index INTEGER NOT NULL,
          role TEXT NOT NULL,
          content TEXT,
          token_estimate INTEGER NOT NULL DEFAULT 0,
          is_summary INTEGER NOT NULL DEFAULT 0,
          compacted INTEGER NOT NULL DEFAULT 0,
          timestamp INTEGER NOT NULL,
          PRIMARY KEY (session_id, message_index)
        );
        INSERT INTO session_messages (session_id, message_index, role, content, token_estimate, is_summary, compacted, timestamp)
          SELECT session_id, message_index, role, content, token_estimate, is_summary, compacted, timestamp FROM session_messages_old;
        DROP TABLE session_messages_old;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
    }
  }

  private initSchema(): void {
    this.migrateColumns();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        agent_id TEXT NOT NULL,
        chat_id TEXT,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        workspace_path TEXT,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        compaction_count INTEGER NOT NULL DEFAULT 0,
        previous_summary TEXT,
        has_real_conversation INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (agent_id, chat_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_last_used ON sessions(last_used);

       CREATE TABLE IF NOT EXISTS session_messages (
         session_id TEXT NOT NULL,
         message_index INTEGER NOT NULL,
         role TEXT NOT NULL,
         content TEXT,
         token_estimate INTEGER NOT NULL DEFAULT 0,
         is_summary INTEGER NOT NULL DEFAULT 0,
         compacted INTEGER NOT NULL DEFAULT 0,
         timestamp INTEGER NOT NULL,
         PRIMARY KEY (session_id, message_index)
       );

      CREATE TABLE IF NOT EXISTS session_tool_calls (
        session_id TEXT NOT NULL,
        tool_index INTEGER NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        arguments TEXT NOT NULL,
        result TEXT,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        compacted INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (session_id, tool_index)
      );
    `);
  }

  private queryAll<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async getOrCreate(agentId: string, context: { chatId?: string; title?: string; workspacePath?: string }): Promise<string> {
    const chatId = context.chatId || null;
    const title = context.title || `${agentId}${chatId ? ` @ ${chatId}` : ""}`;
    const workspacePath = context.workspacePath || this.ensureWorkspace(agentId);

    const existing = this.db.prepare(
      "SELECT * FROM sessions WHERE agent_id = ? AND (chat_id = ? OR (chat_id IS NULL AND ? IS NULL))"
    ).get(agentId, chatId, chatId) as SessionRecord | undefined;

    if (existing) {
      this.db.prepare("UPDATE sessions SET last_used = ? WHERE session_id = ?")
        .run(Date.now(), existing.session_id);
      logger.debug({ sessionId: existing.session_id, agentId }, "Reused existing session");
      return existing.session_id;
    }

    const sessionId = this.generateSessionId();
    const now = Date.now();
    this.db.prepare(
      "INSERT INTO sessions (agent_id, chat_id, session_id, title, workspace_path, created_at, last_used, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(agentId, chatId, sessionId, title, workspacePath, now, now, 0);

    logger.info({ sessionId, agentId, chatId, workspace: workspacePath }, "Created new session");
    return sessionId;
  }

  // ── Message Persistence ────────────────────────────────────────────

  /**
   * Save messages for a session. Replaces all existing messages.
   */
   saveMessages(sessionId: string, messages: Array<{
     role: string;
     content: string | null;
     tokenEstimate: number;
     isSummary?: boolean;
     compacted?: boolean;
     timestamp: number;
   }>): void {
    const saveStmt = this.db.prepare(
      "INSERT OR REPLACE INTO session_messages (session_id, message_index, role, content, token_estimate, is_summary, compacted, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const trx = this.db.transaction((msgs) => {
      this.db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        saveStmt.run(sessionId, i, m.role, m.content, m.tokenEstimate || 0, m.isSummary ? 1 : 0, m.compacted ? 1 : 0, m.timestamp);
      }
      this.db.prepare("UPDATE sessions SET message_count = ?, last_used = ? WHERE session_id = ?")
        .run(msgs.length, Date.now(), sessionId);
    });

    trx(messages);
    logger.debug({ sessionId, count: messages.length }, "Messages persisted");
  }

  /**
   * Save tool calls for a session. Replaces all existing tool calls.
   */
  saveToolCalls(sessionId: string, toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
    result?: string;
    tokenEstimate?: number;
    compacted?: boolean;
    timestamp: number;
  }>): void {
    const saveStmt = this.db.prepare(
      "INSERT OR REPLACE INTO session_tool_calls (session_id, tool_index, id, name, arguments, result, token_estimate, compacted, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const trx = this.db.transaction((tcs) => {
      this.db.prepare("DELETE FROM session_tool_calls WHERE session_id = ?").run(sessionId);
      for (let i = 0; i < tcs.length; i++) {
        const tc = tcs[i];
        saveStmt.run(sessionId, i, tc.id, tc.name, tc.arguments, tc.result || null, tc.tokenEstimate || 0, tc.compacted ? 1 : 0, tc.timestamp);
      }
    });

    trx(toolCalls);
    logger.debug({ sessionId, count: toolCalls.length }, "Tool calls persisted");
  }

  /**
   * Load messages and tool calls for a session from SQLite.
   */
   loadSessionData(sessionId: string): {
     messages: Array<{ role: string; content: string | null; tokenEstimate: number; isSummary: boolean; compacted: boolean; timestamp: number }>;
     toolCalls: Array<{ id: string; name: string; arguments: string; result?: string; tokenEstimate: number; compacted: boolean; timestamp: number }>;
     metadata: { compactionCount: number; previousSummary?: string; hasRealConversation: boolean } | null;
   } | null {
    const metadata = this.db.prepare(
      "SELECT compaction_count, previous_summary, has_real_conversation FROM sessions WHERE session_id = ?"
    ).get(sessionId) as { compaction_count: number; previous_summary: string | null; has_real_conversation: number } | undefined;

    const messages = this.queryAll<StoredMessage>(
      "SELECT role, content, token_estimate, is_summary, compacted, timestamp FROM session_messages WHERE session_id = ? ORDER BY message_index ASC",
      sessionId
    );

    const toolCalls = this.queryAll<StoredToolCall>(
      "SELECT id, name, arguments, result, token_estimate, compacted, timestamp FROM session_tool_calls WHERE session_id = ? ORDER BY tool_index ASC",
      sessionId
    );

    if (messages.length === 0) return null;

    return {
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        tokenEstimate: m.token_estimate,
        isSummary: m.is_summary === 1,
        compacted: m.compacted === 1,
        timestamp: m.timestamp,
      })),
      toolCalls: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        result: tc.result || undefined,
        tokenEstimate: tc.token_estimate,
        compacted: tc.compacted === 1,
        timestamp: tc.timestamp,
      })),
      metadata: metadata ? {
        compactionCount: metadata.compaction_count,
        previousSummary: metadata.previous_summary || undefined,
        hasRealConversation: metadata.has_real_conversation === 1,
      } : null,
    };
  }

  /**
   * Update session metadata (compaction count, previous summary, etc.)
   */
  updateSessionMetadata(sessionId: string, data: {
    compactionCount?: number;
    previousSummary?: string;
    hasRealConversation?: boolean;
  }): void {
    const parts: string[] = [];
    const values: any[] = [];

    if (data.compactionCount !== undefined) {
      parts.push("compaction_count = ?");
      values.push(data.compactionCount);
    }
    if (data.previousSummary !== undefined) {
      parts.push("previous_summary = ?");
      values.push(data.previousSummary);
    }
    if (data.hasRealConversation !== undefined) {
      parts.push("has_real_conversation = ?");
      values.push(data.hasRealConversation ? 1 : 0);
    }

    if (parts.length === 0) return;

    parts.push("last_used = ?");
    values.push(Date.now());
    values.push(sessionId);

    this.db.prepare(`UPDATE sessions SET ${parts.join(", ")} WHERE session_id = ?`).run(...values);
  }

  /**
   * Delete all persisted data for a session.
   */
  deleteSessionData(sessionId: string): void {
    this.db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM session_tool_calls WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
    logger.info({ sessionId }, "Session data deleted");
  }

  // ── Original Methods ───────────────────────────────────────────────

  async touch(sessionId: string): Promise<void> {
    this.db.prepare("UPDATE sessions SET last_used = ?, message_count = message_count + 1 WHERE session_id = ?")
      .run(Date.now(), sessionId);
  }

  async invalidate(agentId: string, chatId?: string): Promise<void> {
    if (chatId) {
      const session = this.db.prepare("SELECT session_id FROM sessions WHERE agent_id = ? AND chat_id = ?").get(agentId, chatId) as { session_id: string } | undefined;
      if (session) this.deleteSessionData(session.session_id);
    } else {
      const sessions = this.queryAll<{ session_id: string }>("SELECT session_id FROM sessions WHERE agent_id = ? AND chat_id IS NULL", agentId) as { session_id: string }[];
      for (const s of sessions) this.deleteSessionData(s.session_id);
    }
    logger.info({ agentId, chatId }, "Session invalidated");
  }

  async updateSessionId(agentId: string, oldSessionId: string, newSessionId: string): Promise<void> {
    this.db.prepare("UPDATE sessions SET session_id = ?, last_used = ? WHERE agent_id = ? AND session_id = ?")
      .run(newSessionId, Date.now(), agentId, oldSessionId);
    this.db.prepare("UPDATE session_messages SET session_id = ? WHERE session_id = ?").run(newSessionId, oldSessionId);
    this.db.prepare("UPDATE session_tool_calls SET session_id = ? WHERE session_id = ?").run(newSessionId, oldSessionId);
    logger.info({ agentId, oldSession: oldSessionId, newSession: newSessionId }, "Session ID updated");
  }

  async cleanup(options?: { maxAgeMs?: number; maxPerAgent?: number }): Promise<void> {
    const maxAgeMs = options?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
    const maxPerAgent = options?.maxPerAgent ?? 3;

    const cutoff = Date.now() - maxAgeMs;
    const oldSessions = this.queryAll<{ session_id: string }>("SELECT session_id FROM sessions WHERE last_used < ?", cutoff) as { session_id: string }[];
    for (const s of oldSessions) this.deleteSessionData(s.session_id);
    if (oldSessions.length > 0) {
      logger.info({ count: oldSessions.length }, "Cleaned up old sessions");
    }

    const agents = this.queryAll<{ agent_id: string }>("SELECT DISTINCT agent_id FROM sessions") as { agent_id: string }[];
    for (const { agent_id } of agents) {
      const excess = this.queryAll<{ session_id: string }>(
        "SELECT session_id FROM sessions WHERE agent_id = ? ORDER BY last_used DESC LIMIT -1 OFFSET ?",
        agent_id, maxPerAgent
      ) as { session_id: string }[];
      for (const { session_id } of excess) this.deleteSessionData(session_id);
    }
  }

  async list(): Promise<SessionRecord[]> {
    return this.queryAll<SessionRecord>("SELECT * FROM sessions ORDER BY last_used DESC") as SessionRecord[];
  }

  async findBySessionId(sessionId: string): Promise<SessionRecord | null> {
    return this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as SessionRecord | null;
  }

  getWorkspacePath(agentId: string): string | null {
    return this.ensureWorkspace(agentId);
  }

  private ensureWorkspace(agentId: string): string | null {
    try {
      return initWorkspace(agentId);
    } catch (err: any) {
      logger.error({ agentId, err: err.message }, "Failed to initialize workspace");
      return null;
    }
  }

  private generateSessionId(): string {
    return randomUUID();
  }

  setTransport(agentId: string, mode: TransportMode): void {
    this.transportState.set(agentId, { mode, connectedAt: Date.now(), lastActivity: Date.now() });
    logger.info({ agentId, mode }, "Transport state updated");
  }

  getTransport(agentId: string): TransportMode {
    return this.transportState.get(agentId)?.mode ?? "polling";
  }

  clearTransport(agentId: string): void {
    this.transportState.delete(agentId);
    logger.info({ agentId }, "Transport state cleared");
  }

  getActiveTransports(): Map<string, { mode: TransportMode; connectedAt: number; lastActivity: number }> {
    return new Map(this.transportState);
  }

  touchTransport(agentId: string): void {
    const state = this.transportState.get(agentId);
    if (state) {
      state.lastActivity = Date.now();
      this.transportState.set(agentId, state);
    }
  }

  close(): void {
    this.db.close();
  }
}

let registry: SessionRegistry | null = null;

export function getSessionRegistry(dbPath?: string): SessionRegistry {
  if (!registry) {
    const defaultPath = path.join(
      process.env.OPERANT_DATA_DIR || process.cwd(),
      "data",
      "sessions.db"
    );
    registry = new SessionRegistry(dbPath || defaultPath);
  }
  return registry;
}
