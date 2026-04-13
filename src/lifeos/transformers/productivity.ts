import { ActivityEntry } from "./activity-pg.js";
import { TaskEntry } from "./tasks-pg.js";

export interface ProductivityReport {
  period: string;
  totalActivities: number;
  totalHours: number;
  categoryBreakdown: Map<string, { hours: number; count: number }>;
  habitCount: number;
  habitHours: number;
  tasksTotal: number;
  tasksActive: number;
  tasksDone: number;
  tasksOverdue: number;
  completionRate: number;
  topActivities: Array<{ name: string; hours: number }>;
  dailyAverage: number;
  flags: string[];
}

export function computeProductivityReport(
  activities: ActivityEntry[],
  tasks: TaskEntry[],
  dateFrom: string,
  dateTo: string
): ProductivityReport {
  const days = Math.max(
    1,
    Math.ceil(
      (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1
  );

  const totalHours = activities.reduce((s, e) => s + (e.durationHours ?? 0), 0);
  const categoryBreakdown = new Map<string, { hours: number; count: number }>();
  for (const a of activities) {
    const cat = a.activityType || "Uncategorized";
    const existing = categoryBreakdown.get(cat) || { hours: 0, count: 0 };
    existing.hours += a.durationHours ?? 0;
    existing.count += 1;
    categoryBreakdown.set(cat, existing);
  }

  const habitCount = activities.filter((e) => e.isHabit).length;
  const habitHours = activities
    .filter((e) => e.isHabit)
    .reduce((s, e) => s + (e.durationHours ?? 0), 0);

  const tasksActive = tasks.filter(
    (t) => !["Done", "Cancelled", "Archived"].includes(t.status)
  ).length;
  const tasksDone = tasks.filter((t) => t.status === "Done").length;
  const tasksOverdue = tasks.filter((t) => t.isOverdue).length;
  const completionRate =
    tasks.length > 0 ? Math.round((tasksDone / tasks.length) * 100) : 0;

  const topActivities = [...categoryBreakdown.entries()]
    .map(([name, data]) => ({ name, hours: data.hours }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  const flags: string[] = [];
  const recEntry = categoryBreakdown.get("Recreation");
  if (recEntry && totalHours > 0) {
    const recPct = (recEntry.hours / totalHours) * 100;
    flags.push(`Recreation is ${recPct.toFixed(0)}% of tracked time`);
  }
  if (tasksOverdue > 0) flags.push(`${tasksOverdue} overdue task(s)`);
  if (totalHours < days * 2) flags.push(`Low activity tracking: ${totalHours.toFixed(1)}h over ${days} days`);
  if (habitCount === 0) flags.push("No habit activities logged in this period");

  return {
    period: `${dateFrom} to ${dateTo}`,
    totalActivities: activities.length,
    totalHours,
    categoryBreakdown,
    habitCount,
    habitHours,
    tasksTotal: tasks.length,
    tasksActive,
    tasksDone,
    tasksOverdue,
    completionRate,
    topActivities,
    dailyAverage: totalHours / days,
    flags,
  };
}

export function productivityReportToMarkdown(report: ProductivityReport): string {
  const lines = [
    "# Productivity Report",
    `**Period:** ${report.period}`,
    "",
    "## Overview",
    "",
    `- **Activities logged:** ${report.totalActivities}`,
    `- **Total tracked time:** ${report.totalHours.toFixed(1)}h`,
    `- **Daily average:** ${report.dailyAverage.toFixed(1)}h/day`,
    `- **Habit activities:** ${report.habitCount} (${report.habitHours.toFixed(1)}h)`,
    "",
    "## Time Allocation",
    "",
  ];

  for (const [cat, data] of [...report.categoryBreakdown.entries()].sort(
    (a, b) => b[1].hours - a[1].hours
  )) {
    const pct = report.totalHours > 0 ? ((data.hours / report.totalHours) * 100).toFixed(0) : "0";
    lines.push(`- **${cat}:** ${data.hours.toFixed(1)}h (${pct}%) — ${data.count} entries`);
  }

  lines.push("");
  lines.push("## Task Performance");
  lines.push("");
  lines.push(`- **Total tasks:** ${report.tasksTotal}`);
  lines.push(`- **Active:** ${report.tasksActive}`);
  lines.push(`- **Completed:** ${report.tasksDone}`);
  lines.push(`- **Completion rate:** ${report.completionRate}%`);
  lines.push(`- **⚠️ Overdue:** ${report.tasksOverdue}`);
  lines.push("");

  if (report.flags.length > 0) {
    lines.push("## Alerts & Insights");
    lines.push("");
    for (const flag of report.flags) {
      lines.push(`- ${flag}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
