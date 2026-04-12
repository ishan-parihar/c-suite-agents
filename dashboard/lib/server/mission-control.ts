import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getDailyBriefingData } from "./daily-briefing";

export interface AgentStatus {
  id: string;
  name: string;
  role: string;
  status: 'healthy' | 'warning' | 'critical' | 'idle';
  lastActive: string | null;
  sessionCount: number;
  pendingMessages: number;
}

const AGENT_CONFIG = [
  { id: 'ceo', name: 'CEO', role: 'Strategic Lead', icon: 'Crown' },
  { id: 'coo', name: 'COO', role: 'Productivity', icon: 'Cog' },
  { id: 'cpo', name: 'CPO', role: 'Psychology', icon: 'Brain' },
  { id: 'cro', name: 'CRO', role: 'Relations', icon: 'Handshake' },
  { id: 'cfo', name: 'CFO', role: 'Finance', icon: 'Wallet' },
  { id: 'cmo', name: 'CMO', role: 'Content', icon: 'Sparkles' },
  { id: 'cio', name: 'CIO', role: 'Intelligence', icon: 'Telescope' },
  { id: 'physician', name: 'Physician', role: 'Health', icon: 'Stethoscope' },
];

export interface MissionControlData {
  briefing: Awaited<ReturnType<typeof getDailyBriefingData>>;
  agents: AgentStatus[];
  recentTasks: Array<Record<string, unknown>>;
  recentProjects: Array<Record<string, unknown>>;
  unreadMessages: number;
  upcomingDeadlines: number;
  weekProgress: number;
}

export async function getMissionControlData(): Promise<MissionControlData> {
  const [
    briefing,
    agents,
    recentTasks,
    recentProjects,
    unreadMessages,
    upcomingDeadlines,
  ] = await Promise.all([
    getDailyBriefingData(),

    db.execute(sql`
      SELECT agent_id, MAX(created_at) as last_active, COUNT(*) as session_count
      FROM ops_reports
      GROUP BY agent_id
    `).then((r) => {
      const agentMap = new Map<string, { lastActive: string | null; sessionCount: number }>();
      r.rows.forEach((row: any) => {
        agentMap.set(row.agent_id, { lastActive: row.last_active, sessionCount: Number(row.session_count) });
      });
      return AGENT_CONFIG.map((cfg) => {
        const data = agentMap.get(cfg.id);
        const lastActive = data?.lastActive ?? null;
        const hoursSince = lastActive ? (Date.now() - new Date(lastActive).getTime()) / 3600000 : 999;
        const status = hoursSince < 2 ? 'healthy' : hoursSince < 6 ? 'warning' : hoursSince < 24 ? 'idle' : 'critical';
        return {
          id: cfg.id,
          name: cfg.name,
          role: cfg.role,
          status: status as AgentStatus['status'],
          lastActive,
          sessionCount: data?.sessionCount ?? 0,
          pendingMessages: 0,
        };
      });
    }),

    db.execute(sql`
      SELECT id, name, status, priority, action_date
      FROM tasks
      WHERE status NOT IN ('Completed', 'Cancelled', 'Archived')
      ORDER BY action_date ASC NULLS LAST
      LIMIT 5
    `).then((r) => r.rows),

    db.execute(sql`
      SELECT id, name, status, health, progress
      FROM projects
      WHERE status NOT IN ('On Hold', 'Completed', 'Archived')
      ORDER BY health DESC NULLS LAST
      LIMIT 4
    `).then((r) => r.rows),

    db.execute(sql`
      SELECT COUNT(*) as count
      FROM messages
      WHERE read = false AND to_agent = 'ceo'
    `).then((r) => Number(r.rows[0]?.count ?? 0)),

    db.execute(sql`
      SELECT COUNT(*) as count
      FROM tasks
      WHERE action_date BETWEEN current_date AND current_date + interval '3 days'
        AND status NOT IN ('Completed', 'Cancelled', 'Archived')
    `).then((r) => Number(r.rows[0]?.count ?? 0)),
  ]);

  const dayOfWeek = new Date().getDay();
  const weekProgress = dayOfWeek === 0 ? 0 : Math.round((dayOfWeek / 7) * 100);

  return {
    briefing,
    agents,
    recentTasks,
    recentProjects,
    unreadMessages,
    upcomingDeadlines,
    weekProgress,
  };
}
