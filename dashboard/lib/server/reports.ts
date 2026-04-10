import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface ReportRow {
  id: string;
  agentId: string;
  period: string | null;
  summary: string | null;
  metrics: unknown;
  actions: unknown;
  createdAt: Date | null;
  metricsKeys: string[];
  actionsCount: number;
}

export interface ReportDetail {
  id: string;
  agentId: string;
  period: string | null;
  summary: string | null;
  metrics: unknown;
  actions: unknown;
  createdAt: Date | null;
}

export interface ToolCorrelationRow {
  id: string;
  tool: string;
  argsHash: string;
  result: string | null;
  createdAt: Date | null;
  frequencyCount: number;
}

export async function getReportsList(): Promise<ReportRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        id,
        agent_id,
        period,
        summary,
        metrics,
        actions,
        created_at
      FROM ops_reports
      ORDER BY created_at DESC
      LIMIT 500
    `);
    return result.rows.map((r: any) => {
      const metrics = r.metrics;
      const actions = r.actions;
      let metricsKeys: string[] = [];
      if (metrics && typeof metrics === "object" && !Array.isArray(metrics)) {
        metricsKeys = Object.keys(metrics);
      } else if (Array.isArray(metrics)) {
        metricsKeys = metrics.map((m: any) => {
          if (typeof m === "object" && m !== null && m.key) return m.key;
          if (typeof m === "string") return m;
          return String(m);
        });
      }
      let actionsCount = 0;
      if (Array.isArray(actions)) {
        actionsCount = actions.length;
      }
      return {
        id: r.id,
        agentId: r.agent_id,
        period: r.period,
        summary: r.summary,
        metrics: r.metrics,
        actions: r.actions,
        createdAt: r.created_at,
        metricsKeys,
        actionsCount,
      };
    });
  } catch {
    return [];
  }
}

export async function getReportDetail(reportId: string): Promise<ReportDetail | null> {
  try {
    const result = await db.execute(sql`
      SELECT
        id,
        agent_id,
        period,
        summary,
        metrics,
        actions,
        created_at
      FROM ops_reports
      WHERE id = ${reportId}
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id,
      agentId: r.agent_id,
      period: r.period,
      summary: r.summary,
      metrics: r.metrics,
      actions: r.actions,
      createdAt: r.created_at,
    };
  } catch {
    return null;
  }
}

export async function getToolCorrelations(): Promise<ToolCorrelationRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        id,
        tool,
        args_hash,
        result,
        created_at,
        COUNT(*) OVER (PARTITION BY tool, args_hash) AS frequency_count
      FROM tool_correlations
      ORDER BY frequency_count DESC, created_at DESC
      LIMIT 500
    `);
    const seen = new Set<string>();
    return result.rows
      .map((r: any) => ({
        id: r.id,
        tool: r.tool,
        argsHash: r.args_hash,
        result: r.result,
        createdAt: r.created_at,
        frequencyCount: Number(r.frequency_count),
      }))
      .filter((row) => {
        const key = `${row.tool}-${row.argsHash}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } catch {
    return [];
  }
}
