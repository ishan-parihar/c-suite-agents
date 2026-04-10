import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  endDate: string | null;
  type: "project" | "campaign" | "activity" | "content";
  color: "blue" | "amber" | "green" | "purple";
  href: string;
}

const TYPE_COLORS: Record<CalendarEvent["type"], CalendarEvent["color"]> = {
  project: "blue",
  campaign: "amber",
  activity: "green",
  content: "purple",
} as const;

export async function getCalendarEvents(month?: string): Promise<CalendarEvent[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, title, date, end_date, type FROM (
        SELECT
          id::text,
          name AS title,
          TO_CHAR(deadline, 'YYYY-MM-DD') AS date,
          NULL::text AS end_date,
          'project' AS type
        FROM projects
        WHERE deadline IS NOT NULL

        UNION ALL

        SELECT
          id::text,
          name AS title,
          TO_CHAR(start_date, 'YYYY-MM-DD') AS date,
          TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
          'campaign' AS type
        FROM campaigns
        WHERE start_date IS NOT NULL

        UNION ALL

        SELECT
          id::text,
          name AS title,
          TO_CHAR(date_range, 'YYYY-MM-DD') AS date,
          TO_CHAR(date_end, 'YYYY-MM-DD') AS end_date,
          'activity' AS type
        FROM activity_log
        WHERE date_range IS NOT NULL
        LIMIT 200

        UNION ALL

        SELECT
          id::text,
          name AS title,
          TO_CHAR(publish_date, 'YYYY-MM-DD') AS date,
          NULL::text AS end_date,
          'content' AS type
        FROM content_pipeline
        WHERE publish_date IS NOT NULL
      ) AS events
      WHERE date LIKE ${month ? `${month}%` : "%"}
      ORDER BY date ASC
    `);

    return result.rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      endDate: r.end_date,
      type: r.type as CalendarEvent["type"],
      color: TYPE_COLORS[r.type as CalendarEvent["type"]] ?? "blue",
      href:
        r.type === "project"
          ? `/projects/${r.id}`
          : r.type === "campaign"
            ? `/campaigns/${r.id}`
            : r.type === "activity"
              ? `/days`
              : `#`,
    }));
  } catch {
    return [];
  }
}
