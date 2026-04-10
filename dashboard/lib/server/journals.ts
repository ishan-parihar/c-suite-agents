import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// ─── Helpers ───────────────────────────────────────────────────────────────

function parsePgArray(value: string | string[] | null): string[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  // PostgreSQL native array format: {item1,item2,"item with,comma"}
  if (!value.startsWith("{") || !value.endsWith("}")) return [value];
  const inner = value.slice(1, -1);
  if (!inner) return [];
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.replace(/^"|"$/g, "").replace(/""/g, '"'));
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.replace(/^"|"$/g, "").replace(/""/g, '"'));
  return result;
}

// ─── Types ───────────────────────────────────────────────────────────────

export type JournalType = "subjective" | "relational" | "systemic" | "diet";

export type SubjectiveEntry = {
  id: string;
  name: string;
  date: Date | null;
  stressLevel: string | null;
  energyLevel: string | null;
  moodTrigger: string[] | null;
  psychograph: string | null;
};

export type RelationalEntry = {
  id: string;
  name: string;
  date: Date | null;
  interactionType: string | null;
  sentiment: string | null;
  followUpNeeded: boolean | null;
  relationshipStatus: string[] | null;
};

export type SystemicEntry = {
  id: string;
  name: string;
  date: Date | null;
  impact: string | null;
  aiGeneratedReport: string | null;
};

export type DietEntry = {
  id: string;
  name: string;
  date: Date | null;
  logType: string | null;
  mealType: string | null;
  calories: number | null;
  proteinG: number | null;
  waterMl: number | null;
  caffeineMg: number | null;
  mood: string | null;
  energyLevel: string | null;
  symptoms: string[] | null;
};

export type SubjectiveDetail = SubjectiveEntry & {
  subjectiveJson: string | null;
  sleepHours: string | null;
};

export type RelationalDetail = RelationalEntry & {
  relationalJson: string | null;
};

export type SystemicDetail = SystemicEntry & {
  systemicJson: string | null;
  projects: string[] | null;
  directivesRiskLog: string[] | null;
  opportunitiesStrengths: string[] | null;
};

export type DietDetail = DietEntry & {
  supplements: string[] | null;
  environment: string[] | null;
  vitalsNotes: string | null;
  sleepQuality: string | null;
  nutrition: string | null;
  dietJson: string | null;
};

export type JournalListEntry = SubjectiveEntry | RelationalEntry | SystemicEntry | DietEntry;
export type JournalDetailEntry = SubjectiveDetail | RelationalDetail | SystemicDetail | DietDetail;

// ─── List fetchers ───────────────────────────────────────────────────────

export async function getSubjectiveEntries(): Promise<SubjectiveEntry[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, date, stress_level, energy_level, mood_trigger, psychograph
      FROM subjective_journal
      ORDER BY date DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      date: r.date ? new Date(r.date) : null,
      stressLevel: r.stress_level,
      energyLevel: r.energy_level,
      moodTrigger: parsePgArray(r.mood_trigger),
      psychograph: r.psychograph,
    }));
  } catch {
    return [];
  }
}

export async function getRelationalEntries(): Promise<RelationalEntry[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, date, interaction_type, sentiment, follow_up_needed, relationship_status
      FROM relational_journal
      ORDER BY date DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      date: r.date ? new Date(r.date) : null,
      interactionType: r.interaction_type,
      sentiment: r.sentiment,
      followUpNeeded: r.follow_up_needed,
      relationshipStatus: parsePgArray(r.relationship_status),
    }));
  } catch {
    return [];
  }
}

export async function getSystemicEntries(): Promise<SystemicEntry[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, date, impact, ai_generated_report
      FROM systemic_journal
      ORDER BY date DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      date: r.date ? new Date(r.date) : null,
      impact: r.impact,
      aiGeneratedReport: r.ai_generated_report,
    }));
  } catch {
    return [];
  }
}

export async function getDietEntries(): Promise<DietEntry[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, date, log_type, meal_type, calories, protein_g,
             water_ml, caffeine_mg, mood, energy_level, symptoms
      FROM diet_log
      ORDER BY date DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      date: r.date ? new Date(r.date) : null,
      logType: r.log_type,
      mealType: r.meal_type,
      calories: r.calories,
      proteinG: r.protein_g != null ? Number(r.protein_g) : null,
      waterMl: r.water_ml,
      caffeineMg: r.caffeine_mg,
      mood: r.mood,
      energyLevel: r.energy_level,
      symptoms: parsePgArray(r.symptoms),
    }));
  } catch {
    return [];
  }
}

// ─── Unified list fetcher ────────────────────────────────────────────────

export async function getJournalEntries(type: JournalType): Promise<JournalListEntry[]> {
  switch (type) {
    case "subjective":
      return getSubjectiveEntries();
    case "relational":
      return getRelationalEntries();
    case "systemic":
      return getSystemicEntries();
    case "diet":
      return getDietEntries();
  }
}

// ─── Detail fetchers ─────────────────────────────────────────────────────

export async function getSubjectiveEntryDetail(id: string): Promise<SubjectiveDetail | null> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, date, stress_level, energy_level, mood_trigger, psychograph,
             subjective_json, sleep_hours
      FROM subjective_journal
      WHERE id = ${id}
      LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id,
      name: r.name,
      date: r.date ? new Date(r.date) : null,
      stressLevel: r.stress_level,
      energyLevel: r.energy_level,
      moodTrigger: parsePgArray(r.mood_trigger),
      psychograph: r.psychograph,
      subjectiveJson: r.subjective_json,
      sleepHours: r.sleep_hours,
    };
  } catch {
    return null;
  }
}

export async function getRelationalEntryDetail(id: string): Promise<RelationalDetail | null> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, date, interaction_type, sentiment, follow_up_needed, relationship_status,
             relational_json
      FROM relational_journal
      WHERE id = ${id}
      LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id,
      name: r.name,
      date: r.date ? new Date(r.date) : null,
      interactionType: r.interaction_type,
      sentiment: r.sentiment,
      followUpNeeded: r.follow_up_needed,
      relationshipStatus: parsePgArray(r.relationship_status),
      relationalJson: r.relational_json,
    };
  } catch {
    return null;
  }
}

export async function getSystemicEntryDetail(id: string): Promise<SystemicDetail | null> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, date, impact, ai_generated_report, systemic_json,
             projects, directives_risk_log, opportunities_strengths
      FROM systemic_journal
      WHERE id = ${id}
      LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id,
      name: r.name,
      date: r.date ? new Date(r.date) : null,
      impact: r.impact,
      aiGeneratedReport: r.ai_generated_report,
      systemicJson: r.systemic_json,
      projects: parsePgArray(r.projects),
      directivesRiskLog: parsePgArray(r.directives_risk_log),
      opportunitiesStrengths: parsePgArray(r.opportunities_strengths),
    };
  } catch {
    return null;
  }
}

export async function getDietEntryDetail(id: string): Promise<DietDetail | null> {
  try {
    const result = await db.execute(sql`
      SELECT id, name, date, log_type, meal_type, calories, protein_g,
             water_ml, caffeine_mg, mood, energy_level, symptoms,
             supplements, environment, vitals_notes, sleep_quality,
             nutrition, diet_json
      FROM diet_log
      WHERE id = ${id}
      LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id,
      name: r.name,
      date: r.date ? new Date(r.date) : null,
      logType: r.log_type,
      mealType: r.meal_type,
      calories: r.calories,
      proteinG: r.protein_g != null ? Number(r.protein_g) : null,
      waterMl: r.water_ml,
      caffeineMg: r.caffeine_mg,
      mood: r.mood,
      energyLevel: r.energy_level,
      symptoms: parsePgArray(r.symptoms),
      supplements: parsePgArray(r.supplements),
      environment: parsePgArray(r.environment),
      vitalsNotes: r.vitals_notes,
      sleepQuality: r.sleep_quality,
      nutrition: r.nutrition,
      dietJson: r.diet_json,
    };
  } catch {
    return null;
  }
}

// ─── Unified detail fetcher ──────────────────────────────────────────────

export async function getJournalEntryDetail(
  type: JournalType,
  id: string
): Promise<JournalDetailEntry | null> {
  switch (type) {
    case "subjective":
      return getSubjectiveEntryDetail(id);
    case "relational":
      return getRelationalEntryDetail(id);
    case "systemic":
      return getSystemicEntryDetail(id);
    case "diet":
      return getDietEntryDetail(id);
  }
}

// ─── Navigation helpers (prev/next by date) ──────────────────────────────

export async function getAdjacentEntries(
  type: JournalType,
  currentId: string
): Promise<{ prevId: string | null; nextId: string | null }> {
  const tableName =
    type === "subjective"
      ? "subjective_journal"
      : type === "relational"
        ? "relational_journal"
        : type === "systemic"
          ? "systemic_journal"
          : "diet_log";

  try {
    const dateResult = await db.execute(sql`
      SELECT date FROM ${sql.identifier(tableName)} WHERE id = ${currentId} LIMIT 1
    `);
    if (dateResult.rows.length === 0) return { prevId: null, nextId: null };
    const currentDate = (dateResult.rows[0] as any).date;

    const prevResult = await db.execute(sql`
      SELECT id FROM ${sql.identifier(tableName)}
      WHERE date < ${currentDate}
      ORDER BY date DESC
      LIMIT 1
    `);

    const nextResult = await db.execute(sql`
      SELECT id FROM ${sql.identifier(tableName)}
      WHERE date > ${currentDate}
      ORDER BY date ASC
      LIMIT 1
    `);

    return {
      prevId: prevResult.rows.length > 0 ? (prevResult.rows[0] as any).id : null,
      nextId: nextResult.rows.length > 0 ? (nextResult.rows[0] as any).id : null,
    };
  } catch {
    return { prevId: null, nextId: null };
  }
}
