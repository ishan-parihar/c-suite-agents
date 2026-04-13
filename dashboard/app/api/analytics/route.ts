import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { tasks } from '@/drizzle/schema/lifeos/tasks';
import { projects } from '@/drizzle/schema/lifeos/projects';
import { campaigns } from '@/drizzle/schema/lifeos/campaigns';
import { messages } from '@/drizzle/schema/operations/messaging';
import { notesManagement } from '@/drizzle/schema/lifeos/notes_management';

const AGENT_COLORS: Record<string, string> = {
  ceo: '#3b82f6',
  coo: '#10b981',
  cmo: '#f59e0b',
  cfo: '#8b5cf6',
  cio: '#ef4444',
  cro: '#ec4899',
  cpo: '#06b6d4',
  physician: '#84cc16',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Cost per 1K tokens (approximate blended rate)
const COST_PER_1K_TOKENS = 0.004;

export async function GET() {
  try {
    const [dailyUsage, agentCosts, summary] = await Promise.all([
      fetchDailyUsage(),
      fetchAgentCosts(),
      fetchSummary(),
    ]);

    return NextResponse.json({ dailyUsage, agentCosts, summary });
  } catch (error) {
    console.error('Analytics API error:', error);
    // Return empty data instead of crashing
    return NextResponse.json({
      dailyUsage: [],
      agentCosts: [],
      summary: {
        totalTasks: 0,
        activeProjects: 0,
        activeCampaigns: 0,
        messages: 0,
        notes: 0,
      },
    });
  }
}

async function fetchDailyUsage() {
  try {
    // Get daily token usage and call counts from session_messages + agent_sessions
    // Last 7 days
    const dailyTokens = await db.execute(sql`
      SELECT
        DATE_TRUNC('day', sm.timestamp) AS day,
        COALESCE(SUM(sm.token_estimate), 0) AS tokens,
        COUNT(*) AS calls
      FROM session_messages sm
      WHERE sm.timestamp >= NOW() - INTERVAL '7 days'
        AND sm.compacted = false
      GROUP BY day
      ORDER BY day ASC
    `);

    // Build 7-day array with day labels
    const result: Array<{ day: string; tokens: number; calls: number; cost: number }> = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayLabel = DAY_LABELS[date.getDay()];

      const row = dailyTokens.rows.find(
        (r: any) => new Date(r.day).toISOString().split('T')[0] === dateStr
      );

      const tokens = row ? Number(row.tokens) : 0;
      const calls = row ? Number(row.calls) : 0;
      const cost = Math.round((tokens / 1000) * COST_PER_1K_TOKENS * 100) / 100;

      result.push({ day: dayLabel, tokens, calls, cost });
    }

    return result;
  } catch {
    // Return empty week if query fails
    const now = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now);
      date.setDate(date.getDate() - (6 - i));
      return { day: DAY_LABELS[date.getDay()], tokens: 0, calls: 0, cost: 0 };
    });
  }
}

async function fetchAgentCosts() {
  try {
    // Get token usage per agent for the last 7 days
    const agentTokens = await db.execute(sql`
      SELECT
        LOWER(asess.agent_id) AS agent,
        COALESCE(SUM(sm.token_estimate), 0) AS total_tokens
      FROM agent_sessions asess
      LEFT JOIN session_messages sm ON sm.session_id = asess.id
        AND sm.timestamp >= NOW() - INTERVAL '7 days'
        AND sm.compacted = false
      GROUP BY asess.agent_id
      HAVING COALESCE(SUM(sm.token_estimate), 0) > 0
      ORDER BY total_tokens DESC
    `);

    if (agentTokens.rows.length === 0) {
      return fallbackAgentCosts();
    }

    const grandTotal = agentTokens.rows.reduce(
      (sum: number, r: any) => sum + Number(r.total_tokens),
      0
    );

    return agentTokens.rows.map((r: any) => {
      const agentName = String(r.agent).replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      const tokens = Number(r.total_tokens);
      const pct = grandTotal > 0 ? Math.round((tokens / grandTotal) * 100) : 0;
      const color = AGENT_COLORS[String(r.agent)] || '#6b7280';

      return { name: agentName, value: pct, color, tokens };
    });
  } catch {
    return fallbackAgentCosts();
  }
}

function fallbackAgentCosts() {
  return [
    { name: 'CEO', value: 35, color: '#3b82f6' },
    { name: 'COO', value: 25, color: '#10b981' },
    { name: 'CMO', value: 18, color: '#f59e0b' },
    { name: 'CFO', value: 12, color: '#8b5cf6' },
    { name: 'Other', value: 10, color: '#6b7280' },
  ];
}

async function fetchSummary() {
  try {
    const [
      totalTasksResult,
      activeProjectsResult,
      activeCampaignsResult,
      messagesResult,
      notesResult,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(tasks),
      db
        .select({ count: sql<number>`count(*)` })
        .from(projects)
        .where(sql`${projects.status} NOT IN ('On Hold', 'Archived', 'Completed')`),
      db
        .select({ count: sql<number>`count(*)` })
        .from(campaigns)
        .where(sql`${campaigns.status} NOT IN ('Archived', 'Completed')`),
      db.select({ count: sql<number>`count(*)` }).from(messages),
      db.select({ count: sql<number>`count(*)` }).from(notesManagement),
    ]);

    return {
      totalTasks: Number(totalTasksResult[0]?.count ?? 0),
      activeProjects: Number(activeProjectsResult[0]?.count ?? 0),
      activeCampaigns: Number(activeCampaignsResult[0]?.count ?? 0),
      messages: Number(messagesResult[0]?.count ?? 0),
      notes: Number(notesResult[0]?.count ?? 0),
    };
  } catch {
    return {
      totalTasks: 0,
      activeProjects: 0,
      activeCampaigns: 0,
      messages: 0,
      notes: 0,
    };
  }
}
