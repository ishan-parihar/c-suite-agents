import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function getProjectsList() {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, phase, health, progress, budget_allocated,
        budget_spent, projected_revenue, priority, deadline, team, duration_days, cost_to_date
      FROM projects
      ORDER BY health DESC NULLS LAST
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, status: r.status, phase: r.phase,
      health: r.health, progress: r.progress, budgetAllocated: r.budget_allocated,
      budgetSpent: r.budget_spent, projectedRevenue: r.projected_revenue,
      priority: r.priority, deadline: r.deadline, team: r.team,
      durationDays: r.duration_days, costToDate: r.cost_to_date,
    }));
  } catch { return []; }
}

export async function getProjectDetail(id: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, phase, health, progress, budget_allocated,
        budget_spent, required_budget, projected_revenue, project_summary,
        justification, strategy, kpi, kpi_status, priority, deadline,
        project_start, review_date, team, people, campaigns, progress,
        project_json, project_progress, monitor, duration_days, cost_to_date
      FROM projects WHERE id = ${id} LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id, name: r.name, status: r.status, phase: r.phase,
      health: r.health, progress: r.progress, budgetAllocated: r.budget_allocated,
      budgetSpent: r.budget_spent, requiredBudget: r.required_budget,
      projectedRevenue: r.projected_revenue, summary: r.project_summary,
      justification: r.justification, strategy: r.strategy,
      kpi: r.kpi, kpiStatus: r.kpi_status, priority: r.priority,
      deadline: r.deadline, projectStart: r.project_start,
      reviewDate: r.review_date, team: r.team, people: r.people,
      campaigns: r.campaigns, projectJson: r.project_json,
      projectProgress: r.project_progress, monitor: r.monitor,
      durationDays: r.duration_days, costToDate: r.cost_to_date,
    };
  } catch { return null; }
}

export async function getProjectTasks(projectId: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, priority, action_date, completed_date, sprint_status
      FROM tasks WHERE project_id = ${projectId}
      ORDER BY action_date ASC NULLS LAST
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, status: r.status, priority: r.priority,
      actionDate: r.action_date, completedDate: r.completed_date,
      sprintStatus: r.sprint_status,
    }));
  } catch { return []; }
}

export async function getProjectFinancialLog(projectId: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, signed_amount, category, account, description, created_at
      FROM financial_log
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 50
    `);
    return result.rows.map((r: any) => ({
      id: r.id, signedAmount: r.signed_amount, category: r.category,
      account: r.account, description: r.description, createdAt: r.created_at,
    }));
  } catch { return []; }
}
