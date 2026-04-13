import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

interface ApiSession {
  id: string;
  agentId: string;
  status: 'running' | 'idle' | 'waiting' | 'error';
  startedAt: string;
  lastActivity: string;
  toolCalls: number;
  tokensUsed: number;
  model: string;
  contextLength: number;
}

function getDataDir(): string {
  if (process.env.OPERANT_DATA_DIR) {
    return process.env.OPERANT_DATA_DIR;
  }
  return path.join(process.env.HOME || '/var/lib/operant', '.operant', 'data');
}

function inferStatus(lastUsed: number, messageCount: number, compactionCount: number): ApiSession['status'] {
  const idleThresholdMs = 10 * 60 * 1000;
  const waitingThresholdMs = 2 * 60 * 1000;
  const age = Date.now() - lastUsed;

  if (age > idleThresholdMs) return 'idle';
  if (age > waitingThresholdMs) return 'waiting';
  return 'running';
}

export async function GET() {
  try {
    const dataDir = getDataDir();
    const dbPath = path.join(dataDir, 'sessions.db');

    if (!fs.existsSync(dbPath)) {
      return NextResponse.json([]);
    }

    const db = new Database(dbPath, { readonly: true });

    const sessions = db.prepare(`
      SELECT
        s.session_id,
        s.agent_id,
        s.title,
        s.created_at,
        s.last_used,
        s.message_count,
        s.compaction_count,
        COALESCE(SUM(tc.token_estimate), 0) as tool_token_estimate,
        COUNT(tc.tool_index) as tool_call_count
      FROM sessions s
      LEFT JOIN session_tool_calls tc ON tc.session_id = s.session_id
      GROUP BY s.session_id
      ORDER BY s.last_used DESC
    `).all() as Array<{
      session_id: string;
      agent_id: string;
      title: string;
      created_at: number;
      last_used: number;
      message_count: number;
      compaction_count: number;
      tool_token_estimate: number;
      tool_call_count: number;
    }>;

    db.close();

    let model = 'unknown';
    let contextLength = 0;
    try {
      const configPath = path.join(process.env.HOME || '/root', '.operant', 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        model = config.llm?.model || config.models?.primary || 'unknown';
        contextLength = config.llm?.contextTokens || 0;
      }
    } catch {
    }

    const result: ApiSession[] = sessions.map((s) => ({
      id: s.session_id,
      agentId: s.agent_id,
      status: inferStatus(s.last_used, s.message_count, s.compaction_count),
      startedAt: new Date(s.created_at).toISOString(),
      lastActivity: new Date(s.last_used).toISOString(),
      toolCalls: s.tool_call_count,
      tokensUsed: s.tool_token_estimate,
      model,
      contextLength,
    }));

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Failed to read sessions', details: message },
      { status: 500 }
    );
  }
}
