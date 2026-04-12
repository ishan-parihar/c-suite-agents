import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const AGENT_REGISTRY: Record<string, {
  name: string;
  role: string;
  description: string;
  domain: string;
  relevantTables: { slug: string; label: string }[];
  relevantEntities: string[];
}> = {
  ceo: {
    name: "CEO",
    role: "Strategic Lead",
    description: "Oversees the C-suite, coordinates cross-agent decisions, holds strategic context.",
    domain: "Strategic Operations",
    relevantTables: [
      { slug: "goals-annual", label: "Annual Goals" },
      { slug: "goals-quarterly", label: "Quarterly Goals" },
      { slug: "projects", label: "Projects" },
      { slug: "meetings", label: "Board Meetings" },
      { slug: "ops-reports", label: "Reports" },
    ],
    relevantEntities: ["goals-annual", "goals-quarterly", "projects", "campaigns"],
  },
  coo: {
    name: "COO",
    role: "Productivity",
    description: "Manages tasks, schedules, operations, and execution across all domains.",
    domain: "Operations & Productivity",
    relevantTables: [
      { slug: "tasks", label: "Tasks" },
      { slug: "kanban-cards", label: "Kanban" },
      { slug: "kanban-boards", label: "Boards" },
      { slug: "messages", label: "Messages" },
    ],
    relevantEntities: ["tasks", "kanban-cards", "kanban-boards", "kanban-columns"],
  },
  cpo: {
    name: "CPO",
    role: "Psychology",
    description: "Analyzes journal entries, detects mental patterns, provides psychological insights.",
    domain: "Journaling & Psychology",
    relevantTables: [
      { slug: "journal-subjective", label: "Subjective" },
      { slug: "journal-relational", label: "Relational" },
      { slug: "journal-systemic", label: "Systemic" },
    ],
    relevantEntities: ["journal-subjective", "journal-relational", "journal-systemic"],
  },
  cro: {
    name: "CRO",
    role: "Relations",
    description: "Tracks relationships, manages reconnects, monitors social health.",
    domain: "Relationships & Network",
    relevantTables: [
      { slug: "people", label: "People" },
      { slug: "journal-relational", label: "Relational Journal" },
      { slug: "messages", label: "Messages" },
    ],
    relevantEntities: ["people", "journal-relational", "message-threads"],
  },
  cfo: {
    name: "CFO",
    role: "Finance",
    description: "Manages budgets, tracks financial health, forecasts revenue and spending.",
    domain: "Financial Operations",
    relevantTables: [
      { slug: "financial-log", label: "Financial Log" },
      { slug: "financial-accounts", label: "Accounts" },
      { slug: "projects", label: "Project Budgets" },
    ],
    relevantEntities: ["financial-log", "financial-accounts"],
  },
  cmo: {
    name: "CMO",
    role: "Content",
    description: "Manages content pipeline, campaigns, publishing schedules, and platform strategy.",
    domain: "Content & Marketing",
    relevantTables: [
      { slug: "content-pipeline", label: "Content Pipeline" },
      { slug: "campaigns", label: "Campaigns" },
    ],
    relevantEntities: ["content-pipeline", "campaigns"],
  },
  cio: {
    name: "CIO",
    role: "Intelligence",
    description: "Detects signals, researches trends, synthesizes intelligence reports.",
    domain: "Intelligence & Research",
    relevantTables: [
      { slug: "notes", label: "Notes" },
      { slug: "journal-systemic", label: "Systemic Journal" },
      { slug: "ops-reports", label: "Reports" },
    ],
    relevantEntities: ["notes", "journal-systemic", "ops-reports"],
  },
  physician: {
    name: "Physician",
    role: "Health Advisory",
    description: "Tracks health metrics, monitors diet/exercise, provides wellness insights.",
    domain: "Health & Wellness",
    relevantTables: [
      { slug: "journal-diet", label: "Diet Log" },
      { slug: "journal-subjective", label: "Subjective Journal" },
    ],
    relevantEntities: ["journal-diet", "journal-subjective"],
  },
};

export interface AgentWorkspaceData {
  config: typeof AGENT_REGISTRY[string] | null;
  status: {
    lastActive: string | null;
    sessionCount: number;
    reportCount: number;
    pendingMessages: number;
    kanbanCards: number;
  };
  recentSessions: Array<Record<string, unknown>>;
  recentReports: Array<Record<string, unknown>>;
  recentMessages: Array<Record<string, unknown>>;
}

export async function getAgentWorkspaceData(agentId: string): Promise<AgentWorkspaceData> {
  const config = AGENT_REGISTRY[agentId] ?? null;

  const [statusData, recentSessions, recentReports, recentMessages] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT MAX(created_at) FROM ops_reports WHERE agent_id = ${agentId}) as last_active,
        (SELECT COUNT(*) FROM ops_reports WHERE agent_id = ${agentId})::int as report_count,
        (SELECT COUNT(*) FROM agent_sessions WHERE agent_id = ${agentId})::int as session_count,
        (SELECT COUNT(*) FROM messages WHERE to_agent = ${agentId} AND read = false)::int as pending_messages,
        (SELECT COUNT(*) FROM kanban_cards WHERE assignee_agent_id = ${agentId} AND column_id NOT IN (SELECT id FROM kanban_columns WHERE name ILIKE '%done%'))::int as active_cards
    `).then((r) => {
      const row = r.rows[0] as Record<string, unknown> | undefined;
      return {
        lastActive: (row?.last_active as string) ?? null,
        sessionCount: Number(row?.session_count ?? 0),
        reportCount: Number(row?.report_count ?? 0),
        pendingMessages: Number(row?.pending_messages ?? 0),
        kanbanCards: Number(row?.active_cards ?? 0),
      };
    }),

    db.execute(sql`
      SELECT id, title, last_used, message_count,
        CASE
          WHEN last_used > NOW() - INTERVAL '5 minutes' THEN 'active'
          WHEN last_used > NOW() - INTERVAL '1 hour' THEN 'idle'
          ELSE 'compacted'
        END AS status
      FROM agent_sessions
      WHERE agent_id = ${agentId}
      ORDER BY last_used DESC NULLS LAST
      LIMIT 5
    `).then((r) => r.rows),

    db.execute(sql`
      SELECT id, period, summary, created_at
      FROM ops_reports
      WHERE agent_id = ${agentId}
      ORDER BY created_at DESC
      LIMIT 3
    `).then((r) => r.rows),

    db.execute(sql`
      SELECT id, subject, status, created_at
      FROM message_threads
      WHERE status = 'open'
        AND id IN (
          SELECT DISTINCT thread_id FROM messages WHERE to_agent = ${agentId} AND read = false
        )
      ORDER BY created_at DESC
      LIMIT 5
    `).then((r) => r.rows),
  ]);

  return {
    config,
    status: statusData,
    recentSessions,
    recentReports,
    recentMessages,
  };
}
