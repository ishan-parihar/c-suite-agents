import type { ActivityEntry } from "./activity-pg.js";
import type { ActivityTarget } from "./temporal.js";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface CategoryStats {
  mean: number;
  stdDev: number;
  frequency: number;
}

export interface WeekdayProfile {
  weekday: string;
  weekdayIndex: number;
  instances: number;
  totalHours: { mean: number; stdDev: number };
  categories: Map<string, CategoryStats>;
  mostCommon: string[];
  consistency: number;
}

export interface WeekdayAnomaly {
  category: string;
  weekday: string;
  expectedMean: number;
  expectedStdDev: number;
  actual: number;
  deviationSigma: number;
  severity: "ok" | "notable" | "significant";
  insight: string;
}

export interface DaySuggestion {
  category: string;
  suggestedHours: number;
  reasoning: string;
  isHabit: boolean;
  fromTarget: boolean;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function computeWeekdayProfiles(
  activities: ActivityEntry[],
  _referenceWeeks = 8
): Map<number, WeekdayProfile> {
  // Group by weekday → date → category hours
  const weekdayBuckets = new Map<number, Map<string, Map<string, number>>>();

  for (const a of activities) {
    if (!a.date || a.durationHours == null) continue;
    const dayKey = a.date.split("T")[0];
    const dow = new Date(a.date).getDay();
    const cat = a.activityType || "Uncategorized";

    if (!weekdayBuckets.has(dow)) weekdayBuckets.set(dow, new Map());
    const dayMap = weekdayBuckets.get(dow)!;
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, new Map());
    const catMap = dayMap.get(dayKey)!;
    catMap.set(cat, (catMap.get(cat) || 0) + a.durationHours);
  }

  const profiles = new Map<number, WeekdayProfile>();

  for (let dow = 0; dow < 7; dow++) {
    const dayMap = weekdayBuckets.get(dow);
    const instances = dayMap ? dayMap.size : 0;

    if (instances < 1) {
      profiles.set(dow, {
        weekday: WEEKDAY_NAMES[dow],
        weekdayIndex: dow,
        instances: 0,
        totalHours: { mean: 0, stdDev: 0 },
        categories: new Map(),
        mostCommon: [],
        consistency: 0,
      });
      continue;
    }

    // Compute per-day totals
    const dayTotals: number[] = [];
    for (const [, catMap] of dayMap!) {
      const total = [...catMap.values()].reduce((s, v) => s + v, 0);
      dayTotals.push(total);
    }

    // Collect all categories and their per-day values
    const allCategories = new Set<string>();
    for (const [, catMap] of dayMap!) {
      for (const cat of catMap.keys()) allCategories.add(cat);
    }

    const categoryStats = new Map<string, CategoryStats>();
    const mostCommon: string[] = [];

    for (const cat of allCategories) {
      const values: number[] = [];
      let daysWith = 0;

      for (const [, catMap] of dayMap!) {
        const val = catMap.get(cat) || 0;
        values.push(val);
        if (val > 0) daysWith++;
      }

      const catMean = mean(values);
      const catStdDev = stddev(values);
      const frequency = daysWith / instances;

      categoryStats.set(cat, { mean: catMean, stdDev: catStdDev, frequency });
      if (frequency >= 0.5) mostCommon.push(cat);
    }

    // Sort most common by mean hours descending
    mostCommon.sort((a, b) => {
      const sa = categoryStats.get(a)!;
      const sb = categoryStats.get(b)!;
      return sb.mean - sa.mean;
    });

    const totalMean = mean(dayTotals);
    const totalStdDev = stddev(dayTotals);
    const cv = totalMean > 0 ? totalStdDev / totalMean : 1;
    const consistency = Math.max(0, 1 - cv);

    profiles.set(dow, {
      weekday: WEEKDAY_NAMES[dow],
      weekdayIndex: dow,
      instances,
      totalHours: { mean: totalMean, stdDev: totalStdDev },
      categories: categoryStats,
      mostCommon,
      consistency: Math.round(consistency * 100) / 100,
    });
  }

  return profiles;
}

export function detectAnomalies(
  todayActivities: ActivityEntry[],
  profile: WeekdayProfile
): WeekdayAnomaly[] {
  if (profile.instances < 2) return [];

  const todayByCategory = new Map<string, number>();
  for (const a of todayActivities) {
    const cat = a.activityType || "Uncategorized";
    todayByCategory.set(cat, (todayByCategory.get(cat) || 0) + (a.durationHours ?? 0));
  }

  const anomalies: WeekdayAnomaly[] = [];

  for (const [cat, stats] of profile.categories) {
    const actual = todayByCategory.get(cat) || 0;
    const sigma = stats.stdDev > 0 ? Math.abs(actual - stats.mean) / stats.stdDev : 0;

    let severity: WeekdayAnomaly["severity"];
    if (sigma <= 1.5) severity = "ok";
    else if (sigma <= 2.5) severity = "notable";
    else severity = "significant";

    const direction = actual > stats.mean ? "over" : actual < stats.mean ? "under" : "on-track";

    let insight: string;
    if (severity === "ok") {
      insight = `${cat}: ${actual.toFixed(1)}h (typical: ${stats.mean.toFixed(1)}h ± ${stats.stdDev.toFixed(1)}h)`;
    } else {
      insight = `${cat}: ${actual.toFixed(1)}h vs typical ${stats.mean.toFixed(1)}h — ${direction} by ${sigma.toFixed(1)}σ`;
    }

    // Only report notable/significant anomalies (and "ok" for zero vs expected)
    if (severity !== "ok" || (actual === 0 && stats.mean > 0.5)) {
      anomalies.push({
        category: cat,
        weekday: profile.weekday,
        expectedMean: stats.mean,
        expectedStdDev: stats.stdDev,
        actual,
        deviationSigma: Math.round(sigma * 10) / 10,
        severity: actual === 0 && stats.mean > 0.5 ? "notable" : severity,
        insight,
      });
    }
  }

  // Sort: significant first, then notable
  anomalies.sort((a, b) => {
    const order = { significant: 0, notable: 1, ok: 2 };
    return order[a.severity] - order[b.severity];
  });

  return anomalies;
}

export function suggestDayPlan(
  profile: WeekdayProfile,
  targets?: Map<string, ActivityTarget>
): DaySuggestion[] {
  const suggestions: DaySuggestion[] = [];
  const seen = new Set<string>();

  // Priority 1: Activities with targets
  if (targets) {
    for (const [name, target] of targets) {
      seen.add(name);
      const profileStat = profile.categories.get(name);

      if (profileStat && profileStat.mean > 0) {
        // Blend target and profile
        const suggested = Math.round((target.targetDuration + profileStat.mean) / 2 * 10) / 10;
        suggestions.push({
          category: name,
          suggestedHours: suggested,
          reasoning: `Target: ${target.targetDuration}h | Typical ${profile.weekday}: ${profileStat.mean.toFixed(1)}h ± ${profileStat.stdDev.toFixed(1)}h (${(profileStat.frequency * 100).toFixed(0)}% of ${profile.weekday}s)`,
          isHabit: target.isHabit,
          fromTarget: true,
        });
      } else {
        suggestions.push({
          category: name,
          suggestedHours: target.targetDuration,
          reasoning: `Target: ${target.targetDuration}h | No ${profile.weekday} history for this activity`,
          isHabit: target.isHabit,
          fromTarget: true,
        });
      }
    }
  }

  // Priority 2: Profile categories not covered by targets
  for (const [cat, stats] of profile.categories) {
    if (seen.has(cat)) continue;
    if (stats.mean < 0.1) continue;

    suggestions.push({
      category: cat,
      suggestedHours: Math.round(stats.mean * 10) / 10,
      reasoning: `Typical ${profile.weekday}: ${stats.mean.toFixed(1)}h ± ${stats.stdDev.toFixed(1)}h (${(stats.frequency * 100).toFixed(0)}% of ${profile.weekday}s)`,
      isHabit: false,
      fromTarget: false,
    });
  }

  // Sort: targets first, then by hours descending
  suggestions.sort((a, b) => {
    if (a.fromTarget !== b.fromTarget) return a.fromTarget ? -1 : 1;
    return b.suggestedHours - a.suggestedHours;
  });

  return suggestions;
}

export function weekdayProfileToMarkdown(profile: WeekdayProfile): string {
  const lines: string[] = [];

  lines.push(`### ${profile.weekday} (${profile.instances} instances)`);
  lines.push("");

  if (profile.instances === 0) {
    lines.push("No data available for this weekday.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`- **Avg total:** ${profile.totalHours.mean.toFixed(1)}h ± ${profile.totalHours.stdDev.toFixed(1)}h`);
  lines.push(`- **Consistency:** ${(profile.consistency * 100).toFixed(0)}%`);
  lines.push("");

  // Sort categories by mean hours descending
  const sorted = [...profile.categories.entries()]
    .filter(([, s]) => s.mean >= 0.1)
    .sort((a, b) => b[1].mean - a[1].mean);

  if (sorted.length > 0) {
    lines.push("| Activity | Avg Hours | StdDev | Frequency |");
    lines.push("|----------|-----------|--------|-----------|");

    for (const [cat, stats] of sorted) {
      lines.push(
        `| ${cat} | ${stats.mean.toFixed(1)}h | ±${stats.stdDev.toFixed(1)}h | ${(stats.frequency * 100).toFixed(0)}% |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function weekdayOverviewToMarkdown(
  profiles: Map<number, WeekdayProfile>,
  todayDow?: number
): string {
  const lines: string[] = [];

  lines.push("## Weekly Grid");
  lines.push("");
  lines.push("| Day | Avg Hours | Top Activities | Consistency |");
  lines.push("|-----|-----------|---------------|-------------|");

  for (let dow = 1; dow <= 7; dow++) {
    const idx = dow % 7; // Mon=1, Tue=2, ... Sun=0
    const p = profiles.get(idx);
    if (!p || p.instances === 0) {
      lines.push(`| ${WEEKDAY_NAMES[idx]} | — | No data | — |`);
      continue;
    }

    const top3 = p.mostCommon.slice(0, 3).map(cat => {
      const stats = p.categories.get(cat)!;
      return `${cat} ${stats.mean.toFixed(1)}h`;
    }).join(", ");

    const isToday = todayDow === idx ? " ← today" : "";
    const consistency = `${(p.consistency * 100).toFixed(0)}%`;

    lines.push(`| ${p.weekday}${isToday} | ${p.totalHours.mean.toFixed(1)}h | ${top3} | ${consistency} |`);
  }
  lines.push("");

  return lines.join("\n");
}
