// Reports & Sessions - Storage-only utilities for ACP
// No analysis, no LLM - pure persistence

import { v4 as uuidv4 } from "uuid";
import initSqlJs from "sql.js";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { logger } from "../logger.js";

function safeJsonParse<T>(raw: string | undefined | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

type DBAny = any;

export interface Report {
  id: string;
  agent_id: string;
  period: string;
  summary: string;
  metrics?: Record<string, any>;
  actions?: Array<{ description: string; assignee?: string; due?: string }>;
  created_at: number;
}

export interface SessionStep {
  id: string;
  session_id: string;
  step_num: number;
  step_type: "thought" | "tool_call" | "observation" | "final";
  tool?: string;
  args_hash?: string;
  obs_summary?: string;
  ts: number;
}

export interface Session {
  id: string;
  agent_id: string;
  chat_id: string;
  started_at: number;
  last_active: number;
  status: "active" | "paused" | "closed";
}

export class ReportsAndSessions {
  private constructor(private db: DBAny, private path: string) {}

  static async init(path: string = "reports_sessions.db"): Promise<ReportsAndSessions> {
    const resolved = resolve(path);
    if (!resolved.endsWith(".db") && !resolved.endsWith(".sqlite")) {
      throw new Error(`Invalid database path: ${path}`);
    }
    const SQL = await initSqlJs({ locateFile: (f: string) => `node_modules/sql.js/dist/${f}` });
    let db: DBAny;
    try {
      const buf = await fs.readFile(resolved);
      db = new SQL.Database(new Uint8Array(buf));
    } catch {
      db = new SQL.Database();
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        period TEXT,
        summary TEXT,
        metrics TEXT,
        actions TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        chat_id TEXT,
        started_at INTEGER,
        last_active INTEGER,
        status TEXT
      );
      CREATE TABLE IF NOT EXISTS session_steps (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        step_num INTEGER,
        step_type TEXT,
        tool TEXT,
        args_hash TEXT,
        obs_summary TEXT,
        ts INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS tool_correlations (
        id TEXT PRIMARY KEY,
        tool TEXT,
        args_hash TEXT,
        result TEXT,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_reports_agent ON reports(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_chat ON sessions(chat_id, last_active DESC);
      CREATE INDEX IF NOT EXISTS idx_steps_session ON session_steps(session_id, step_num);
      -- OpenCode session mapping for persistence across restarts
      CREATE TABLE IF NOT EXISTS oc_sessions (
        id TEXT PRIMARY KEY,
        chat_id TEXT,
        agent_id TEXT,
        oc_session_id TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_oc_session_unique ON oc_sessions(chat_id, agent_id);
    `);

    const rs = new ReportsAndSessions(db, path);
    await rs.persist();
    return rs;
  }

  private async persist() {
    if (!this.db) return;
    const data = this.db.export();
    const tmpPath = `${this.path}.tmp`;
    await fs.writeFile(tmpPath, Buffer.from(data));
    await fs.rename(tmpPath, this.path);
  }

  private queryAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const results: Record<string, unknown>[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as Record<string, unknown>);
    stmt.free();
    return results;
  }

  async close(): Promise<void> {
    await this.persist();
  }

  // Reports
  async saveReport(report: Omit<Report, "id" | "created_at">): Promise<Report> {
    const id = uuidv4();
    const created_at = Date.now();
    this.db.run(
      "INSERT INTO reports (id, agent_id, period, summary, metrics, actions, created_at) VALUES (?,?,?,?,?,?,?)",
      [id, report.agent_id, report.period, report.summary, JSON.stringify(report.metrics || {}), JSON.stringify(report.actions || []), created_at]
    );
    await this.persist();
    logger.info({ id, agent_id: report.agent_id, period: report.period }, "Report saved");
    return { ...report, id, created_at };
  }

  async getLatestReports(agent_id: string, limit = 5): Promise<Report[]> {
    const rows = this.queryAll("SELECT * FROM reports WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?", [agent_id, limit]);
    return rows.map((row: any) => ({
      id: row.id, agent_id: row.agent_id, period: row.period, summary: row.summary,
      metrics: safeJsonParse(row.metrics, {}), actions: safeJsonParse(row.actions, []), created_at: row.created_at
    })) || [];
  }

  // Sessions
  async createSession(agent_id: string, chat_id: string): Promise<Session> {
    const id = uuidv4();
    const now = Date.now();
    this.db.run(
      "INSERT INTO sessions (id, agent_id, chat_id, started_at, last_active, status) VALUES (?,?,?,?,?,?)",
      [id, agent_id, chat_id, now, now, "active"]
    );
    await this.persist();
    return { id, agent_id, chat_id, started_at: now, last_active: now, status: "active" };
  }

  async getSession(session_id: string): Promise<Session | null> {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get([session_id]);
    if (!row) return null;
    return { id: row.id, agent_id: row.agent_id, chat_id: row.chat_id, started_at: row.started_at, last_active: row.last_active, status: row.status };
  }

  async getActiveSession(agent_id: string, chat_id: string): Promise<Session | null> {
    const row = this.db.prepare("SELECT * FROM sessions WHERE agent_id = ? AND chat_id = ? AND status = 'active' ORDER BY last_active DESC LIMIT 1").get([agent_id, chat_id]);
    if (!row) return null;
    return { id: row.id, agent_id: row.agent_id, chat_id: row.chat_id, started_at: row.started_at, last_active: row.last_active, status: row.status };
  }

  async updateSessionLastActive(session_id: string): Promise<void> {
    this.db.run("UPDATE sessions SET last_active = ? WHERE id = ?", [Date.now(), session_id]);
    await this.persist();
  }

  async closeSession(session_id: string): Promise<void> {
    this.db.run("UPDATE sessions SET status = 'closed', last_active = ? WHERE id = ?", [Date.now(), session_id]);
    await this.persist();
  }

  // Session Steps
  async logStep(step: Omit<SessionStep, "id" | "ts">): Promise<SessionStep> {
    const id = uuidv4();
    const ts = Date.now();
    this.db.run(
      "INSERT INTO session_steps (id, session_id, step_num, step_type, tool, args_hash, obs_summary, ts) VALUES (?,?,?,?,?,?,?,?)",
      [id, step.session_id, step.step_num, step.step_type, step.tool || null, step.args_hash || null, step.obs_summary || null, ts]
    );
    await this.persist();
    return { ...step, id, ts };
  }

  async getSessionSteps(session_id: string, limit = 10): Promise<SessionStep[]> {
    const rows = this.queryAll("SELECT * FROM session_steps WHERE session_id = ? ORDER BY step_num DESC LIMIT ?", [session_id, limit]);
    return rows.map((row: any) => ({
      id: row.id, session_id: row.session_id, step_num: row.step_num, step_type: row.step_type,
      tool: row.tool, args_hash: row.args_hash, obs_summary: row.obs_summary, ts: row.ts
    })) || [];
  }

  // Tool Correlations (idempotency)
  async registerToolCall(id: string, tool: string, args_hash: string, result: string): Promise<void> {
    this.db.run(
      "INSERT OR REPLACE INTO tool_correlations (id, tool, args_hash, result, created_at) VALUES (?,?,?,?,?)",
      [id, tool, args_hash, result, Date.now()]
    );
    await this.persist();
  }

  async getToolResult(id: string): Promise<string | null> {
    const row = this.db.prepare("SELECT result FROM tool_correlations WHERE id = ?").get([id]);
    return row ? row.result : null;
  }

  // OpenCode session persistence
  async getOcSession(chat_id: string, agent_id: string): Promise<string | null> {
    const row = this.db.prepare("SELECT oc_session_id FROM oc_sessions WHERE chat_id = ? AND agent_id = ?").get([chat_id, agent_id]);
    return row ? row.oc_session_id : null;
  }
  async upsertOcSession(chat_id: string, agent_id: string, oc_session_id: string): Promise<void> {
    const id = `${chat_id}:${agent_id}`;
    const now = Date.now();
    this.db.run("INSERT OR REPLACE INTO oc_sessions (id, chat_id, agent_id, oc_session_id, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [id, chat_id, agent_id, oc_session_id, now, now]);
    await this.persist();
  }
}

let reportsAndSessions: ReportsAndSessions | null = null;

export async function getReportsAndSessions(): Promise<ReportsAndSessions> {
  if (!reportsAndSessions) {
    reportsAndSessions = await ReportsAndSessions.init(process.env.REPORTS_DB || "reports_sessions.db");
  }
  return reportsAndSessions;
}
