// Organic Messaging System — Persistent with Vector Embeddings

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { getStaffById, getBoardMembers } from "../staff/core-staff.js";
import initSqlJs from "sql.js";
import { promises as fs } from "node:fs";
import { Ollama } from "ollama";
import { cfg } from "../config.js";
import { validateAgentIdentity } from "../auth/session.js";
import { EventEmitter } from "node:events";

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

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

export class MessagingSystem extends EventEmitter {
  private db: any;
  private ollama: Ollama;
  private embedModel: string;
  private dbPath: string;

  private constructor(dbPath: string) {
    super();
    this.dbPath = dbPath;
    this.ollama = new Ollama({ host: process.env.OLLAMA_HOST || "http://localhost:11434" });
    this.embedModel = cfg.ollamaEmbedModel;
    this.db = null;
  }

  static async init(dbPath: string = "messages.db"): Promise<MessagingSystem> {
    const instance = new MessagingSystem(dbPath);
    await instance.initializeDB();
    return instance;
  }

  private async initializeDB() {
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

    await this.persist();
    logger.info({ dbPath: this.dbPath }, "Messaging database initialized");
  }

  private async persist() {
    if (!this.db) return;
    const data = this.db.export();
    await fs.writeFile(this.dbPath, Buffer.from(data));
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.ollama.embeddings({
        model: this.embedModel,
        prompt: text
      });
      return result.embedding || [];
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
    const thread_id = uuidv4();
    const message_id = uuidv4();
    const now = Date.now();

    this.db.run(
      "INSERT INTO threads (id, participants, subject, status, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [thread_id, JSON.stringify([from, to]), subject || content.slice(0, 50), "active", JSON.stringify(tags), now, now]
    );

    // Generate embedding for message
    const vector = await this.generateEmbedding(content);
    
    this.db.run(
      "INSERT INTO messages (id, thread_id, from_agent, to_agent, content, priority, requires_response, responded, created_at, read, tags, vector) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [message_id, thread_id, from, to, content, priority, requires_response ? 1 : 0, 0, now, 0, JSON.stringify(tags), JSON.stringify(vector)]
    );

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

    const message_id = uuidv4();
    const now = Date.now();
    const otherParticipant = thread.participants.find(p => p !== from);
    if (!otherParticipant) throw new Error("No other participant in thread");

    // Generate embedding for reply
    const vector = await this.generateEmbedding(content);

    this.db.run(
      "INSERT INTO messages (id, thread_id, from_agent, to_agent, content, priority, requires_response, responded, created_at, read, tags, vector) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [message_id, thread_id, from, otherParticipant, content, "P3", requires_response ? 1 : 0, 0, now, 0, JSON.stringify(tags), JSON.stringify(vector)]
    );

    this.db.run(`UPDATE messages SET responded = 1 WHERE thread_id = ? AND from_agent = ? AND requires_response = 1`, [thread_id, otherParticipant]);
    this.db.run("UPDATE threads SET updated_at = ? WHERE id = ?", [now, thread_id]);

    await this.persist();
    logger.info({ thread_id, from }, "Reply sent");

    this.emit('message:reply', { thread_id, from, content });

    return this.getThread(thread_id)!;
  }

  getThread(thread_id: string): MessageThread | null {
    const safeThreadId = escapeSql(thread_id);
    const threadRow = this.db.exec(`SELECT * FROM threads WHERE id = '${safeThreadId}'`)[0]?.values?.[0];
    if (!threadRow) return null;

    return {
      id: threadRow[0],
      participants: JSON.parse(threadRow[1]),
      subject: threadRow[2],
      status: threadRow[3],
      tags: JSON.parse(threadRow[4] || "[]"),
      summary: threadRow[5],
      created_at: threadRow[6],
      updated_at: threadRow[7]
    };
  }

  async getThreadMessages(thread_id: string): Promise<Message[]> {
    const safeThreadId = escapeSql(thread_id);
    const messageRows = this.db.exec(`SELECT * FROM messages WHERE thread_id = '${safeThreadId}' ORDER BY created_at ASC`);
    return messageRows[0]?.values.map((row: any[]) => ({
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
      tags: JSON.parse(row[10] || "[]")
    })) || [];
  }

  async getThreadsForAgent(agent_id: string, limit = 20): Promise<MessageThread[]> {
    const safeAgentId = escapeSql(agent_id);
    const threadRows = this.db.exec(`
      SELECT DISTINCT t.* FROM threads t
      JOIN messages m ON t.id = m.thread_id
      WHERE m.from_agent = '${safeAgentId}' OR m.to_agent = '${safeAgentId}'
      ORDER BY t.updated_at DESC
      LIMIT ${limit}
    `);
    return threadRows[0]?.values.map((row: any[]) => this.getThread(row[0])!) || [];
  }

  async getUnreadCount(agent_id: string): Promise<number> {
    const safeAgentId = escapeSql(agent_id);
    const result = this.db.exec(`SELECT COUNT(*) FROM messages WHERE to_agent = '${safeAgentId}' AND read = 0`);
    return result[0]?.values?.[0]?.[0] as number || 0;
  }

  async markAsRead(agent_id: string, thread_id?: string): Promise<void> {
    const safeAgentId = escapeSql(agent_id);
    if (thread_id) {
      const safeThreadId = escapeSql(thread_id);
      this.db.run(`UPDATE messages SET read = 1 WHERE to_agent = '${safeAgentId}' AND thread_id = '${safeThreadId}'`);
    } else {
      this.db.run(`UPDATE messages SET read = 1 WHERE to_agent = '${safeAgentId}'`);
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
    const safeAgentId = escapeSql(agent_id);
    let whereClauses: string[] = [`(from_agent = '${safeAgentId}' OR to_agent = '${safeAgentId}')`];
    if (from_agent) whereClauses.push(`from_agent = '${escapeSql(from_agent)}'`);
    if (to_agent) whereClauses.push(`to_agent = '${escapeSql(to_agent)}'`);
    if (priority) whereClauses.push(`priority = '${escapeSql(priority)}'`);
    if (date_from) whereClauses.push(`created_at >= ${date_from}`);
    if (date_to) whereClauses.push(`created_at <= ${date_to}`);

    const candidateRows = this.db.exec(`SELECT * FROM messages WHERE ${whereClauses.join(" AND ")} ORDER BY created_at DESC LIMIT 100`);
    const candidates: Message[] = candidateRows[0]?.values.map((row: any[]) => ({
      id: row[0], thread_id: row[1], from: row[2], to: row[3], content: row[4],
      priority: row[5], requires_response: row[6] === 1, responded: row[7] === 1,
      created_at: row[8], read: row[9] === 1, tags: JSON.parse(row[10] || "[]"),
      vector: row[11] ? JSON.parse(row[11]) : []
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
    const escalation_id = uuidv4();
    const now = Date.now();
    this.db.run("INSERT INTO escalations (id, thread_id, from_agent, to_agent, reason, created_at, status) VALUES (?,?,?,?,?,?,?)", [escalation_id, thread_id, from, to, reason, now, "pending"]);
    this.db.run("UPDATE threads SET status = 'escalated' WHERE id = ?", [thread_id]);
    await this.persist();
    return { id: escalation_id, thread_id, from, to, reason, created_at: now, status: "pending" };
  }

  async getEscalationsForAgent(agent_id: string): Promise<Escalation[]> {
    const safeAgentId = escapeSql(agent_id);
    const rows = this.db.exec(`SELECT * FROM escalations WHERE to_agent = '${safeAgentId}' ORDER BY created_at DESC`);
    return rows[0]?.values.map((row: any[]) => ({ id: row[0], thread_id: row[1], from: row[2], to: row[3], reason: row[4], created_at: row[5], status: row[6] })) || [];
  }

  async resolveEscalation(escalation_id: string, status: "resolved" | "dismissed"): Promise<void> {
    this.db.run("UPDATE escalations SET status = ? WHERE id = ?", [status, escalation_id]);
    await this.persist();
  }

  async getActiveContext(agent_id: string, hours = 24): Promise<{ unread_count: number; active_threads: MessageThread[]; pending_responses: Message[]; recent_escalations: Escalation[] }> {
    const safeAgentId = escapeSql(agent_id);
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const unread_count = await this.getUnreadCount(agent_id);
    const active_threads = (await this.getThreadsForAgent(agent_id, 10)).filter(t => t.updated_at > cutoff && t.status === "active");
    
    const pendingRows = this.db.exec(`SELECT * FROM messages WHERE to_agent = '${safeAgentId}' AND requires_response = 1 AND responded = 0 AND created_at > ${cutoff}`);
    const pending_responses: Message[] = pendingRows[0]?.values.map((row: any[]) => ({
      id: row[0], thread_id: row[1], from: row[2], to: row[3], content: row[4], priority: row[5],
      requires_response: true, responded: false, created_at: row[8], read: row[9] === 1, tags: JSON.parse(row[10] || "[]")
    })) || [];

    return { unread_count, active_threads, pending_responses, recent_escalations: await this.getEscalationsForAgent(agent_id) };
  }
}

let messagingSystem: MessagingSystem | null = null;
export async function getMessagingSystem(): Promise<MessagingSystem> {
  if (!messagingSystem) messagingSystem = await MessagingSystem.init(process.env.MESSAGES_DB || "messages.db");
  return messagingSystem;
}
