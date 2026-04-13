export interface DietEntry {
  id: string;
  name: string;
  date: string;
  nutrition: string;
}

export function transformDietEntryPg(row: Record<string, unknown>): DietEntry {
  return {
    id: (row.id as string) || "",
    name: (row.title || row.name || "Untitled") as string,
    date: (row.date as string) || "",
    nutrition: (row.nutrition as string) || "",
  };
}

export interface HealthVitalityReport {
  periodLabel: string;
  days: number;
  components: Map<string, HealthComponent>;
  overallScore: number;
  trends: string[];
  dietEntries: DietEntry[];
  workoutHours: number;
  sleepHours: number;
  moodEntries: number;
}

export interface HealthComponent {
  name: string;
  score: number; // 0-100
  dataPoints: number;
  summary: string;
}

export function computeHealthVitality(
  dietEntries: DietEntry[],
  workoutHours: number,
  sleepHours: number,
  moodEntries: number,
  dateFrom: string,
  dateTo: string
): HealthVitalityReport {
  const startMs = new Date(dateFrom).getTime();
  const endMs = new Date(dateTo).getTime();
  const days = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

  const components = new Map<string, HealthComponent>();

  // Nutrition score (based on logging frequency and content keywords)
  const nutritionScore = computeNutritionScore(dietEntries, days);
  components.set("Nutrition", nutritionScore);

  // Exercise score (based on workout hours per week)
  const exerciseScore = computeExerciseScore(workoutHours, days);
  components.set("Exercise", exerciseScore);

  // Sleep score (based on sleep hours per night)
  const sleepScore = computeSleepScore(sleepHours, days);
  components.set("Sleep", sleepScore);

  // Mood score (based on journaling frequency)
  const moodScore = computeMoodScore(moodEntries, days);
  components.set("Mood", moodScore);

  // Overall score (weighted average)
  const overallScore = Math.round(
    nutritionScore.score * 0.3 +
    exerciseScore.score * 0.25 +
    sleepScore.score * 0.25 +
    moodScore.score * 0.2
  );

  // Generate trends
  const trends: string[] = [];
  if (dietEntries.length > 0) {
    trends.push(`Nutrition logged ${dietEntries.length} day(s) out of ${days} (${((dietEntries.length / days) * 100).toFixed(0)}% coverage)`);
  }
  if (workoutHours > 0) {
    trends.push(`Exercise: ${(workoutHours / days).toFixed(1)}h/day average`);
  }
  if (sleepHours > 0) {
    trends.push(`Sleep: ${(sleepHours / days).toFixed(1)}h/night average`);
  }
  if (moodEntries > 0) {
    trends.push(`Mood tracked ${moodEntries} day(s)`);
  }

  return {
    periodLabel: `${dateFrom} → ${dateTo}`,
    days,
    components,
    overallScore,
    trends,
    dietEntries,
    workoutHours,
    sleepHours,
    moodEntries,
  };
}

function computeNutritionScore(entries: DietEntry[], days: number): HealthComponent {
  const coverage = entries.length / days;
  let score = Math.min(100, coverage * 100);

  // Bonus for detailed entries
  const detailedEntries = entries.filter(e => e.nutrition && e.nutrition.length > 20).length;
  if (detailedEntries > 0) {
    score = Math.min(100, score + (detailedEntries / entries.length) * 20);
  }

  return {
    name: "Nutrition",
    score: Math.round(score),
    dataPoints: entries.length,
    summary: entries.length > 0
      ? `${entries.length} meal(s) logged`
      : "No nutrition data",
  };
}

function computeExerciseScore(hours: number, days: number): HealthComponent {
  const dailyAvg = hours / days;
  // WHO recommends 150min/week = ~21min/day = 0.35h/day
  const target = 0.35;
  const score = Math.min(100, (dailyAvg / target) * 100);

  return {
    name: "Exercise",
    score: Math.round(score),
    dataPoints: hours > 0 ? Math.max(1, Math.round(hours)) : 0,
    summary: hours > 0
      ? `${dailyAvg.toFixed(1)}h/day avg (${hours.toFixed(1)}h total)`
      : "No exercise data",
  };
}

function computeSleepScore(hours: number, days: number): HealthComponent {
  const dailyAvg = hours / days;
  // 7-9 hours recommended
  let score = 0;
  if (dailyAvg >= 7 && dailyAvg <= 9) {
    score = 100;
  } else if (dailyAvg >= 6) {
    score = 70;
  } else if (dailyAvg >= 5) {
    score = 50;
  } else if (dailyAvg > 0) {
    score = 30;
  }

  return {
    name: "Sleep",
    score: Math.round(score),
    dataPoints: hours > 0 ? Math.max(1, Math.round(hours / 8)) : 0,
    summary: hours > 0
      ? `${dailyAvg.toFixed(1)}h/night avg`
      : "No sleep data",
  };
}

function computeMoodScore(entries: number, days: number): HealthComponent {
  const coverage = entries / days;
  const score = Math.min(100, coverage * 100);

  return {
    name: "Mood",
    score: Math.round(score),
    dataPoints: entries,
    summary: entries > 0
      ? `${entries} day(s) tracked`
      : "No mood data",
  };
}

export function healthVitalityToMarkdown(report: HealthVitalityReport): string {
  const lines: string[] = [];

  lines.push(`# Health & Vitality — ${report.periodLabel}`);
  lines.push("");
  lines.push(`## Overall Score: ${report.overallScore}/100`);
  lines.push("");

  // Component scores
  lines.push("## Component Scores");
  lines.push("");
  lines.push("| Component | Score | Data Points | Summary |");
  lines.push("|-----------|-------|-------------|---------|");

  for (const [name, comp] of report.components) {
    lines.push(`| ${name} | ${comp.score}/100 | ${comp.dataPoints} | ${comp.summary} |`);
  }
  lines.push("");

  // Trends
  if (report.trends.length > 0) {
    lines.push("## Trends");
    lines.push("");
    for (const t of report.trends) {
      lines.push(`- ${t}`);
    }
    lines.push("");
  }

  // Diet details
  if (report.dietEntries.length > 0) {
    lines.push("## Recent Meals");
    lines.push("");
    for (const entry of report.dietEntries.slice(0, 10)) {
      const date = entry.date ? entry.date.split("T")[0] : "No date";
      lines.push(`- **[${date}]** ${entry.name}${entry.nutrition ? ` — ${entry.nutrition.substring(0, 80)}${entry.nutrition.length > 80 ? "..." : ""}` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
