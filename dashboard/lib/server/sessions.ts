import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface SessionRow {
  id: string;
  agentId: string;
  chatId: string;
  sessionId: string | null;
  title: string | null;
  workspacePath: string | null;
  createdAt: Date | null;
  lastUsed: Date | null;
  messageCount: number | null;
  compactionCount: number | null;
  previousSummary: string | null;
  hasRealConversation: boolean | null;
  status: string;
}

export interface MessageRow {
  id: string;
  sessionId: string;
  messageIndex: number;
  role: string;
  content: string;
  tokenEstimate: number | null;
  isSummary: boolean | null;
  compacted: boolean | null;
  timestamp: Date;
}

export interface ToolCallRow {
  id: string;
  sessionId: string;
  toolIndex: number;
  callId: string | null;
  name: string;
  arguments: unknown;
  result: unknown;
  tokenEstimate: number | null;
  compacted: boolean | null;
  timestamp: Date;
}

export interface ToolUsageCount {
  toolName: string;
  count: number;
}

export async function getSessionsList(): Promise<SessionRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        s.id,
        s.agent_id,
        s.chat_id,
        s.session_id,
        s.title,
        s.workspace_path,
        s.created_at,
        s.last_used,
        s.message_count,
        s.compaction_count,
        s.previous_summary,
        s.has_real_conversation,
        CASE
          WHEN s.last_used > NOW() - INTERVAL '5 minutes' THEN 'active'
          WHEN s.last_used > NOW() - INTERVAL '1 hour' THEN 'idle'
          ELSE 'compacted'
        END AS status
      FROM agent_sessions s
      ORDER BY s.last_used DESC NULLS LAST
      LIMIT 500
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      agentId: r.agent_id,
      chatId: r.chat_id,
      sessionId: r.session_id,
      title: r.title,
      workspacePath: r.workspace_path,
      createdAt: r.created_at,
      lastUsed: r.last_used,
      messageCount: r.message_count,
      compactionCount: r.compaction_count,
      previousSummary: r.previous_summary,
      hasRealConversation: r.has_real_conversation,
      status: r.status,
    }));
  } catch {
    return [];
  }
}

export async function getSessionDetail(sessionId: string): Promise<{
  session: SessionRow | null;
  messages: MessageRow[];
  toolCalls: ToolCallRow[];
}> {
  try {
    const sessionResult = await db.execute(sql`
      SELECT
        s.id,
        s.agent_id,
        s.chat_id,
        s.session_id,
        s.title,
        s.workspace_path,
        s.created_at,
        s.last_used,
        s.message_count,
        s.compaction_count,
        s.previous_summary,
        s.has_real_conversation,
        CASE
          WHEN s.last_used > NOW() - INTERVAL '5 minutes' THEN 'active'
          WHEN s.last_used > NOW() - INTERVAL '1 hour' THEN 'idle'
          ELSE 'compacted'
        END AS status
      FROM agent_sessions s
      WHERE s.id = ${sessionId}
    `);

    const session = sessionResult.rows.map((r: any) => ({
      id: r.id,
      agentId: r.agent_id,
      chatId: r.chat_id,
      sessionId: r.session_id,
      title: r.title,
      workspacePath: r.workspace_path,
      createdAt: r.created_at,
      lastUsed: r.last_used,
      messageCount: r.message_count,
      compactionCount: r.compaction_count,
      previousSummary: r.previous_summary,
      hasRealConversation: r.has_real_conversation,
      status: r.status,
    }))[0] ?? null;

    if (!session) {
      return { session: null, messages: [], toolCalls: [] };
    }

    const [messagesResult, toolCallsResult] = await Promise.all([
      db.execute(sql`
        SELECT
          id, session_id, message_index, role, content,
          token_estimate, is_summary, compacted, timestamp
        FROM session_messages
        WHERE session_id = ${sessionId}
        ORDER BY message_index ASC
      `),
      db.execute(sql`
        SELECT
          id, session_id, tool_index, call_id, name,
          arguments, result, token_estimate, compacted, timestamp
        FROM session_tool_calls
        WHERE session_id = ${sessionId}
        ORDER BY tool_index ASC
      `),
    ]);

    const messages: MessageRow[] = messagesResult.rows.map((r: any) => ({
      id: r.id,
      sessionId: r.session_id,
      messageIndex: r.message_index,
      role: r.role,
      content: r.content,
      tokenEstimate: r.token_estimate,
      isSummary: r.is_summary,
      compacted: r.compacted,
      timestamp: r.timestamp,
    }));

    const toolCalls: ToolCallRow[] = toolCallsResult.rows.map((r: any) => ({
      id: r.id,
      sessionId: r.session_id,
      toolIndex: r.tool_index,
      callId: r.call_id,
      name: r.name,
      arguments: r.arguments,
      result: r.result,
      tokenEstimate: r.token_estimate,
      compacted: r.compacted,
      timestamp: r.timestamp,
    }));

    return { session, messages, toolCalls };
  } catch {
    return { session: null, messages: [], toolCalls: [] };
  }
}

export async function getToolUsageBySession(sessionId: string): Promise<ToolUsageCount[]> {
  try {
    const result = await db.execute(sql`
      SELECT name AS tool_name, COUNT(*) AS count
      FROM session_tool_calls
      WHERE session_id = ${sessionId}
      GROUP BY name
      ORDER BY count DESC
    `);
    return result.rows.map((r: any) => ({
      toolName: r.tool_name,
      count: Number(r.count),
    }));
  } catch {
    return [];
  }
}
