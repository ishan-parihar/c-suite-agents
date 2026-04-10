import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function getTasksList() {
  try {
    const result = await db.execute(sql`
      SELECT t.id, t.name, t.status, t.priority, t.assignee,
        t.action_date, t.completed_date, t.sprint_status,
        t.description, t.tags, t.project_id,
        p.name as project_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      ORDER BY t.action_date ASC NULLS LAST
      LIMIT 500
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, status: r.status, priority: r.priority,
      assignee: r.assignee, actionDate: r.action_date,
      completedDate: r.completed_date, sprintStatus: r.sprint_status,
      description: r.description, tags: r.tags,
      projectId: r.project_id, projectName: r.project_name,
    }));
  } catch { return []; }
}
