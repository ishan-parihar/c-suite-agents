#!/usr/bin/env bun
/**
 * Notion JSON Backup → PostgreSQL Import Script
 *
 * Reads static JSON backups from notion-backup/ and imports into PostgreSQL
 * using the existing Drizzle schema. Handles FK resolution via notionId→pgUuid mapping.
 *
 * Usage:
 *   bun run scripts/migrate-notion-import.ts              # Full import
 *   bun run scripts/migrate-notion-import.ts --dry-run    # Preview counts only
 *   bun run scripts/migrate-notion-import.ts --db years   # Import only specific DBs
 *   bun run scripts/migrate-notion-import.ts --resume     # Skip already-imported rows
 *
 * Environment:
 *   DATABASE_URL       — PostgreSQL connection string
 *   NOTION_BACKUP_DIR  — Path to notion-backup directory (default: ../notion-backup)
 */

import "dotenv/config";
import { Client } from "pg";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const BACKUP_DIR = process.env.NOTION_BACKUP_DIR ?? resolve(PROJECT_ROOT, "../notion-backup");

const DRY_RUN = process.argv.includes("--dry-run");
const RESUME = process.argv.includes("--resume");
const dbFlagIndex = process.argv.indexOf("--db");
const FILTERED_DBS: string[] = dbFlagIndex >= 0
  ? process.argv[dbFlagIndex + 1]?.split(",").map((s) => s.trim()) ?? []
  : [];

// ── ID Mapping ──────────────────────────────────────────────────────────────

const notionToPg: Map<string, string> = new Map();
const existingNotionIds = new Set<string>();

async function generatePgId(notionId: string): Promise<string> {
  const existing = notionToPg.get(notionId);
  if (existing) return existing;
  const pgId = crypto.randomUUID();
  notionToPg.set(notionId, pgId);
  return pgId;
}

function resolveNotionIds(ids: string[]): string[] {
  const resolved: string[] = [];
  for (const nid of ids) {
    const pgId = notionToPg.get(nid);
    if (pgId) resolved.push(pgId);
  }
  return resolved;
}

// ── Property Helpers ────────────────────────────────────────────────────────

function getStr(row: any, key: string): string | null {
  const v = row[key];
  return (typeof v === "string" && v.trim() !== "") ? v.trim() : null;
}

function getNum(row: any, key: string): number | null {
  const v = row[key];
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function getBool(row: any, key: string): boolean | null {
  const v = row[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v === "true" || v === "Yes" || v === "✓") return true;
    if (v === "false" || v === "No" || v === "✗") return false;
  }
  return null;
}

function getArr(row: any, key: string): string[] {
  const v = row[key];
  if (Array.isArray(v)) return v.filter((x: any) => x != null && x !== "");
  return [];
}

function getTs(row: any, key: string): Date | null {
  const v = row[key];
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function getDate(row: any, key: string): string | null {
  const v = row[key];
  if (!v) return null;
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

// ── Table Migrations ────────────────────────────────────────────────────────

interface TableMigration {
  name: string;
  dbFile: string;
  transform: (row: any, idx: number) => Record<string, any> | null;
  conflictCols: string[];
}

function makeMigrations(): TableMigration[] {
  return [
    // TIER 0: No FK dependencies
    {
      name: "years",
      dbFile: "years.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Years") ?? getStr(r, "Year Range") ?? r.notion_id,
        annual_goals: getArr(r, "Annual Goals"),
        quarters: getArr(r, "Quarters"),
        quarterly_goals: getArr(r, "Quarterly Goals"),
        status: getStr(r, "Status"),
        year_range: getStr(r, "Year Range"),
        year_report: getStr(r, "Year_Report"),
      }),
    },
    {
      name: "weeks",
      dbFile: "weeks.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Week") ?? r.notion_id,
        days: getArr(r, "Days"),
        tasks: getArr(r, "Tasks"),
        financial_log: getArr(r, "Financial Log"),
        year: getNum(r, "Year"),
        week_number: getNum(r, "Week Number"),
        week_name: getStr(r, "Week Name"),
        week_range: getStr(r, "Week Range"),
        week_start: getTs(r, "Week Start"),
        week_end: getTs(r, "Week End"),
        week_json: getStr(r, "Week_JSON"),
        status: getStr(r, "Status"),
        tasks_progress: getStr(r, "Tasks Progress"),
        activity_breakdown: getStr(r, "activityBreakdown"),
        total_income: getNum(r, "Total Income"),
        total_expenses: getNum(r, "Total Expenses"),
        net_cashflow: getNum(r, "Net Cashflow"),
        category_summary: getStr(r, "Category Summary"),
        key_learnings: getStr(r, "Key Learnings"),
      }),
    },
    {
      name: "financial_accounts",
      dbFile: "financial_accounts.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Account Name") ?? getStr(r, "Name") ?? r.notion_id,
        institution: getStr(r, "Institution"),
        status: getStr(r, "Status"),
        type: getArr(r, "Type"),
        capital_engine: getStr(r, "Capital Engine"),
        currency: getStr(r, "Currency"),
        current_balance: getNum(r, "Current Balance"),
        interest_rate: getNum(r, "Interest Rate"),
        balance_as_of: getTs(r, "Balance As Of"),
        related_statements: getStr(r, "Related Statements"),
        related_transactions: getStr(r, "Related Transactions"),
        last_updated: getTs(r, "Last Updated"),
        current_status: getNum(r, "Current Status"),
        active_range: getStr(r, "Active Range"),
        financial_logs: getArr(r, "Financial Log"),
      }),
    },
    {
      name: "activity_types",
      dbFile: "activity_types.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Activity Type") ?? getStr(r, "Name") ?? r.notion_id,
        activity_log: getArr(r, "Activity Log"),
        frequency: getStr(r, "Frequency"),
        duration_hrs: getNum(r, "Duration"),
        target_per_week: getNum(r, "Target per Week"),
        is_habit: getBool(r, "Habit"),
        is_health_tracked: getBool(r, "Health Tracked"),
        category: getStr(r, "Category"),
      }),
    },
    {
      name: "people",
      dbFile: "people.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Name") ?? r.notion_id,
        first_name: getStr(r, "First Name"),
        custom_name: getStr(r, "Custom Name"),
        summary: getStr(r, "Summary"),
        strategic_context: getStr(r, "Strategic Context"),
        engagement_blueprint: getStr(r, "Engagement Blueprint"),
        professional_domain: getStr(r, "Professional Domain"),
        origin_context: getStr(r, "Origin Context"),
        key_personal_intel: getStr(r, "Key Personal Intel"),
        email: getStr(r, "email"),
        connection_frequency_days: getNum(r, "Connection Frequency"),
        last_connected_date: getTs(r, "Last Connected Date"),
        reconnect_by: getStr(r, "Reconnect By"),
        networking_profile: getStr(r, "Networking Profile"),
        relationship_status: getStr(r, "Relationship Status"),
        value_exchange_balance: getStr(r, "Value Exchange Balance"),
        core_shadow: getStr(r, "Core Shadow"),
        developmental_altitude: getStr(r, "Developmental Altitude"),
        aspirational_drive: getStr(r, "Aspirational Drive"),
        temporal_focus: getStr(r, "Temporal Focus"),
        primary_center_of_intelligence: getStr(r, "Primary Center of Intelligence"),
        dominant_power_strategy: getStr(r, "Dominant Power Strategy"),
        city: getStr(r, "City"),
        primary_conflict_style: getStr(r, "Primary Conflict Style"),
        timezone: getStr(r, "Timezone"),
        desired_trajectory: getStr(r, "Desired Trajectory"),
        stability_profile: getStr(r, "Stability Profile"),
        last_interaction_sentiment: getStr(r, "Last Interaction Sentiment"),
        explanatory_style: getStr(r, "Explanatory Style"),
        influence_toolkit: getArr(r, "Influence Toolkit"),
        community_id: getArr(r, "Community")[0] ?? null,
        stories: getArr(r, "Stories"),
        projects: getArr(r, "Projects"),
      }),
    },
    // TIER 1: Depends on Tier 0
    {
      name: "quarters",
      dbFile: "quarters.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Quarters") ?? r.notion_id,
        years_id: getArr(r, "Years")[0] ?? null,
        months: getArr(r, "Months"),
        quarterly_goals: getArr(r, "Quarterly Goals"),
        quarter_number: getNum(r, "Quarter Number"),
        quarter_start: getTs(r, "Quarter Start"),
        quarter_end: getTs(r, "Quarter End"),
        quarter_range: getStr(r, "Quarter Range"),
        quarter_name: getStr(r, "Quarter Name"),
        quarter_report: getStr(r, "Quarter_Report"),
        status: getStr(r, "Status"),
        total_income: getNum(r, "Total Income"),
        total_expenses: getNum(r, "Total Expenses"),
        net_cashflow: getNum(r, "Net Cashflow"),
        category_summary: getStr(r, "Category Summary"),
        key_learnings: getStr(r, "Key Learnings"),
      }),
    },
    {
      name: "annual_goals",
      dbFile: "annual_goals.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Annual Theme") ?? r.notion_id,
        goal_id: getStr(r, "ID"),
        years_id: getArr(r, "Years")[0] ?? null,
        primary_metric_id: getArr(r, "Primary Metric")[0] ?? null,
        vision_id: getArr(r, "Vision")[0] ?? null,
        quarterly_goals: getArr(r, "Quarterly Goals"),
        status: getStr(r, "Status") ?? "Draft",
        goal_archetype: getStr(r, "Goal Archetype"),
        is_current_goal: getBool(r, "Current Annual Goal"),
        goal_progress: getStr(r, "Goal Progress"),
        monitor: getStr(r, "Monitor"),
        annual_goal_report: getStr(r, "Annual_Goal_Report"),
        planned_range: getStr(r, "Planned Range"),
        the_epic: getStr(r, "The Epic"),
        strategic_intent: getStr(r, "Strategic Intent"),
        strategic_approach: getStr(r, "Strategic Approach"),
        success_condition: getStr(r, "Success Condition"),
        key_risks: getStr(r, "Key Risks"),
        target_value: getStr(r, "Target Value"),
      }),
    },
    // TIER 2
    {
      name: "months",
      dbFile: "months.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Month") ?? r.notion_id,
        quarters_id: getArr(r, "Quarters")[0] ?? null,
        days: getArr(r, "Days"),
        financial_log: getArr(r, "Financial Log"),
        quarterly_goals: getArr(r, "Quarterly Goals"),
        year: getNum(r, "Year"),
        month_number: getNum(r, "Month Number"),
        month_name: getStr(r, "Month Name"),
        month_range: getStr(r, "Month Range"),
        month_start: getTs(r, "Month Start"),
        month_end: getTs(r, "Month End"),
        month_json: getStr(r, "Month_JSON"),
        status: getStr(r, "Status"),
        total_income: getNum(r, "Total Income"),
        total_expenses: getNum(r, "Total Expenses"),
        net_cashflow: getNum(r, "Net Cashflow"),
        category_summary: getStr(r, "Category Summary"),
        ending_net_worth: getNum(r, "Ending Net Worth"),
        net_worth_change: getNum(r, "Net Worth Change"),
        accounts_involved: getArr(r, "Accounts Involved"),
        projects_active: getStr(r, "Projects"),
        cashflow_narrative: getStr(r, "Cashflow Narrative"),
        capital_allocation_insight: getStr(r, "Capital Allocation Insight"),
        accounts_snapshot: getStr(r, "Accounts Snapshot"),
        key_learnings: getStr(r, "Key Learnings"),
        significant_events: getStr(r, "Significant Events"),
      }),
    },
    {
      name: "quarterly_goals",
      dbFile: "quarterly_goals.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Quarterly Objective") ?? r.notion_id,
        goal_id: getStr(r, "ID"),
        annual_goal_id: getArr(r, "Annual Goals")[0] ?? null,
        quarters: getArr(r, "Quarters"),
        projects: getArr(r, "Projects"),
        directives_risk_log: getArr(r, "Directives & Risk Log"),
        opportunities_strengths: getArr(r, "Opportunities & Strengths Log"),
        status: getStr(r, "Status") ?? "Planning",
        is_current_goal: getBool(r, "Current Quarter Goal"),
        goal_progress: getStr(r, "Goal Progress"),
        progress: getNum(r, "Progress"),
        health: getStr(r, "Health"),
        monitor: getStr(r, "Monitor"),
        planned_range: getStr(r, "Planned Range"),
        quarterly_goal_json: getStr(r, "Quarterly_Goal_JSON"),
        key_result_1: getStr(r, "Key Result 1"),
        key_result_2: getStr(r, "Key Result 2"),
        key_result_3: getStr(r, "Key Result 3"),
        key_learning: getStr(r, "Key Learning"),
      }),
    },
    // TIER 3
    {
      name: "days",
      dbFile: "days.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Days") ?? r.notion_id,
        months_id: getArr(r, "Months")[0] ?? null,
        weeks: getArr(r, "Weeks"),
        diet_log: getArr(r, "Diet Log"),
        subjective_journal: getArr(r, "Subjective Journal"),
        relational_journal: getArr(r, "Relational Journal"),
        systemic_journal: getArr(r, "Systemic Journal"),
        activity_log: getArr(r, "Related to Activity Log"),
        year: getNum(r, "Year"),
        day_number: getNum(r, "Day Number"),
        health_score: getNum(r, "health_score"),
        date: getDate(r, "Date"),
        day_name: getStr(r, "Day Name"),
        day_json: getStr(r, "Day_JSON"),
        status: getStr(r, "Status"),
      }),
    },
    {
      name: "projects",
      dbFile: "projects.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Project") ?? r.notion_id,
        project_id: getStr(r, "ID"),
        status: getStr(r, "Status") ?? "On Hold",
        phase: getStr(r, "phase"),
        priority: getStr(r, "Priority"),
        team: getArr(r, "team"),
        project_start: getTs(r, "Project Start"),
        deadline: getTs(r, "Deadline"),
        review_date: getTs(r, "Review Date"),
        budget_allocated: getNum(r, "budget_allocated"),
        budget_spent: getNum(r, "budget_spent"),
        required_budget: getNum(r, "Required Budget"),
        projected_revenue: getNum(r, "Projected Revenue"),
        project_summary: getStr(r, "Project Summary"),
        justification: getStr(r, "Justify This Project"),
        kpi: getStr(r, "KPI"),
        kpi_status: getStr(r, "KPI Status"),
        strategy: getStr(r, "Strategy"),
        quarterly_goal_id: getArr(r, "Quarterly Goals")[0] ?? null,
        tasks: getArr(r, "Tasks"),
        depends_on: getArr(r, "Depends On"),
        dependents: getArr(r, "Dependents"),
        people: getArr(r, "People"),
        campaigns: getArr(r, "Campaign Calendar"),
        activity_log: getArr(r, "Activity Log"),
        financial_log: getArr(r, "Financial Log"),
        systemic_journal: getArr(r, "Systemic Journal"),
        documents: getArr(r, "Documents DB"),
        notes: getArr(r, "Notes Management"),
        directives_risks: getArr(r, "Directives & Risks"),
        opportunities: getArr(r, "Opportunities & Strength"),
        health: getStr(r, "Health"),
        monitor: getStr(r, "Monitor"),
        progress: getNum(r, "Progress"),
        project_json: getStr(r, "Project_JSON"),
        project_progress: getStr(r, "Project Progress"),
        duration_days: getStr(r, "Duration"),
        cost_to_date: getNum(r, "Cost to Date"),
        last_edited_at: getTs(r, "Last edited time"),
      }),
    },
    // TIER 4
    {
      name: "tasks",
      dbFile: "tasks.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Tasks") ?? r.notion_id,
        task_id: getStr(r, "ID"),
        status: getStr(r, "Status") ?? "Up Next",
        parent_task_id: getArr(r, "Parent task")[0] ?? null,
        sub_task_id: getArr(r, "Sub-task")[0] ?? null,
        project_id: getArr(r, "Projects")[0] ?? null,
        week_id: getArr(r, "Weeks")[0] ?? null,
        blocks: getArr(r, "Blocks"),
        blocked_by: getArr(r, "blocked_by")[0] ?? null,
        priority: getStr(r, "Priority"),
        assignee: getStr(r, "Assignee"),
        tags: getArr(r, "tags"),
        action_date: getTs(r, "Action Date"),
        completed_date: getTs(r, "completed_date"),
        estimated_hours: getNum(r, "estimated_hours"),
        description: getStr(r, "Description"),
        sprint_status: getStr(r, "Sprint Status"),
        monitor: getStr(r, "Monitor"),
        project_status: getStr(r, "Project Status"),
        last_edited_at: getTs(r, "Last edited time"),
      }),
    },
    {
      name: "activity_log",
      dbFile: "activity_log.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Name") ?? r.notion_id,
        activity_id: getStr(r, "ID"),
        activity_type_id: getArr(r, "activity_type_rel")[0] ?? null,
        days_id: getArr(r, "Days")[0] ?? null,
        projects: getArr(r, "Projects"),
        energy: getStr(r, "energy"),
        mood_delta: getStr(r, "mood_delta"),
        date_range: getTs(r, "Date"),
        date_end: getTs(r, "Date End"),
        duration_hrs: getNum(r, "Duration"),
        activity_type: getStr(r, "Activity Type"),
        activity_notes: getStr(r, "Activity Notes"),
        activity_json: getStr(r, "Activity_JSON"),
        is_habit_activity: getBool(r, "Habit"),
        is_logged: getBool(r, "Logged"),
        notes_body: getStr(r, "notes_body"),
      }),
    },
    {
      name: "subjective_journal",
      dbFile: "subjective_journal.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Subjective Journal") ?? r.notion_id,
        entry_id: getStr(r, "ID"),
        date: getTs(r, "Date"),
        days_id: getArr(r, "Days")[0] ?? null,
        sleep_hours: getNum(r, "Sleep Hours"),
        stress_level: getStr(r, "Stress Level"),
        energy_level: getStr(r, "Energy Level"),
        mood_trigger: getArr(r, "Mood Trigger"),
        psychograph: getStr(r, "Psychograph"),
        subjective_json: getStr(r, "Subjective_JSON"),
      }),
    },
    {
      name: "relational_journal",
      dbFile: "relational_journal.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Relational Journal") ?? r.notion_id,
        entry_id: getStr(r, "ID"),
        date: getTs(r, "Date"),
        days_id: getArr(r, "Days")[0] ?? null,
        people_id: getArr(r, "People")[0] ?? null,
        interaction_type: getStr(r, "Interaction Type"),
        sentiment: getStr(r, "Sentiment"),
        follow_up_needed: getBool(r, "Follow Up Needed"),
        relationship_status: getArr(r, "Relationship Status"),
        relational_json: getStr(r, "Relational_JSON"),
      }),
    },
    {
      name: "systemic_journal",
      dbFile: "systemic_journal.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Systemic Journal") ?? r.notion_id,
        entry_id: getStr(r, "ID"),
        date: getTs(r, "Date"),
        created_time: getTs(r, "created_time"),
        days_id: getArr(r, "Days")[0] ?? null,
        impact: getStr(r, "Impact"),
        projects: getArr(r, "Projects"),
        directives_risk_log: getArr(r, "Directives & Risk Log"),
        opportunities_strengths: getArr(r, "Opportunities & Strengths Log"),
        ai_generated_report: getStr(r, "AI Generated Report"),
        systemic_json: getStr(r, "Systemic_JSON"),
      }),
    },
    {
      name: "diet_log",
      dbFile: "diet_log.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Name") ?? r.notion_id,
        entry_id: getStr(r, "ID"),
        date: getTs(r, "Date"),
        log_type: getStr(r, "Log Type"),
        meal_type: getStr(r, "Meal Type"),
        calories: getNum(r, "Calories"),
        nutrition: getStr(r, "Nutrition"),
        protein_g: getNum(r, "Protein (g)"),
        water_ml: getNum(r, "Water (ml)"),
        caffeine_mg: getNum(r, "Caffeine (mg)"),
        supplements: getArr(r, "Supplements"),
        mood: getStr(r, "Mood"),
        energy_level: getStr(r, "Energy Level"),
        sleep_quality: getStr(r, "Sleep Quality"),
        symptoms: getArr(r, "Symptoms"),
        environment: getArr(r, "Environment"),
        vitals_notes: getStr(r, "Vitals Notes"),
        diet_json: getStr(r, "Diet_JSON"),
        days_id: getArr(r, "Days")[0] ?? null,
      }),
    },
    {
      name: "directives_risk_log",
      dbFile: "directives_risk_log.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Name") ?? r.notion_id,
        entry_id: getStr(r, "ID"),
        log_type: getStr(r, "Log Type"),
        status: getStr(r, "Status") ?? "Identified",
        likelihood: getStr(r, "Likelihood"),
        impact: getStr(r, "Impact"),
        threat_level: getStr(r, "Threat Level"),
        protocol_scenario: getStr(r, "Protocol/Scenario"),
        last_assessed: getTs(r, "Last Assessed"),
        drl_json: getStr(r, "DRL_JSON"),
        projects: getArr(r, "Projects"),
        quarterly_goal_id: getArr(r, "Quarterly Goals")[0] ?? null,
        systemic_journal: getArr(r, "Systemic Journal"),
        mitigates: getArr(r, "Mitigates"),
      }),
    },
    {
      name: "opportunities_strengths",
      dbFile: "opportunities_strengths_log.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Name") ?? r.notion_id,
        log_type: getStr(r, "Log Type"),
        status: getStr(r, "Status") ?? "Identified",
        leverage_score: getStr(r, "Leverage Score"),
        opportunity_type: getStr(r, "Opportunity Type"),
        description: getStr(r, "Description"),
        last_assessed: getTs(r, "Last Assessed"),
        activation_date: getTs(r, "Activation Date"),
        projects: getArr(r, "Projects"),
        quarterly_goal_id: getArr(r, "Quarterly Goals")[0] ?? null,
        systemic_journal: getArr(r, "Systemic Journal"),
        synergizes_with: getArr(r, "Synergizes With"),
      }),
    },
    {
      name: "notes_management",
      dbFile: "notes_management.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Notes Management") ?? r.notion_id,
        status: getStr(r, "Status") ?? "New Note",
        agent: getStr(r, "Agent"),
        agent_secondary: getStr(r, "Agent Secondary"),
        report: getStr(r, "Report"),
        report_extra: getStr(r, "Report Extra"),
        project_id: getArr(r, "Projects")[0] ?? null,
        project_status: getStr(r, "Project Status"),
        knowledge_categories: getArr(r, "Knowledge Categories"),
        created_time: getTs(r, "created_time"),
        last_edited_at: getTs(r, "last_edited_time"),
      }),
    },
    // TIER 5
    {
      name: "financial_log",
      dbFile: "financial_log.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Name") ?? r.notion_id,
        transaction_id: getStr(r, "ID"),
        date: getTs(r, "Date"),
        signed_amount: getNum(r, "Amount"),
        category: getStr(r, "Category"),
        capital_engine: getStr(r, "Capital Engine"),
        is_recurring: getBool(r, "recurring"),
        receipt_files: (() => {
          const v = r["Receipt/Document"];
          return Array.isArray(v) ? v : null;
        })(),
        receipt_url: getStr(r, "receipt_url"),
        notes: getStr(r, "Notes"),
        is_financial: getBool(r, "Is Financial?"),
        legacy_amount: getStr(r, "Amount (raw)"),
        financial_elater: getStr(r, "Financial Relater"),
        transaction_type: getStr(r, "Transaction Type"),
        financial_json: getStr(r, "Financial_JSON"),
        week_id: getArr(r, "Weeks")[0] ?? null,
        month_id: getArr(r, "Months")[0] ?? null,
        project_id: getArr(r, "Projects")[0] ?? null,
        account_id: getArr(r, "Financial Accounts")[0] ?? null,
      }),
    },
    {
      name: "campaigns",
      dbFile: "campaign_management.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Campaign Name") ?? getStr(r, "Name") ?? r.notion_id,
        campaign_id: getStr(r, "ID"),
        status: getStr(r, "Status"),
        start_date: getTs(r, "Start Date"),
        end_date: getTs(r, "End Date"),
        duration_days: getNum(r, "Duration"),
        platforms: getArr(r, "Platforms"),
        content_types: getArr(r, "Content Types"),
        automation_workflows: getArr(r, "Automation Workflows"),
        content_frequency: getStr(r, "Content Frequency"),
        theme: getStr(r, "Theme"),
        summary: getStr(r, "Summary"),
        demographics: getStr(r, "Demographics"),
        psychographics: getStr(r, "Psychographics"),
        seo_keywords: getStr(r, "SEO Keywords"),
        content_waterfall: getStr(r, "Content Waterfall"),
        target_reach: getNum(r, "Target Reach"),
        actual_reach: getNum(r, "Actual Reach"),
        engagement_rate: getNum(r, "Engagement Rate"),
        conversion_rate: getNum(r, "Conversion Rate"),
        viral_score: getNum(r, "Viral Score"),
        budget_allocated: getNum(r, "Budget Allocated"),
        projects: getArr(r, "Projects"),
        content_pipeline: getArr(r, "Content Pipeline"),
      }),
    },
    {
      name: "content_pipeline",
      dbFile: "content_pipeline.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Content Name") ?? getStr(r, "Name") ?? r.notion_id,
        content_id: getStr(r, "ID"),
        status: getStr(r, "Status") ?? "Potential Idea",
        pillar: getStr(r, "Pillar"),
        funnel_stage: getStr(r, "Funnel Stage"),
        tone: getStr(r, "Tone"),
        platforms: getArr(r, "Platforms"),
        format: getArr(r, "Format"),
        is_evergreen: getBool(r, "Evergreen"),
        action_date: getTs(r, "Action Date"),
        publish_date: getTs(r, "Publish Date"),
        parent_content_id: getArr(r, "Parent Content")[0] ?? null,
        child_content: getArr(r, "Child Content"),
        campaign_id: getArr(r, "Campaign")[0] ?? null,
        projects: getArr(r, "Projects"),
        topic_hook: getStr(r, "Topic Hook"),
        content_body: getStr(r, "Content Body"),
        live_url: getStr(r, "Live URL"),
        media_assets: (() => {
          const v = r["Media Assets"];
          return Array.isArray(v) ? v : (typeof v === "string" ? v : null);
        })(),
        reach: getNum(r, "Reach"),
        engagement: getNum(r, "Engagement"),
        clicks: getNum(r, "Clicks"),
        engagement_rate: getNum(r, "Engagement Rate"),
      }),
    },
    {
      name: "reports",
      dbFile: "reports.json",
      conflictCols: ["id"],
      transform: (r) => ({
        data_source_id: r.notion_id,
        name: getStr(r, "Reports") ?? getStr(r, "Name") ?? r.notion_id,
        report_id: getStr(r, "ID"),
        agent: getStr(r, "Agent"),
        report_type: getStr(r, "Report Type"),
        period_covered: getTs(r, "Period Covered"),
        report: getStr(r, "Report"),
        created_time: getTs(r, "created_time"),
      }),
    },
  ];
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(70));
  console.log("Notion JSON → PostgreSQL Import");
  console.log("=".repeat(70));
  console.log(`Backup dir: ${BACKUP_DIR}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Resume: ${RESUME}`);
  console.log(`Started: ${new Date().toISOString()}`);

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL required");
    process.exit(1);
  }

  const dbDir = resolve(String(BACKUP_DIR), "notion/databases");
  const manifestPath = resolve(String(BACKUP_DIR), "notion/manifest.json");

  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  console.log(`\nManifest: ${manifest.total_databases} databases, ${manifest.total_rows} rows`);

  if (RESUME) {
    console.log("\nLoading existing notion_ids from PostgreSQL...");
  }

  const client = new Client(DATABASE_URL);
  await client.connect();
  await client.query("SET SESSION app.current_agent_id = 'migration'");

  try {
    // Build existing data_source_id set for resume mode
    if (RESUME) {
      const tables = manifest.databases.map((d: any) => d.normalized_name);
      for (const tbl of tables) {
        try {
          const res = await client.query(`SELECT data_source_id FROM "${tbl}"`);
          for (const row of res.rows) {
            existingNotionIds.add(row.data_source_id);
          }
        } catch {
          // Table might not exist yet or have no rows
        }
      }
      console.log(`  Found ${existingNotionIds.size} existing data_source_ids to skip`);
    }

    const migrations = makeMigrations();

    // Filter if requested
    const active = FILTERED_DBS.length > 0
      ? migrations.filter((m) => FILTERED_DBS.includes(m.name))
      : migrations;

    // Pre-scan ALL tables to build global notionToPg map for cross-table FK resolution
    console.log("\n🔗 Building global ID map across all tables...");
    for (const mig of active) {
      const filePath = resolve(dbDir, mig.dbFile);
      try {
        const rows = JSON.parse(await readFile(filePath, "utf-8"));
        for (const row of rows) {
          if (row.notion_id && !notionToPg.has(row.notion_id)) {
            notionToPg.set(row.notion_id, crypto.randomUUID());
          }
        }
      } catch { /* file not found, skip */ }
    }
    console.log(`  ${notionToPg.size} unique notion IDs mapped`);

    const stats: Array<{ table: string; inserted: number; skipped: number; errors: number; duration: number }> = [];
    const startTime = Date.now();

    for (const mig of active) {
      const filePath = resolve(dbDir, mig.dbFile);
      let rows: any[];
      try {
        rows = JSON.parse(await readFile(filePath, "utf-8"));
      } catch {
        console.log(`  ⏭️  ${mig.dbFile} not found — skipping`);
        stats.push({ table: mig.name, inserted: 0, skipped: 0, errors: 0, duration: 0 });
        continue;
      }

      const t0 = Date.now();
      console.log(`\n📥 Importing ${mig.name} (${rows.length} rows)...`);

      if (DRY_RUN) {
        console.log(`    [DRY RUN] Would import ${rows.length} rows`);
        stats.push({ table: mig.name, inserted: rows.length, skipped: 0, errors: 0, duration: 0 });
        continue;
      }

      // Drop existing notion_id column for clean re-import (notion_id is stored as data_source_id)
      if (RESUME) {
        console.log(`    [RESUME] Skipping ${existingNotionIds.size} already-imported rows`);
      }

      let inserted = 0;
      let skipped = 0;
      let errors = 0;
      const batchSize = 50;

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const colNames = new Set<string>();
        const rowValues: Record<string, any[]>[] = [];

        for (const row of batch) {
          if (RESUME && existingNotionIds.has(row.notion_id)) {
            skipped++;
            continue;
          }

          const transformed = mig.transform(row, i);
          if (!transformed) {
            skipped++;
            continue;
          }

          const pgId = notionToPg.get(row.notion_id)!;
          const vals: Record<string, any> = { id: pgId };
          for (const [key, val] of Object.entries(transformed)) {
            // Resolve single FK reference (notion_id string → PG UUID)
            if (typeof val === "string" && val.includes("-") && notionToPg.has(val)) {
              vals[key] = notionToPg.get(val);
            }
            // Resolve array of FK references
            else if (Array.isArray(val) && val.length > 0) {
              if (typeof val[0] === "string" && val[0].includes("-")) {
                vals[key] = resolveNotionIds(val);
              } else if (typeof val[0] === "object" && val[0]?.type === "relation") {
                const allIds: string[] = [];
                for (const item of val) {
                  if (Array.isArray(item.relation)) {
                    allIds.push(...item.relation.map((r: any) => r.id).filter(Boolean));
                  }
                }
                vals[key] = allIds.length > 0 ? resolveNotionIds(allIds) : [];
              } else if (typeof val[0] === "object" && val[0]?.id) {
                vals[key] = resolveNotionIds(val.map((v: any) => v.id));
              } else {
                vals[key] = val;
              }
            } else {
              vals[key] = val;
            }
          }

          for (const k of Object.keys(vals)) colNames.add(k);
          rowValues.push(vals);
        }

        if (rowValues.length === 0) continue;

        const cols = Array.from(colNames);
        const placeholders = rowValues.map((_, ri) =>
          `(${cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(", ")})`
        ).join(", ");

        const flatValues: any[] = [];
        for (const rv of rowValues) {
          for (const col of cols) {
            flatValues.push(rv[col] ?? null);
          }
        }

        const conflictClause = mig.conflictCols.length > 0
          ? `ON CONFLICT (${mig.conflictCols.map((c) => `"${c}"`).join(", ")}) DO NOTHING`
          : "";

        const sql = `
          INSERT INTO "${mig.name}" (${cols.map((c) => `"${c}"`).join(", ")})
          VALUES ${placeholders}
          ${conflictClause}
        `;

        try {
          const result = await client.query(sql, flatValues);
          inserted += result.rowCount ?? rowValues.length;
        } catch (e: any) {
          console.error(`    ❌ Batch ${Math.floor(i / batchSize) + 1}: ${e.message?.substring(0, 300)}`);
          errors++;
          skipped += rowValues.length;
        }
      }

      const duration = Date.now() - t0;
      console.log(`    ✅ ${inserted} inserted, ${skipped} skipped, ${errors} errors (${(duration / 1000).toFixed(1)}s)`);
      stats.push({ table: mig.name, inserted, skipped, errors, duration });
    }

    // Summary
    const totalDuration = Date.now() - startTime;
    const totalInserted = stats.reduce((s, st) => s + st.inserted, 0);
    const totalSkipped = stats.reduce((s, st) => s + st.skipped, 0);
    const totalErrors = stats.reduce((s, st) => s + st.errors, 0);

    console.log("\n" + "=".repeat(70));
    console.log("IMPORT COMPLETE");
    console.log("=".repeat(70));
    console.log(`Tables processed: ${stats.length}`);
    console.log(`Total rows inserted: ${totalInserted}`);
    console.log(`Total rows skipped: ${totalSkipped}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log(`Duration: ${(totalDuration / 1000).toFixed(1)}s`);
    console.log("\nPer-table summary:");
    for (const st of stats) {
      const status = st.errors > 0 ? "⚠️" : "✅";
      console.log(`  ${status} ${st.table.padEnd(30)} ${st.inserted} inserted, ${st.skipped} skipped`);
    }
    console.log("=".repeat(70));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("\n❌ Fatal error:", e.message);
  if (e.stack) console.error(e.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
});
