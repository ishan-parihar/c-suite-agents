import { ActivityEntry } from "./activity-pg.js";

export interface ActivityTarget {
  name: string;
  targetDuration: number;
  targetFrequency: string;
  isHabit: boolean;
  weeklyMultiplier: number;
}

export function frequencyToWeeklyMultiplier(freq: string): number {
  switch (freq) {
    case "4 Times a Day": return 28;
    case "Every Day": return 7;
    case "Twice Every Week": return 2;
    case "Once every Week": return 1;
    case "Once every 4 days": return 1.75;
    default: return 7;
  }
}

export function loadActivityTargetsPg(
  rows: Array<Record<string, unknown>>
): Map<string, ActivityTarget> {
  const targets = new Map<string, ActivityTarget>();
  for (const row of rows) {
    const name = (row.name || row.title || "Unknown") as string;
    const freq = (row.frequency as string) || "Every Day";
    const duration = (row.durationHrs as number) ?? 0;
    const isHabit = (row.isHabit as boolean) ?? false;
    targets.set(name, {
      name,
      targetDuration: duration,
      targetFrequency: freq,
      isHabit,
      weeklyMultiplier: frequencyToWeeklyMultiplier(freq),
    });
  }
  return targets;
}

export function loadActivityTargets(
  activityTypesPages: Array<{ properties: Record<string, { type: string; [k: string]: unknown }> }>
): Map<string, ActivityTarget> {
  const targets = new Map<string, ActivityTarget>();
  for (const page of activityTypesPages) {
    const titleProp = Object.values(page.properties).find(p => p.type === "title");
    if (!titleProp) continue;
    const name = ((titleProp as any).title || []).map((t: any) => t.plain_text).join("");

    const freqProp = page.properties["Frequency"];
    const freq = (freqProp as any)?.select?.name || "Every Day";

    const durProp = page.properties["Duration (in hrs)"];
    const duration = (durProp as any)?.number ?? 0;

    const habitProp = page.properties["Habit"];
    const isHabit = (habitProp as any)?.checkbox ?? false;

    targets.set(name, {
      name,
      targetDuration: duration,
      targetFrequency: freq,
      isHabit,
      weeklyMultiplier: frequencyToWeeklyMultiplier(freq),
    });
  }
  return targets;
}

export interface PeriodMetrics {
  period: string;
  periodLabel: string;
  days: number;
  trackedDays: number;
  totalHours: number;
  dailyAverage: number;
  categoryBreakdown: Map<string, { hours: number; count: number; pctOfTotal: number }>;
  categoryDailyAvg: Map<string, number>;
  habitCompliance: number;
  habitTarget: number;
  peakDay: { date: string; hours: number };
  lowDay: { date: string; hours: number };
  entriesCount: number;
  dailyHours: Map<string, number>;
}

export function computePeriodMetrics(
  activities: ActivityEntry[],
  dateFrom: string,
  dateTo: string,
  targets?: Map<string, ActivityTarget>
): PeriodMetrics {
  const startMs = new Date(dateFrom).getTime();
  const endMs = new Date(dateTo).getTime();
  const days = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

  const totalHours = activities.reduce((s, e) => s + (e.durationHours ?? 0), 0);

  // Daily hours per calendar day
  const dailyHours = new Map<string, number>();
  for (const a of activities) {
    if (!a.date) continue;
    const dayKey = a.date.split("T")[0];
    dailyHours.set(dayKey, (dailyHours.get(dayKey) || 0) + (a.durationHours ?? 0));
  }

  // Tracked days = total tracked hours converted to fractional days
  const trackedDays = totalHours > 0 ? Math.round((totalHours / 24) * 100) / 100 : 0;

  // Daily average = totalHours / calendar days
  const dailyAverage = totalHours / days;

  // Category breakdown
  const categoryBreakdown = new Map<string, { hours: number; count: number; pctOfTotal: number }>();
  for (const a of activities) {
    const cat = a.activityType || "Uncategorized";
    const existing = categoryBreakdown.get(cat) || { hours: 0, count: 0, pctOfTotal: 0 };
    existing.hours += a.durationHours ?? 0;
    existing.count += 1;
    categoryBreakdown.set(cat, existing);
  }
  for (const [, data] of categoryBreakdown) {
    data.pctOfTotal = totalHours > 0 ? (data.hours / totalHours) * 100 : 0;
  }

  // Per-category daily average (from tracked days)
  const categoryDailyAvg = new Map<string, number>();
  for (const [cat, data] of categoryBreakdown) {
    categoryDailyAvg.set(cat, data.hours / trackedDays);
  }

  // Peak and low
  let peakDay = { date: "", hours: 0 };
  let lowDay = { date: "", hours: Infinity };
  for (const [date, hours] of dailyHours) {
    if (hours > peakDay.hours) peakDay = { date, hours };
    if (hours < lowDay.hours) lowDay = { date, hours };
  }
  if (lowDay.hours === Infinity) lowDay = { date: "", hours: 0 };

  // Habit compliance
  let habitCompliance = 0;
  let habitTarget = 0;
  if (targets) {
    const habitEntries = activities.filter(a => {
      const t = targets.get(a.activityType);
      return t?.isHabit;
    });
    const habitDays = new Set(habitEntries.map(a => a.date?.split("T")[0])).size;
    const totalHabitTargets = [...targets.values()].filter(t => t.isHabit).length;
    habitTarget = totalHabitTargets * trackedDays;
    habitCompliance = habitDays > 0 ? (habitEntries.length / habitTarget) * 100 : 0;
  } else {
    const habitEntries = activities.filter(a => a.isHabit);
    habitCompliance = activities.length > 0 ? (habitEntries.length / activities.length) * 100 : 0;
    habitTarget = habitCompliance;
  }

  return {
    period: `${dateFrom} to ${dateTo}`,
    periodLabel: `${dateFrom} → ${dateTo}`,
    days,
    trackedDays,
    totalHours,
    dailyAverage,
    categoryBreakdown,
    categoryDailyAvg,
    habitCompliance: Math.min(100, habitCompliance),
    habitTarget,
    peakDay,
    lowDay,
    entriesCount: activities.length,
    dailyHours,
  };
}

export interface BaselineMetrics {
  metric: string;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
  samples: number;
}

export function computeBaseline(values: number[], metric: string): BaselineMetrics {
  if (values.length === 0) {
    return { metric, mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p25: 0, p75: 0, samples: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];

  return {
    metric,
    mean,
    median,
    stdDev,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25,
    p75,
    samples: values.length,
  };
}

export interface Deviation {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  deltaPct: number;
  direction: "above" | "below" | "on-track";
  severity: "normal" | "notable" | "significant";
}

export function computeDeviation(current: number, baseline: BaselineMetrics): Deviation {
  const delta = current - baseline.mean;
  const deltaPct = baseline.mean > 0 ? (delta / baseline.mean) * 100 : 0;
  const absDelta = Math.abs(delta);

  let direction: Deviation["direction"];
  if (absDelta <= baseline.stdDev) direction = "on-track";
  else direction = delta > 0 ? "above" : "below";

  let severity: Deviation["severity"];
  if (absDelta <= baseline.stdDev) severity = "normal";
  else if (absDelta <= 2 * baseline.stdDev) severity = "notable";
  else severity = "significant";

  return { metric: baseline.metric, baseline: baseline.mean, current, delta, deltaPct, direction, severity };
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendAnalysis {
  metric: string;
  points: TrendPoint[];
  trend: "improving" | "declining" | "stable" | "volatile";
  slope: number;
  r2: number;
  projection7d: number;
  projection30d: number;
}

export function computeTrend(points: TrendPoint[], metric: string, higherIsBetter = true): TrendAnalysis {
  if (points.length < 2) {
    const val = points[0]?.value ?? 0;
    return { metric, points, trend: "stable", slope: 0, r2: 0, projection7d: val, projection30d: val };
  }

  // Linear regression
  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.value);
  const xMean = xs.reduce((s, x) => s + x, 0) / n;
  const yMean = ys.reduce((s, y) => s + y, 0) / n;

  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (xs[i] - xMean) * (ys[i] - yMean);
    ssXX += (xs[i] - xMean) ** 2;
    ssYY += (ys[i] - yMean) ** 2;
  }

  const slope = ssXX > 0 ? ssXY / ssXX : 0;
  const r2 = ssYY > 0 ? (ssXY ** 2) / (ssXX * ssYY) : 0;

  const lastValue = ys[ys.length - 1];
  const projection7d = lastValue + slope * 7;
  const projection30d = lastValue + slope * 30;

  let trend: TrendAnalysis["trend"];
  const absSlope = Math.abs(slope);
  if (absSlope < 0.01) trend = "stable";
  else if (r2 < 0.3) trend = "volatile";
  else if (higherIsBetter) trend = slope > 0 ? "improving" : "declining";
  else trend = slope > 0 ? "declining" : "improving";

  return { metric, points, trend, slope, r2, projection7d, projection30d };
}

export interface TrajectoryMapping {
  metric: string;
  current: number;
  target: number;
  gap: number;
  gapPct: number;
  actualDailyRate: number;
  idealDailyRate: number;
  projectedAtCurrentRate: number;
  onTrack: boolean;
  insight: string;
}

export function mapTrajectory(
  current: number,
  target: number,
  actualDailyRate: number,
  daysRemaining: number
): TrajectoryMapping {
  const gap = target - current;
  const gapPct = target > 0 ? (gap / target) * 100 : 0;
  const idealDailyRate = daysRemaining > 0 ? gap / daysRemaining : 0;
  const projectedAtCurrentRate = current + actualDailyRate * daysRemaining;
  const onTrack = actualDailyRate >= idealDailyRate * 0.8; // 80% threshold

  let insight: string;
  if (onTrack) {
    insight = `On track. At current rate (${actualDailyRate.toFixed(2)}/day), projected to reach ${projectedAtCurrentRate.toFixed(1)} by deadline.`;
  } else if (gap > 0) {
    const rateNeeded = idealDailyRate;
    insight = `Behind target. Current rate: ${actualDailyRate.toFixed(2)}/day. Need ${rateNeeded.toFixed(2)}/day to close ${gap.toFixed(1)} gap in ${daysRemaining} days.`;
  } else {
    insight = `Ahead of target by ${Math.abs(gap).toFixed(1)}. Maintaining current pace.`;
  }

  return {
    metric: "",
    current,
    target,
    gap,
    gapPct,
    actualDailyRate,
    idealDailyRate,
    projectedAtCurrentRate,
    onTrack,
    insight,
  };
}
