import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function getAnnualGoals() {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, goal_progress, goal_archetype,
        strategic_approach, success_condition, planned_range, the_epic,
        is_current_goal
      FROM annual_goals
      ORDER BY is_current_goal DESC NULLS LAST, name ASC
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, status: r.status, goalProgress: r.goal_progress,
      goalArchetype: r.goal_archetype, strategicApproach: r.strategic_approach,
      successCondition: r.success_condition, plannedRange: r.planned_range,
      theEpic: r.the_epic, isCurrentGoal: r.is_current_goal,
    }));
  } catch { return []; }
}

export async function getQuarterlyGoals() {
  try {
    const result = await db.execute(sql`
      SELECT id, name, status, goal_progress, progress, health,
        planned_range, key_result_1, key_result_2, key_result_3,
        key_learning, is_current_goal, annual_goal_id
      FROM quarterly_goals
      ORDER BY is_current_goal DESC NULLS LAST, name ASC
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, status: r.status, goalProgress: r.goal_progress,
      progress: r.progress, health: r.health, plannedRange: r.planned_range,
      keyResult1: r.key_result_1, keyResult2: r.key_result_2, keyResult3: r.key_result_3,
      keyLearning: r.key_learning, isCurrentGoal: r.is_current_goal,
      annualGoalId: r.annual_goal_id,
    }));
  } catch { return []; }
}
