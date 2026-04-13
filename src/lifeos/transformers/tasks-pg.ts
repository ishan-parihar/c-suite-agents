export interface TaskEntry {
  id: string;
  name: string;
  status: string;
  priority: string;
  actionDate: string;
  description: string;
  monitor: string;
  sprintStatus: string;
  projectCount: number;
  daysAgo: number;
  isOverdue: boolean;
  tags: string[];
  estimatedHours: number | null;
  completedDate: string;
}

const ACTIVE_STATUSES = new Set(["Active", "Focus", "Up Next", "Waiting", "Paused"]);
const DONE_STATUSES = new Set(["Done", "Cancelled", "Archived"]);

function strVal(v: unknown): string {
  return v != null ? String(v) : "";
}

function numVal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function arrLen(arr: unknown): number {
  return Array.isArray(arr) ? arr.length : 0;
}

function daysAgo(dateStr: string): number {
  if (!dateStr) return 999;
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return 999;
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "No date";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.split("T")[0];
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function transformTask(row: Record<string, unknown>): TaskEntry {
  const actionDate = strVal(row.actionDate);
  const status = strVal(row.status);
  const isOverdue = Boolean(ACTIVE_STATUSES.has(status) && actionDate && daysAgo(actionDate) > 0);

  return {
    id: strVal(row.taskId || row.id),
    name: strVal(row.name),
    status,
    priority: strVal(row.priority),
    actionDate,
    description: strVal(row.description),
    monitor: strVal(row.monitor),
    sprintStatus: strVal(row.sprintStatus),
    projectCount: arrLen(row.blocks),
    daysAgo: actionDate ? daysAgo(actionDate) : 999,
    isOverdue,
    tags: Array.isArray(row.tags) ? row.tags as string[] : [],
    estimatedHours: numVal(row.estimatedHours),
    completedDate: strVal(row.completedDate),
  };
}

export function tasksToMarkdown(
  entries: TaskEntry[],
  title = "Tasks"
): string {
  if (entries.length === 0) {
    return `## ${title}\n\nNo tasks found.`;
  }

  const lines = [`## ${title}`, ""];

  const active = entries.filter((e) => ACTIVE_STATUSES.has(e.status));
  const done = entries.filter((e) => DONE_STATUSES.has(e.status));
  const overdue = entries.filter((e) => e.isOverdue);

  lines.push(
    `**Total:** ${entries.length} | **Active:** ${active.length} | **Done:** ${done.length} | ⚠️ **Overdue:** ${overdue.length}`
  );
  lines.push("");

  if (overdue.length > 0) {
    lines.push("### ⚠️ Overdue Tasks");
    lines.push("");
    for (const t of overdue) {
      const dueStr = t.actionDate ? formatDate(t.actionDate) : "No date";
      lines.push(
        `- **[${t.status}]** ${t.id}: ${t.name} (was due: ${dueStr})`
      );
      if (t.priority) lines.push(`  - Priority: ${t.priority}`);
      if (t.monitor) lines.push(`  - Monitor: ${t.monitor}`);
    }
    lines.push("");
  }

  if (active.length > 0) {
    lines.push("### Active Tasks");
    lines.push("");
    for (const t of active) {
      const dueStr = t.actionDate ? formatDate(t.actionDate) : "No date";
      const statusIcon =
        t.status === "Focus" ? "🎯" : t.status === "Active" ? "▶️" : "⏸️";
      const tagsStr = t.tags.length > 0 ? ` ${t.tags.map(tag => `[${tag}]`).join(" ")}` : "";
      lines.push(
        `- ${statusIcon} **[${t.status}]** ${t.id}: ${t.name}${tagsStr}`
      );
      if (t.priority) lines.push(`  - Priority: ${t.priority}`);
      if (t.actionDate) lines.push(`  - Action Date: ${dueStr}`);
      if (t.monitor) lines.push(`  - Monitor: ${t.monitor}`);
      if (t.estimatedHours !== null) lines.push(`  - Estimated: ${t.estimatedHours}h`);
    }
    lines.push("");
  }

  if (done.length > 0) {
    lines.push("### Completed/Cancelled");
    lines.push("");
    for (const t of done.slice(0, 10)) {
      const completedStr = t.completedDate
        ? `, completed ${formatDate(t.completedDate)}`
        : "";
      lines.push(
        `- ~~${t.id}: ${t.name}~~ (${t.status}${completedStr})`
      );
    }
    if (done.length > 10) {
      lines.push(`- ... and ${done.length - 10} more`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
