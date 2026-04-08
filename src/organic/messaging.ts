// Organic Messaging System — Persistent with Vector Embeddings

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { getStaffById, getBoardMembers } from "../staff/core-staff.js";
import initSqlJs from "sql.js";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { getEmbeddingService } from "../memory/embeddings.js";
import { validateAgentIdentity } from "../auth/session.js";
import { EventEmitter } from "node:events";
import { ErrorBus } from "../runtime/error-emitter.js";

export type MessagePriority = "P1" | "P2" | "P3" | "P4";

export interface Message {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  content: string;
  priority: MessagePriority;
  requires_response: boolean;
  responded: boolean;
  created_at: number;
  read: boolean;
  tags?: string[];
  vector?: number[];
}

export interface MessageThread {
  id: string;
  participants: string[];
  subject: string;
  created_at: number;
  updated_at: number;
  status: "active" | "resolved" | "escalated" | "archived";
  tags?: string[];
  summary?: string;
}

export interface Escalation {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  reason: string;
  created_at: number;
  status: "pending" | "reviewed" | "resolved" | "dismissed";
}

export interface MessageSearchResult {
  message: Message;
  thread: MessageThread;
  relevance_score: number;
  snippet: string;
}

function safeJsonParse<T>(raw: string | undefined | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

const MAX_MESSAGE_LENGTH = 10000;

export class MessagingSystem extends EventEmitter {
  private db: any;
  private dbPath: string;
  private persistLock = Promise.resolve();

  private constructor(dbPath: string) {
    super();
    this.dbPath = dbPath;
    this.db = null;
  }

  static async init(dbPath: string = "messages.db"): Promise<MessagingSystem> {
    const instance = new MessagingSystem(dbPath);
    await instance.initializeDB();
    return instance;
  }

  private async initializeDB() {
    const resolved = resolve(this.dbPath);
    if (!resolved.endsWith(".db") && !resolved.endsWith(".sqlite")) {
      throw new Error(`Invalid database path: ${this.dbPath}`);
    }
    this.dbPath = resolved;
    const SQL = await initSqlJs({ locateFile: (f: string) => `node_modules/sql.js/dist/${f}` });
    
    try {
      const buf = await fs.readFile(this.dbPath);
      this.db = new SQL.Database(new Uint8Array(buf));
    } catch {
      this.db = new SQL.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        participants TEXT,
        subject TEXT,
        status TEXT,
        tags TEXT,
        summary TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        from_agent TEXT,
        to_agent TEXT,
        content TEXT,
        priority TEXT,
        requires_response INTEGER,
        responded INTEGER,
        created_at INTEGER,
        read INTEGER,
        tags TEXT,
        vector TEXT,
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      );
      CREATE TABLE IF NOT EXISTS escalations (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        from_agent TEXT,
        to_agent TEXT,
        reason TEXT,
        created_at INTEGER,
        status TEXT,
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_agent);
      CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_agent);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    `);

    // Migration: Add vector column if it doesn't exist (legacy database compatibility)
    try {
      this.db.exec(`SELECT vector FROM messages LIMIT 0`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("no such column") || msg.includes("unknown column")) {
        logger.info("Migrating: adding vector column to messages table");
        this.db.run(`ALTER TABLE messages ADD COLUMN vector TEXT DEFAULT '[]'`);
        await this.persist();
      } else {
        throw err;
      }
    }

    await this.persist();
    logger.info({ dbPath: this.dbPath }, "Messaging database initialized");
  }

  private async persist() {
    if (!this.db) return;
    const data = this.db.export();
    const tmpPath = `${this.dbPath}.tmp`;
    const currentLock = this.persistLock;
    this.persistLock = currentLock.then(async () => {
      await fs.writeFile(tmpPath, Buffer.from(data));
      await fs.rename(tmpPath, this.dbPath);
    }).catch(async (err) => {
      try { await fs.unlink(tmpPath); } catch { /* tmp may not exist */ }
      throw err;
    }).finally(() => {
      this.persistLock = Promise.resolve();
    });
    await this.persistLock;
  }

  private sanitizeParams(params?: unknown[]): unknown[] {
    if (!params) return [];
    return params.map(p => p === undefined ? null : p);
  }

  private queryAllArrays(sql: string, params?: unknown[]): unknown[][] {
    const stmt = this.db.prepare(sql);
    try {
      if (params) stmt.bind(this.sanitizeParams(params));
      const results: unknown[][] = [];
      while (stmt.step()) results.push(stmt.get() as unknown[]);
      return results;
    } finally {
      stmt.free();
    }
  }

  private queryOneRow(sql: string, params?: unknown[]): any {
    const stmt = this.db.prepare(sql);
    try {
      if (params) stmt.bind(this.sanitizeParams(params));
      const result = stmt.step() ? stmt.get() : null;
      return result;
    } finally {
      stmt.free();
    }
  }

  async close(): Promise<void> {
    await this.persist();
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const embedder = getEmbeddingService();
      return embedder.embed(text);
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to generate embedding");
      return [];
    }
  }

  async send({
    from,
    to,
    content,
    priority = "P3",
    requires_response = false,
    subject,
    tags = []
  }: {
    from: string;
    to: string;
    content: string;
    priority?: MessagePriority;
    requires_response?: boolean;
    subject?: string;
    tags?: string[];
  }): Promise<MessageThread> {
    if (!content || content.trim().length === 0) throw new Error("Message content cannot be empty");
    if (content.length > MAX_MESSAGE_LENGTH) throw new Error(`Message content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`);

    const thread_id = uuidv4();
    const message_id = uuidv4();
    const now = Date.now();
    const vector = await this.generateEmbedding(content);

    this.db.run("BEGIN");
    try {
      this.db.run(
        "INSERT INTO threads (id, participants, subject, status, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        [thread_id, JSON.stringify([from, to]), subject || content.slice(0, 50), "active", JSON.stringify(tags), now, now]
      );
      this.db.run(
        "INSERT INTO messages (id, thread_id, from_agent, to_agent, content, priority, requires_response, responded, created_at, read, tags, vector) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [message_id, thread_id, from, to, content, priority, requires_response ? 1 : 0, 0, now, 0, JSON.stringify(tags), JSON.stringify(vector)]
      );
      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      ErrorBus.emit({
        type: "message:failed",
        severity: "error",
        component: "messaging",
        error: err instanceof Error ? err : new Error(String(err)),
        message: `Message send failed: ${err instanceof Error ? err.message : String(err)}`,
        agentId: from,
        context: { to, thread_id, operation: "send" },
      });
      throw err;
    }

    await this.persist();
    logger.info({ from, to, priority, thread_id }, "Message sent");

    this.emit('message:sent', { message_id, thread_id, from, to, priority, requires_response });

    return this.getThread(thread_id)!;
  }

  async reply({
    thread_id,
    from,
    content,
    requires_response = false,
    tags = []
  }: {
    thread_id: string;
    from: string;
    content: string;
    requires_response?: boolean;
    tags?: string[];
  }): Promise<MessageThread> {
    const thread = this.getThread(thread_id);
    if (!thread) throw new Error(`Thread ${thread_id} not found`);
    if (!content || content.trim().length === 0) throw new Error("Message content cannot be empty");
    if (content.length > MAX_MESSAGE_LENGTH) throw new Error(`Message content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`);

    const message_id = uuidv4();
    const now = Date.now();
    const otherParticipants = thread.participants.filter(p => p !== from);
    const otherParticipant = otherParticipants[0];
    if (!otherParticipant) throw new Error("No other participant in thread");

    const vector = await this.generateEmbedding(content);

    this.db.run("BEGIN");
    try {
      this.db.run(
        "INSERT INTO messages (id, thread_id, from_agent, to_agent, content, priority, requires_response, responded, created_at, read, tags, vector) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [message_id, thread_id, from, otherParticipant, content, "P3", requires_response ? 1 : 0, 0, now, 0, JSON.stringify(tags), JSON.stringify(vector)]
      );
      this.db.run(`UPDATE messages SET responded = 1 WHERE thread_id = ? AND from_agent = ? AND requires_response = 1`, [thread_id, otherParticipant]);
      this.db.run("UPDATE threads SET updated_at = ? WHERE id = ?", [now, thread_id]);
      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      ErrorBus.emit({
        type: "message:failed",
        severity: "error",
        component: "messaging",
        error: err instanceof Error ? err : new Error(String(err)),
        message: `Message reply failed: ${err instanceof Error ? err.message : String(err)}`,
        agentId: from,
        context: { thread_id, operation: "reply" },
      });
      throw err;
    }

    await this.persist();
    logger.info({ thread_id, from }, "Reply sent");

    this.emit('message:reply', { thread_id, from, content });

    return this.getThread(thread_id)!;
  }

  getThread(thread_id: string): MessageThread | null {
    const threadRow = this.queryOneRow(`SELECT * FROM threads WHERE id = ?`, [thread_id]);
    if (!threadRow) return null;
    const vals = threadRow.values;

    return {
      id: vals[0],
      participants: safeJsonParse(vals[1], []),
      subject: vals[2],
      status: vals[3],
      tags: safeJsonParse(vals[4], []),
      summary: vals[5],
      created_at: vals[6],
      updated_at: vals[7]
    };
  }

  async getThreadMessages(thread_id: string): Promise<Message[]> {
    const messageRows = this.queryAllArrays(`SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC`, [thread_id]);
    return messageRows?.map((row: any[]) => ({
      id: row[0],
      thread_id: row[1],
      from: row[2],
      to: row[3],
      content: row[4],
      priority: row[5],
      requires_response: row[6] === 1,
      responded: row[7] === 1,
      created_at: row[8],
      read: row[9] === 1,
      tags: safeJsonParse(row[10], [])
    })) || [];
  }

  async getThreadsForAgent(agent_id: string, limit = 20): Promise<MessageThread[]> {
    const threadRows = this.queryAllArrays(`
      SELECT DISTINCT t.* FROM threads t
      JOIN messages m ON t.id = m.thread_id
      WHERE m.from_agent = ? OR m.to_agent = ?
      ORDER BY t.updated_at DESC
      LIMIT ?
    `, [agent_id, agent_id, limit]);
    return threadRows?.map((row: any[]) => this.getThread(row[0] as string)!) || [];
  }

  async getUnreadCount(agent_id: string): Promise<number> {
    const result = this.queryOneRow(`SELECT COUNT(*) FROM messages WHERE to_agent = ? AND read = 0`, [agent_id]);
    return result?.values?.[0] as number || 0;
  }

  async markAsRead(agent_id: string, thread_id?: string): Promise<void> {
    if (thread_id) {
      this.db.run(`UPDATE messages SET read = 1 WHERE to_agent = ? AND thread_id = ?`, [agent_id, thread_id]);
    } else {
      this.db.run(`UPDATE messages SET read = 1 WHERE to_agent = ?`, [agent_id]);
    }
    await this.persist();
  }

  async searchMessages({
    agent_id,
    query,
    top_k = 5,
    from_agent,
    to_agent,
    priority,
    date_from,
    date_to
  }: {
    agent_id: string;
    query: string;
    top_k?: number;
    from_agent?: string;
    to_agent?: string;
    priority?: MessagePriority;
    date_from?: number;
    date_to?: number;
  }): Promise<MessageSearchResult[]> {
    const params: (string | number)[] = [agent_id, agent_id];
    let whereClauses: string[] = [`(from_agent = ? OR to_agent = ?)`];
    if (from_agent) { whereClauses.push(`from_agent = ?`); params.push(from_agent); }
    if (to_agent) { whereClauses.push(`to_agent = ?`); params.push(to_agent); }
    if (priority) { whereClauses.push(`priority = ?`); params.push(priority); }
    if (date_from) { whereClauses.push(`created_at >= ?`); params.push(date_from); }
    if (date_to) { whereClauses.push(`created_at <= ?`); params.push(date_to); }

    const candidateRows = this.queryAllArrays(`SELECT * FROM messages WHERE ${whereClauses.join(" AND ")} ORDER BY created_at DESC LIMIT 100`, params);
    const candidates: Message[] = candidateRows?.map((row: any[]) => ({
      id: row[0], thread_id: row[1], from: row[2], to: row[3], content: row[4],
      priority: row[5], requires_response: row[6] === 1, responded: row[7] === 1,
      created_at: row[8], read: row[9] === 1, tags: safeJsonParse(row[10], []),
      vector: safeJsonParse(row[11], [])
    })) || [];

    // Generate query embedding
    const queryVector = await this.generateEmbedding(query);

    // Score by combined keyword + vector similarity
    const results = candidates.map(msg => {
      const keywordScore = this.computeKeywordRelevance(query, msg.content);
      const vectorScore = msg.vector && msg.vector.length > 0 
        ? this.cosineSimilarity(queryVector, msg.vector) 
        : 0;
      // Weight: 30% keyword, 70% vector
      const combinedScore = (keywordScore * 0.3) + (vectorScore * 0.7);
      return {
        message: msg,
        score: combinedScore
      };
    }).filter(r => r.score > 0.1).sort((a, b) => b.score - a.score).slice(0, top_k);

    return results.map(r => ({
      message: r.message,
      thread: this.getThread(r.message.thread_id)!,
      relevance_score: r.score,
      snippet: this.extractSnippet(r.message.content, query)
    }));
  }

  private computeKeywordRelevance(query: string, content: string): number {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const contentLower = content.toLowerCase();
    return queryWords.filter(w => contentLower.includes(w)).length / queryWords.length;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private extractSnippet(content: string, query: string, length = 100): string {
    const idx = content.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0]);
    const start = Math.max(0, (idx >= 0 ? idx : 0) - 30);
    return (start > 0 ? "..." : "") + content.slice(start, start + length) + "...";
  }

  async escalate({ thread_id, from, to, reason }: { thread_id: string; from: string; to: string; reason: string }): Promise<Escalation> {
    const thread = this.getThread(thread_id);
    if (!thread) throw new Error(`Thread ${thread_id} not found`);
    if (from === to) throw new Error("Cannot escalate to yourself");
    if (!getStaffById(to)) throw new Error(`Target agent ${to} does not exist`);

    // Check existing escalation count (max 3)
    const existingEscalations = this.queryOneRow(`SELECT COUNT(*) FROM escalations WHERE thread_id = ?`, [thread_id]);
    const escalationCount = (existingEscalations?.values?.[0] as number) || 0;
    if (escalationCount >= 3) throw new Error(`Thread ${thread_id} has reached maximum escalation limit (3)`);

    const escalation_id = uuidv4();
    const now = Date.now();
    this.db.run("BEGIN");
    try {
      this.db.run("INSERT INTO escalations (id, thread_id, from_agent, to_agent, reason, created_at, status) VALUES (?,?,?,?,?,?,?)", [escalation_id, thread_id, from, to, reason, now, "pending"]);
      this.db.run("UPDATE threads SET status = 'escalated' WHERE id = ?", [thread_id]);
      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      throw err;
    }
    await this.persist();
    return { id: escalation_id, thread_id, from, to, reason, created_at: now, status: "pending" };
  }

  async getEscalationsForAgent(agent_id: string): Promise<Escalation[]> {
    const rows = this.queryAllArrays(`SELECT * FROM escalations WHERE to_agent = ? ORDER BY created_at DESC`, [agent_id]);
    return rows?.map((row: any[]) => ({ id: row[0], thread_id: row[1], from: row[2], to: row[3], reason: row[4], created_at: row[5], status: row[6] })) || [];
  }

  async resolveEscalation(escalation_id: string, status: "resolved" | "dismissed"): Promise<void> {
    this.db.run("UPDATE escalations SET status = ? WHERE id = ?", [status, escalation_id]);
    await this.persist();
  }

  async getActiveContext(agent_id: string, hours = 24): Promise<{ unread_count: number; active_threads: MessageThread[]; pending_responses: Message[]; recent_escalations: Escalation[] }> {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const unread_count = await this.getUnreadCount(agent_id);
    const active_threads = (await this.getThreadsForAgent(agent_id, 10)).filter(t => t.updated_at > cutoff && t.status === "active");
    
    const pendingRows = this.queryAllArrays(`SELECT * FROM messages WHERE to_agent = ? AND requires_response = 1 AND responded = 0 AND created_at > ?`, [agent_id, cutoff]);
    const pending_responses: Message[] = pendingRows?.map((row: any[]) => ({
      id: row[0], thread_id: row[1], from: row[2], to: row[3], content: row[4], priority: row[5],
      requires_response: true, responded: false, created_at: row[8], read: row[9] === 1, tags: safeJsonParse(row[10], [])
    })) || [];

    return { unread_count, active_threads, pending_responses, recent_escalations: await this.getEscalationsForAgent(agent_id) };
  }

  async getUnreadMessages(agent_id: string, limit = 50): Promise<Message[]> {
    const rows = this.queryAllArrays(`SELECT * FROM messages WHERE to_agent = ? AND read = 0 ORDER BY created_at DESC LIMIT ?`, [agent_id, limit]);
    return rows?.map((row: any[]) => ({
      id: row[0], thread_id: row[1], from: row[2], to: row[3], content: row[4], priority: row[5],
      requires_response: row[6] === 1, responded: row[7] === 1, created_at: row[8], read: row[9] === 1,
      tags: safeJsonParse(row[10], [])
    })) || [];
  }
}

let messagingSystem: MessagingSystem | null = null;
export async function getMessagingSystem(): Promise<MessagingSystem> {
  if (!messagingSystem) messagingSystem = await MessagingSystem.init(process.env.MESSAGES_DB || "messages.db");
  return messagingSystem;
}
