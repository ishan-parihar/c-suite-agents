export interface ActivityEntry {
  id: string;
  name: string;
  date: string;
  activityType: string;
  durationHours: number | null;
  activityNotes: string;
  isHabit: boolean;
  isLogged: boolean;
  projectCount: number;
  daysAgo: number;
  energy: string;
  moodDelta: string;
}

function arrLen(arr: unknown): number {
  return Array.isArray(arr) ? arr.length : 0;
}

function strVal(v: unknown): string {
  return v != null ? String(v) : "";
}

function numVal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function boolVal(v: unknown): boolean {
  if (v === true) return true;
  if (v === "true" || v === "Yes" || v === "yes") return true;
  return false;
}

function daysAgo(dateStr: string): number {
  if (!dateStr) return 999;
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return 999;
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

export function transformActivity(row: Record<string, unknown>): ActivityEntry {
  const date = strVal(row.date);
  return {
    id: strVal(row.id),
    name: strVal(row.name),
    date,
    activityType: strVal(row.activityType),
    durationHours: numVal(row.durationHrs),
    activityNotes: strVal(row.activityNotes),
    isHabit: boolVal(row.isHabitActivity),
    isLogged: boolVal(row.isLogged),
    projectCount: arrLen(row.projects),
    daysAgo: date ? daysAgo(date) : 999,
    energy: strVal(row.energy),
    moodDelta: strVal(row.moodDelta),
  };
}

export function activitiesToMarkdown(
  entries: ActivityEntry[],
  title = "Activity Log"
): string {
  if (entries.length === 0) {
    return `## ${title}\n\nNo activities found for the specified period.`;
  }

  const lines = [`## ${title}`, ""];

  const byType = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const type = e.activityType || "Uncategorized";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(e);
  }

  const totalHours = entries.reduce((s, e) => s + (e.durationHours ?? 0), 0);
  lines.push(`**Total entries:** ${entries.length} | **Total tracked time:** ${totalHours.toFixed(1)}h`);
  lines.push("");

  for (const [type, typeEntries] of byType) {
    const typeHours = typeEntries.reduce((s, e) => s + (e.durationHours ?? 0), 0);
    lines.push(`### ${type} (${typeHours.toFixed(1)}h, ${typeEntries.length} entries)`);
    lines.push("");

    for (const e of typeEntries) {
      const timeStr = e.date ? e.date.split("T")[0] : "No date";
      const durStr = e.durationHours != null ? `${e.durationHours}h` : "No duration";
      const habitTag = e.isHabit ? " 🔄 Habit" : "";
      const loggedTag = e.isLogged ? " ✅ Logged" : "";

      lines.push(`- **[${timeStr}]** ${e.name} — ${durStr}${habitTag}${loggedTag}`);
      if (e.activityNotes && e.activityNotes !== e.name) {
        lines.push(`  - Notes: ${e.activityNotes}`);
      }
    }
    lines.push("");
  }

  const hasEnergyOrMood = entries.some((e) => e.energy || e.moodDelta);
  if (hasEnergyOrMood) {
    lines.push("### Energy & Mood");
    lines.push("");

    const energyCounts: Record<string, number> = { High: 0, Medium: 0, Low: 0 };
    let energyUnspecified = 0;
    for (const e of entries) {
      if (e.energy && energyCounts[e.energy] !== undefined) {
        energyCounts[e.energy]++;
      } else if (e.energy) {
        energyUnspecified++;
      }
    }
    const totalWithEnergy = entries.length - energyUnspecified;
    if (totalWithEnergy > 0) {
      for (const [level, count] of Object.entries(energyCounts)) {
        const pct = ((count / totalWithEnergy) * 100).toFixed(0);
        lines.push(`- **${level}:** ${count} (${pct}%)`);
      }
    }

    const moodCounts: Record<string, number> = { "↑": 0, "→": 0, "↓": 0 };
    let moodUnspecified = 0;
    for (const e of entries) {
      if (e.moodDelta && moodCounts[e.moodDelta] !== undefined) {
        moodCounts[e.moodDelta]++;
      } else if (e.moodDelta) {
        moodUnspecified++;
      }
    }
    const totalWithMood = entries.length - moodUnspecified;
    if (totalWithMood > 0) {
      lines.push("");
      for (const [symbol, count] of Object.entries(moodCounts)) {
        lines.push(`- **${symbol}:** ${count}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}
