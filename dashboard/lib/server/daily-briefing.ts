import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export interface DailyBriefingData {
  activeProjects: number;
  dueTasks: number;
  healthScore: number;
  todayIncome: number;
}

const defaults: DailyBriefingData = {
  activeProjects: 0,
  dueTasks: 0,
  healthScore: 0,
  todayIncome: 0,
};

export async function getDailyBriefingData(): Promise<DailyBriefingData> {
  try {
    const [activeProjects, dueTasks, healthData, incomeData] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(sql`projects`)
        .where(sql`status NOT IN ('On Hold', 'Completed', 'Archived')`),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(sql`tasks`)
        .where(sql`action_date <= now() AND status NOT IN ('Completed', 'Cancelled', 'Archived')`),
      db
        .select({ avg: sql<number>`avg(progress)::float` })
        .from(sql`projects`)
        .where(sql`status NOT IN ('On Hold', 'Completed', 'Archived')`),
      db
        .select({ total: sql<number>`sum(signed_amount)::float` })
        .from(sql`financial_log`)
        .where(sql`date >= current_date AND signed_amount > 0`),
    ]);

    return {
      activeProjects: activeProjects[0]?.count ?? 0,
      dueTasks: dueTasks[0]?.count ?? 0,
      healthScore: Math.round((healthData[0]?.avg ?? 0) * 100) / 100,
      todayIncome: incomeData[0]?.total ?? 0,
    };
  } catch {
    return defaults;
  }
}
