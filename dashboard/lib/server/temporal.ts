import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type YearRow = {
  id: string;
  name: string;
  status: string | null;
  yearRange: string | null;
  yearReport: string | null;
  _count: { quarters: number; annualGoals: number };
};

export type QuarterRow = {
  id: string;
  name: string;
  status: string | null;
  quarterRange: string | null;
  quarterNumber: number | null;
  totalIncome: string | null;
  totalExpenses: string | null;
  netCashflow: string | null;
  yearsId: string | null;
};

export async function getYearsList(): Promise<YearRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, year_range, year_report,
        array_length(quarters, 1) as quarters_count,
        array_length(annual_goals, 1) as annual_goals_count
      FROM years
      ORDER BY year_range DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      yearRange: r.year_range,
      yearReport: r.year_report,
      _count: { quarters: parseInt(r.quarters_count) || 0, annualGoals: parseInt(r.annual_goals_count) || 0 },
    }));
  } catch {
    return [];
  }
}

export async function getYearDetail(id: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, year_range, year_report,
        array_length(quarters, 1) as quarters_count,
        array_length(annual_goals, 1) as annual_goals_count
      FROM years WHERE id = ${id}
      LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      yearRange: r.year_range,
      yearReport: r.year_report,
      _count: { quarters: parseInt(r.quarters_count) || 0, annualGoals: parseInt(r.annual_goals_count) || 0 },
    };
  } catch {
    return null;
  }
}

export async function getYearGoals(yearId: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, goal_progress, strategic_approach, success_condition
      FROM annual_goals WHERE years_id = ${yearId}
      ORDER BY name ASC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      goalProgress: r.goal_progress,
      strategicApproach: r.strategic_approach,
      successCondition: r.success_condition,
    }));
  } catch {
    return [];
  }
}

export async function getYearQuarters(yearId: string): Promise<QuarterRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, quarter_range, quarter_number,
        total_income, total_expenses, net_cashflow, years_id
      FROM quarters WHERE years_id = ${yearId}
      ORDER BY quarter_number ASC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      quarterRange: r.quarter_range,
      quarterNumber: r.quarter_number,
      totalIncome: r.total_income,
      totalExpenses: r.total_expenses,
      netCashflow: r.net_cashflow,
      yearsId: r.years_id,
    }));
  } catch {
    return [];
  }
}

export async function getQuartersList(): Promise<QuarterRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, quarter_range, quarter_number,
        total_income, total_expenses, net_cashflow, years_id
      FROM quarters
      ORDER BY quarter_range DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      quarterRange: r.quarter_range,
      quarterNumber: r.quarter_number,
      totalIncome: r.total_income,
      totalExpenses: r.total_expenses,
      netCashflow: r.net_cashflow,
      yearsId: r.years_id,
    }));
  } catch {
    return [];
  }
}

export async function getQuarterDetail(id: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, quarter_range, quarter_number, quarter_report,
        key_learnings, total_income, total_expenses, net_cashflow,
        category_summary, years_id
      FROM quarters WHERE id = ${id} LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      quarterRange: r.quarter_range,
      quarterNumber: r.quarter_number,
      quarterReport: r.quarter_report,
      keyLearnings: r.key_learnings,
      totalIncome: r.total_income,
      totalExpenses: r.total_expenses,
      netCashflow: r.net_cashflow,
      categorySummary: r.category_summary,
      yearsId: r.years_id,
    };
  } catch { return null; }
}

export type MonthRow = { id: string; name: string; status: string | null; monthRange: string | null; monthNumber: number | null; year: number | null; totalIncome: string | null; totalExpenses: string | null; netCashflow: string | null };
export type WeekRow = { id: string; name: string; status: string | null; weekRange: string | null; weekNumber: number | null; year: number | null; totalIncome: string | null; totalExpenses: string | null; netCashflow: string | null };
export type DayRow = { id: string; name: string; status: string | null; date: string | null; dayName: string | null; year: number | null; dayNumber: number | null; healthScore: number | null };

export async function getMonthsList(): Promise<MonthRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, month_range, month_number, year,
        total_income, total_expenses, net_cashflow
      FROM months
      ORDER BY month_start DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, status: r.status, monthRange: r.month_range,
      monthNumber: r.month_number, year: r.year,
      totalIncome: r.total_income, totalExpenses: r.total_expenses, netCashflow: r.net_cashflow,
    }));
  } catch { return []; }
}

export async function getMonthDetail(id: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, month_range, month_number, year, month_name,
        total_income, total_expenses, net_cashflow, category_summary,
        ending_net_worth, net_worth_change, key_learnings, significant_events,
        cashflow_narrative
      FROM months WHERE id = ${id} LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id, name: r.name, status: r.status, monthRange: r.month_range,
      monthNumber: r.month_number, year: r.year, monthName: r.month_name,
      totalIncome: r.total_income, totalExpenses: r.total_expenses, netCashflow: r.net_cashflow,
      categorySummary: r.category_summary, endingNetWorth: r.ending_net_worth,
      netWorthChange: r.net_worth_change, keyLearnings: r.key_learnings,
      significantEvents: r.significant_events, cashflowNarrative: r.cashflow_narrative,
    };
  } catch { return null; }
}

export async function getWeeksList(): Promise<WeekRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, week_range, week_number, year,
        total_income, total_expenses, net_cashflow
      FROM weeks
      ORDER BY week_start DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, status: r.status, weekRange: r.week_range,
      weekNumber: r.week_number, year: r.year,
      totalIncome: r.total_income, totalExpenses: r.total_expenses, netCashflow: r.net_cashflow,
    }));
  } catch { return []; }
}

export async function getWeekDetail(id: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, week_range, week_number, year, week_name,
        total_income, total_expenses, net_cashflow, category_summary,
        key_learnings, tasks_progress, activity_breakdown
      FROM weeks WHERE id = ${id} LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id, name: r.name, status: r.status, weekRange: r.week_range,
      weekNumber: r.week_number, year: r.year, weekName: r.week_name,
      totalIncome: r.total_income, totalExpenses: r.total_expenses, netCashflow: r.net_cashflow,
      categorySummary: r.category_summary, keyLearnings: r.key_learnings,
      tasksProgress: r.tasks_progress, activityBreakdown: r.activity_breakdown,
    };
  } catch { return null; }
}

export async function getDaysList(): Promise<DayRow[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, date, day_name, year, day_number, health_score
      FROM days
      ORDER BY date DESC
      LIMIT 100
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, status: r.status, date: r.date,
      dayName: r.day_name, year: r.year, dayNumber: r.day_number,
      healthScore: r.health_score,
    }));
  } catch { return []; }
}

export async function getDayDetail(id: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, date, day_name, year, day_number, health_score, day_json
      FROM days WHERE id = ${id} LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id, name: r.name, status: r.status, date: r.date,
      dayName: r.day_name, year: r.year, dayNumber: r.day_number,
      healthScore: r.health_score, dayJson: r.day_json,
    };
  } catch { return null; }
}
