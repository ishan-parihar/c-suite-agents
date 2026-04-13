import { z } from "zod";
import type { PostgresClient } from "./postgres/client.js";
import type { Filters, QueryOptions } from "./postgres/types.js";
import type { OperantConfig, AgentDomain, TableConfig } from "./config.js";
import { resolveDates } from "./transformers/dates.js";
import { transformActivity, activitiesToMarkdown } from "./transformers/activity-pg.js";
import { transformTask, tasksToMarkdown } from "./transformers/tasks-pg.js";
import {
  transformProject, transformQuarterlyGoal, transformAnnualGoal,
  transformDirectiveRisk, transformOpportunityStrength,
  projectsToMarkdown, quarterlyGoalsToMarkdown, annualGoalsToMarkdown,
  directivesRisksToMarkdown, opportunitiesStrengthsToMarkdown,
} from "./transformers/strategic-pg.js";
import {
  loadActivityTargetsPg, computePeriodMetrics, computeBaseline,
  computeDeviation, computeTrend, mapTrajectory,
} from "./transformers/temporal.js";
import {
  computeWeekdayProfiles, detectAnomalies, suggestDayPlan,
  weekdayProfileToMarkdown, weekdayOverviewToMarkdown,
} from "./transformers/weekday-profiles.js";
import {
  computeHealthVitality, healthVitalityToMarkdown,
} from "./transformers/health-vitality.js";
import {
  computeFinancialProductivity, financialProductivityToMarkdown,
} from "./transformers/financial-productivity.js";
import {
  computeProductivityReport, productivityReportToMarkdown,
} from "./transformers/productivity.js";

// ─── Types ───

type Row = Record<string, unknown>;
type ToolResult = { content: Array<{ type: "text"; text: string }> };
const ok = (text: string): ToolResult => ({ content: [{ type: "text" as const, text }] });

// ─── DB Keys ───

const DB_KEYS = [
  "activity_log", "tasks", "days", "weeks", "months", "activity_types", "reports", "notes_management",
  "subjective_journal", "relational_journal", "systemic_journal", "financial_log", "diet_log", "financial_accounts",
  "quarters", "years", "projects", "quarterly_goals", "annual_goals",
  "directives_risk_log", "opportunities_strengths", "people", "campaigns", "content_pipeline",
] as const;
type DbKey = (typeof DB_KEYS)[number];

// ─── Date Helpers ───

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "No date";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.split("T")[0];
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(dateStr: string): string {
  if (!dateStr) return "No date";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.split("T")[0];
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function daysAgo(dateStr: string): number {
  if (!dateStr) return 999;
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return 999;
  return Math.floor((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function safeStr(v: unknown): string {
  return v != null ? String(v) : "";
}

function safeArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ─── Filter Helpers ───

function buildDateFilter(dateFrom?: string, dateTo?: string, dateColumn = "date"): Filters {
  const filters: Filters = {};
  if (dateFrom && dateTo) {
    filters[dateColumn] = { gte: dateFrom, lte: dateTo };
  } else if (dateFrom) {
    filters[dateColumn] = { gte: dateFrom };
  } else if (dateTo) {
    filters[dateColumn] = { lte: dateTo };
  }
  return filters;
}

// ─── Layer Map ───

const LAYER_MAP: Record<string, { table: string; titleCol: string; dateCol: string }> = {
  subjective_journal: { table: "subjective_journal", titleCol: "title", dateCol: "date" },
  relational_journal: { table: "relational_journal", titleCol: "title", dateCol: "date" },
  systemic_journal: { table: "systemic_journal", titleCol: "title", dateCol: "date" },
  financial_log: { table: "financial_log", titleCol: "title", dateCol: "date" },
  diet_log: { table: "diet_log", titleCol: "title", dateCol: "date" },
  activity_log: { table: "activity_log", titleCol: "name", dateCol: "date" },
  tasks: { table: "tasks", titleCol: "name", dateCol: "actionDate" },
  projects: { table: "projects", titleCol: "name", dateCol: "deadline" },
  quarterly_goals: { table: "quarterly_goals", titleCol: "name", dateCol: "startDate" },
  annual_goals: { table: "annual_goals", titleCol: "name", dateCol: "startDate" },
  directives_risk_log: { table: "directives_risk_log", titleCol: "name", dateCol: "lastAssessed" },
  opportunities_strengths: { table: "opportunities_strengths", titleCol: "name", dateCol: "lastAssessed" },
  people: { table: "people", titleCol: "name", dateCol: "lastContacted" },
  campaigns: { table: "campaigns", titleCol: "name", dateCol: "startDate" },
  content_pipeline: { table: "content_pipeline", titleCol: "title", dateCol: "publishDate" },
  financial_accounts: { table: "financial_accounts", titleCol: "accountName", dateCol: "createdDate" },
  reports: { table: "reports", titleCol: "title", dateCol: "createdAt" },
};

function resolveTableKey(keyOrName: string, config: OperantConfig): string {
  if ((config.tables as Record<string, TableConfig>)[keyOrName]) return keyOrName;
  for (const [k, v] of Object.entries(config.tables as Record<string, TableConfig>)) {
    if (v.name.toLowerCase() === keyOrName.toLowerCase()) return k;
  }
  throw new Error(`Unknown table: "${keyOrName}". Available: ${Object.keys(config.tables).join(", ")}`);
}

// ─── Metric Helpers ───

function frequencyToWeeklyMultiplier(freq: string): number {
  switch (freq) {
    case "4 Times a Day": return 28;
    case "Every Day": return 7;
    case "Twice Every Week": return 2;
    case "Once every Week": return 1;
    case "Once every 4 days": return 1.75;
    default: return 7;
  }
}

// ─── Register All Tools ───

export function registerLifeOSTools(
  sessionToolImpls: Record<string, (args: any) => Promise<ToolResult>>,
  sessionServer: { registerTool: (name: string, opts: { description: string; inputSchema: z.ZodObject<any> }, handler: (args: any) => Promise<ToolResult>) => void },
  pg: PostgresClient,
  config: OperantConfig,
): void {
  const tables = config.tables as Record<string, TableConfig>;

  // ═══════════════════════════════════════════
  // 1. lifeos_discover
  // ═══════════════════════════════════════════
  const discover = async (): Promise<ToolResult> => {
    const lines = ["# LifeOS Database Discovery\n"];
    lines.push(`**Total databases:** ${Object.keys(tables).length}\n`);
    const byAgent: Record<string, string[]> = { productivity: [], journaling: [], strategic: [] };
    for (const [key, table] of Object.entries(tables)) {
      byAgent[table.agent].push(`**${key}** — ${table.name}`);
    }
    for (const [agent, dbs] of Object.entries(byAgent)) {
      lines.push(`## ${agent.charAt(0).toUpperCase() + agent.slice(1)} (${dbs.length})\n`);
      for (const db of dbs) lines.push(`- ${db}`);
      lines.push("");
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_discover"] = discover;
  sessionServer.registerTool("lifeos_discover", {
    description: "List all LifeOS databases with their agent domain mapping. Use to discover available tables and understand which agent owns each database.",
    inputSchema: z.object({}),
  }, discover);

  // ═══════════════════════════════════════════
  // 2. lifeos_query
  // ═══════════════════════════════════════════
  const query = async (args: { table: string; filters?: Record<string, unknown>; limit?: number; offset?: number; orderBy?: Array<{ column: string; direction: "asc" | "desc" }> }): Promise<ToolResult> => {
    const tableKey = resolveTableKey(args.table, config);
    const table = tables[tableKey];
    const result = await pg.query(tableKey, args.filters as Filters | undefined, {
      limit: args.limit ?? 50,
      offset: args.offset,
      orderBy: args.orderBy,
    });
    const rows = result.rows as Row[];
    if (rows.length === 0) return ok(`## Query: ${table.name}\n\nNo rows found for table \`${tableKey}\`.`);
    const lines = [`## Query: ${table.name} (${rows.length} rows)`, ""];
    // Show columns from first row
    const cols = Object.keys(rows[0]).filter((k) => k !== "_drizzle_uniq");
    lines.push(`| ${cols.join(" | ")} |`);
    lines.push(`| ${cols.map(() => "---").join(" | ")} |`);
    for (const row of rows.slice(0, args.limit ?? 50)) {
      lines.push(`| ${cols.map((c) => { const v = row[c]; return v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v).substring(0, 80) : String(v).substring(0, 80); }).join(" | ")} |`);
    }
    if (rows.length > (args.limit ?? 50)) lines.push(`\n... and ${rows.length - (args.limit ?? 50)} more rows`);
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_query"] = query;
  sessionServer.registerTool("lifeos_query", {
    description: "Generic query for any LifeOS table with filters and sorting. Supports operators: eq, in, like, gt, lt, gte, lte, null, notNull. Use camelCase property names.",
    inputSchema: z.object({
      table: z.string().describe("Table key (e.g., 'activity_log', 'tasks', 'projects')"),
      filters: z.record(z.unknown()).optional().describe("Filter object. Supports: { field: 'value' }, { field: { eq: 'value' } }, { field: { in: ['a','b'] } }, { field: { like: '%text%' } }, { field: { gt: 5 } }, { field: { null: true } }, etc."),
      limit: z.number().optional().describe("Max rows (default: 50)"),
      offset: z.number().optional().describe("Row offset"),
      orderBy: z.array(z.object({ column: z.string(), direction: z.enum(["asc", "desc"]) })).optional().describe("Sort order"),
    }),
  }, query);

  // ═══════════════════════════════════════════
  // 3. lifeos_query_db_schema
  // ═══════════════════════════════════════════
  const queryDbSchema = async (args: { table?: string }): Promise<ToolResult> => {
    const lines = ["# Database Schema\n"];
    if (args.table) {
      const tableKey = resolveTableKey(args.table, config);
      const schema = await pg.getSchema(tableKey);
      lines.push(`## ${schema.tableName}\n`);
      lines.push("| Column | Type | Nullable |");
      lines.push("|--------|------|----------|");
      for (const col of schema.columns) {
        lines.push(`| ${col.name} | ${col.type} | ${col.nullable ? "Yes" : "No"} |`);
      }
    } else {
      const allTables = await pg.listTables();
      for (const t of allTables) {
        const schema = await pg.getSchema(t);
        lines.push(`## ${schema.tableName}\n`);
        lines.push("| Column | Type | Nullable |");
        lines.push("|--------|------|----------|");
        for (const col of schema.columns) {
          lines.push(`| ${col.name} | ${col.type} | ${col.nullable ? "Yes" : "No"} |`);
        }
        lines.push("");
      }
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_query_db_schema"] = queryDbSchema;
  sessionServer.registerTool("lifeos_query_db_schema", {
    description: "Get column names, types, and nullability for any LifeOS table. Use to understand the schema before querying.",
    inputSchema: z.object({ table: z.string().optional().describe("Table key. If omitted, returns schema for all tables.") }),
  }, queryDbSchema);

  // ═══════════════════════════════════════════
  // 4. lifeos_context_card
  // ═══════════════════════════════════════════
  const contextCard = async (): Promise<ToolResult> => {
    const lines = ["# Context Card — Personal Summary\n"];
    // Projects
    const projects = await pg.query("projects", { status: { eq: "Active" } });
    lines.push(`## Active Projects: ${projects.rows.length}`);
    for (const p of (projects.rows as Row[]).slice(0, 5)) {
      lines.push(`- **${safeStr(p.name)}** — ${safeStr(p.status)} (Progress: ${safeNum(p.progress) ?? "N/A"}%)`);
    }
    lines.push("");
    // Tasks
    const activeTasks = await pg.query("tasks", { status: { in: ["Active", "Focus", "Up Next"] } }, { orderBy: [{ column: "actionDate", direction: "asc" }], limit: 10 });
    lines.push(`## Active Tasks: ${activeTasks.rows.length}`);
    for (const t of activeTasks.rows as Row[]) {
      const overdue = daysAgo(safeStr(t.actionDate)) > 0 ? " ⚠️ Overdue" : "";
      lines.push(`- [${safeStr(t.status)}] **${safeStr(t.name)}**${overdue} — Due: ${fmtDate(safeStr(t.actionDate))}`);
    }
    lines.push("");
    // Quarterly goals
    const qGoals = await pg.query("quarterly_goals", { status: { eq: "On Track" } });
    lines.push(`## Quarterly Goals (On Track): ${qGoals.rows.length}`);
    for (const g of (qGoals.rows as Row[]).slice(0, 5)) {
      lines.push(`- **${safeStr(g.name)}** — ${safeNum(g.progress) ?? 0}%`);
    }
    lines.push("");
    // Recent journal
    const today = toISODate(new Date());
    const subjRecent = await pg.query("subjective_journal", {}, { orderBy: [{ column: "date", direction: "desc" }], limit: 3 });
    if ((subjRecent.rows as Row[]).length > 0) {
      lines.push("## Recent Journal Entries");
      for (const j of subjRecent.rows as Row[]) {
        lines.push(`- **${fmtDate(safeStr(j.date))}** — ${safeStr(j.title || j.name).substring(0, 100)}`);
      }
      lines.push("");
    }
    // Financial
    const weekAgo = toISODate(startOfDay(new Date(Date.now() - 7 * 86400000)));
    const finRecent = await pg.query("financial_log", { date: { gte: weekAgo } }, { orderBy: [{ column: "date", direction: "desc" }], limit: 5 });
    if ((finRecent.rows as Row[]).length > 0) {
      lines.push("## Recent Financial Activity");
      for (const f of finRecent.rows as Row[]) {
        lines.push(`- **${fmtDate(safeStr(f.date))}** — ₹${safeNum(f.amount) ?? 0} (${safeStr(f.category)})`);
      }
      lines.push("");
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_context_card"] = contextCard;
  sessionServer.registerTool("lifeos_context_card", {
    description: "Get a personal context summary: active projects, tasks, goals, recent journals, and financial activity. Use for quick situational awareness.",
    inputSchema: z.object({}),
  }, contextCard);

  // ═══════════════════════════════════════════
  // 5. lifeos_tasks
  // ═══════════════════════════════════════════
  const tasks = async (args: { status?: string; priority?: string; project?: string; search?: string; limit?: number }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.status) filters.status = { eq: args.status };
    if (args.priority) filters.priority = { eq: args.priority };
    if (args.project) filters.projects = { in: [args.project] };
    if (args.search) filters.name = { like: `%${args.search}%` };
    const result = await pg.query("tasks", Object.keys(filters).length > 0 ? filters : undefined, {
      orderBy: [{ column: "actionDate", direction: "asc" }],
      limit: args.limit ?? 100,
    });
    const entries = (result.rows as Row[]).map(transformTask);
    return ok(tasksToMarkdown(entries, `Tasks${args.status ? ` — ${args.status}` : ""}`));
  };
  sessionToolImpls["lifeos_tasks"] = tasks;
  sessionServer.registerTool("lifeos_tasks", {
    description: "Query tasks with status, priority, project, and search filters. Includes overdue detection.",
    inputSchema: z.object({
      status: z.string().optional().describe("Filter by status (Active, Focus, Done, Cancelled, etc.)"),
      priority: z.string().optional().describe("Filter by priority"),
      project: z.string().optional().describe("Filter by project ID"),
      search: z.string().optional().describe("Search in task name"),
      limit: z.number().optional().describe("Max rows (default: 100)"),
    }),
  }, tasks);

  // ═══════════════════════════════════════════
  // 6. lifeos_projects
  // ═══════════════════════════════════════════
  const projects = async (args: { status?: string; limit?: number }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.status) filters.status = { eq: args.status };
    const result = await pg.query("projects", Object.keys(filters).length > 0 ? filters : undefined, {
      limit: args.limit ?? 50,
    });
    const entries = (result.rows as Row[]).map(transformProject);
    return ok(projectsToMarkdown(entries));
  };
  sessionToolImpls["lifeos_projects"] = projects;
  sessionServer.registerTool("lifeos_projects", {
    description: "Query project portfolio with status filter. Shows health, progress, KPIs, and cross-database relations.",
    inputSchema: z.object({
      status: z.string().optional().describe("Filter by project status"),
      limit: z.number().optional().describe("Max rows (default: 50)"),
    }),
  }, projects);

  // ═══════════════════════════════════════════
  // 7. lifeos_quarterly_goals
  // ═══════════════════════════════════════════
  const quarterlyGoals = async (args: { status?: string; limit?: number }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.status) filters.status = { eq: args.status };
    const result = await pg.query("quarterly_goals", Object.keys(filters).length > 0 ? filters : undefined, {
      limit: args.limit ?? 50,
    });
    const entries = (result.rows as Row[]).map(transformQuarterlyGoal);
    return ok(quarterlyGoalsToMarkdown(entries));
  };
  sessionToolImpls["lifeos_quarterly_goals"] = quarterlyGoals;
  sessionServer.registerTool("lifeos_quarterly_goals", {
    description: "Query quarterly OKR goals with status filter. Shows key results, progress, and health.",
    inputSchema: z.object({
      status: z.string().optional().describe("Filter by goal status"),
      limit: z.number().optional().describe("Max rows (default: 50)"),
    }),
  }, quarterlyGoals);

  // ═══════════════════════════════════════════
  // 8. lifeos_annual_goals
  // ═══════════════════════════════════════════
  const annualGoals = async (args: { status?: string; limit?: number }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.status) filters.status = { eq: args.status };
    const result = await pg.query("annual_goals", Object.keys(filters).length > 0 ? filters : undefined, {
      limit: args.limit ?? 50,
    });
    const entries = (result.rows as Row[]).map(transformAnnualGoal);
    return ok(annualGoalsToMarkdown(entries));
  };
  sessionToolImpls["lifeos_annual_goals"] = annualGoals;
  sessionServer.registerTool("lifeos_annual_goals", {
    description: "Query annual goals with status filter. Shows strategic intent, epics, and success conditions.",
    inputSchema: z.object({
      status: z.string().optional().describe("Filter by goal status"),
      limit: z.number().optional().describe("Max rows (default: 50)"),
    }),
  }, annualGoals);

  // ═══════════════════════════════════════════
  // 9. lifeos_directives_risks
  // ═══════════════════════════════════════════
  const directivesRisks = async (args: { logType?: string; limit?: number }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.logType) filters.logType = { eq: args.logType };
    const result = await pg.query("directives_risk_log", Object.keys(filters).length > 0 ? filters : undefined, {
      limit: args.limit ?? 50,
    });
    const entries = (result.rows as Row[]).map(transformDirectiveRisk);
    return ok(directivesRisksToMarkdown(entries));
  };
  sessionToolImpls["lifeos_directives_risks"] = directivesRisks;
  sessionServer.registerTool("lifeos_directives_risks", {
    description: "Query directives and risk log. Shows threat levels, likelihood, impact, and protocols.",
    inputSchema: z.object({
      logType: z.string().optional().describe("Filter by type (Directive, Risk)"),
      limit: z.number().optional().describe("Max rows (default: 50)"),
    }),
  }, directivesRisks);

  // ═══════════════════════════════════════════
  // 10. lifeos_opportunities_strengths
  // ═══════════════════════════════════════════
  const opportunitiesStrengths = async (args: { logType?: string; limit?: number }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.logType) filters.logType = { eq: args.logType };
    const result = await pg.query("opportunities_strengths", Object.keys(filters).length > 0 ? filters : undefined, {
      limit: args.limit ?? 50,
    });
    const entries = (result.rows as Row[]).map(transformOpportunityStrength);
    return ok(opportunitiesStrengthsToMarkdown(entries));
  };
  sessionToolImpls["lifeos_opportunities_strengths"] = opportunitiesStrengths;
  sessionServer.registerTool("lifeos_opportunities_strengths", {
    description: "Query opportunities and strengths log. Shows leverage scores and activation descriptions.",
    inputSchema: z.object({
      logType: z.string().optional().describe("Filter by type (Opportunity, Strength)"),
      limit: z.number().optional().describe("Max rows (default: 50)"),
    }),
  }, opportunitiesStrengths);

  // ═══ 11. lifeos_subjective_journal ═══
  const subjectiveJournal = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string; limit?: number }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const result = await pg.query("subjective_journal", { date: { gte: dates.date_from, lte: dates.date_to } }, {
      orderBy: [{ column: "date", direction: "desc" }],
      limit: args.limit ?? 100,
    });
    const rows = result.rows as Row[];
    const lines = [`## Subjective Journal — ${dates.rangeLabel}`, "", `**Entries:** ${rows.length}`];
    for (const r of rows) {
      lines.push(`\n### ${fmtDate(safeStr(r.date))} — ${safeStr(r.title || r.name)}`);
      if (r.mood) lines.push(`- **Mood:** ${safeStr(r.mood)}`);
      if (r.energy) lines.push(`- **Energy:** ${safeStr(r.energy)}`);
      if (r.emotions) lines.push(`- **Emotions:** ${safeStr(r.emotions).substring(0, 200)}`);
      if (r.reflection) lines.push(`- **Reflection:** ${safeStr(r.reflection).substring(0, 200)}`);
      if (r.dreams) lines.push(`- **Dreams:** ${safeStr(r.dreams).substring(0, 200)}`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_subjective_journal"] = subjectiveJournal;
  sessionServer.registerTool("lifeos_subjective_journal", {
    description: "Query subjective journal entries: internal state, emotions, dreams, reflections.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional().describe("Time period preset"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
      limit: z.number().optional().describe("Max rows (default: 100)"),
    }),
  }, subjectiveJournal);

  // ═══ 12. lifeos_relational_journal ═══
  const relationalJournal = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string; person?: string; limit?: number }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const filters: Filters = { date: { gte: dates.date_from, lte: dates.date_to } };
    if (args.person) filters.personId = { eq: args.person };
    const result = await pg.query("relational_journal", filters, {
      orderBy: [{ column: "date", direction: "desc" }],
      limit: args.limit ?? 100,
    });
    const rows = result.rows as Row[];
    const lines = [`## Relational Journal — ${dates.rangeLabel}`, "", `**Entries:** ${rows.length}`];
    for (const r of rows) {
      lines.push(`\n### ${fmtDate(safeStr(r.date))} — ${safeStr(r.title || r.name)}`);
      if (r.personName) lines.push(`- **Person:** ${safeStr(r.personName)}`);
      if (r.interactionType) lines.push(`- **Type:** ${safeStr(r.interactionType)}`);
      if (r.reflection) lines.push(`- **Reflection:** ${safeStr(r.reflection).substring(0, 200)}`);
      if (r.socialEnergy) lines.push(`- **Social Energy:** ${safeStr(r.socialEnergy)}`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_relational_journal"] = relationalJournal;
  sessionServer.registerTool("lifeos_relational_journal", {
    description: "Query relational journal: relationship interactions and social reflections.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      person: z.string().optional().describe("Filter by person ID"),
      limit: z.number().optional().describe("Max rows (default: 100)"),
    }),
  }, relationalJournal);

  // ═══ 13. lifeos_systemic_journal ═══
  const systemicJournal = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string; impact?: string; limit?: number }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const filters: Filters = { date: { gte: dates.date_from, lte: dates.date_to } };
    if (args.impact) filters.impactLevel = { eq: args.impact };
    const result = await pg.query("systemic_journal", filters, {
      orderBy: [{ column: "date", direction: "desc" }],
      limit: args.limit ?? 100,
    });
    const rows = result.rows as Row[];
    const lines = [`## Systemic Journal — ${dates.rangeLabel}`, "", `**Entries:** ${rows.length}`];
    for (const r of rows) {
      lines.push(`\n### ${fmtDate(safeStr(r.date))} — ${safeStr(r.title || r.name)}`);
      if (r.impactLevel) lines.push(`- **Impact:** ${safeStr(r.impactLevel)}`);
      if (r.systemObserved) lines.push(`- **System:** ${safeStr(r.systemObserved)}`);
      if (r.patternObserved) lines.push(`- **Pattern:** ${safeStr(r.patternObserved).substring(0, 200)}`);
      if (r.insight) lines.push(`- **Insight:** ${safeStr(r.insight).substring(0, 200)}`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_systemic_journal"] = systemicJournal;
  sessionServer.registerTool("lifeos_systemic_journal", {
    description: "Query systemic journal: systems-level observations, pattern recognition, impact levels (P1-P5).",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      impact: z.string().optional().describe("Filter by impact level (P1-P5)"),
      limit: z.number().optional().describe("Max rows (default: 100)"),
    }),
  }, systemicJournal);

  // ═══ 14. lifeos_financial_log ═══
  const financialLog = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string; category?: string; capitalEngine?: string; limit?: number }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const filters: Filters = { date: { gte: dates.date_from, lte: dates.date_to } };
    if (args.category) filters.category = { eq: args.category };
    if (args.capitalEngine) filters.capitalEngine = { eq: args.capitalEngine };
    const result = await pg.query("financial_log", filters, {
      orderBy: [{ column: "date", direction: "desc" }],
      limit: args.limit ?? 100,
    });
    const rows = result.rows as Row[];
    const lines = [`## Financial Log — ${dates.rangeLabel}`, "", `**Entries:** ${rows.length}`];
    let totalRevenue = 0;
    let totalExpenses = 0;
    const revCats = ["Business Revenue", "Client Payment", "Investment Income", "Income"];
    for (const r of rows) {
      const amt = safeNum(r.amount) ?? 0;
      if (revCats.includes(safeStr(r.category))) totalRevenue += amt;
      else totalExpenses += amt;
    }
    lines.push(`- **Revenue:** ₹${totalRevenue.toLocaleString()}`);
    lines.push(`- **Expenses:** ₹${totalExpenses.toLocaleString()}`);
    lines.push(`- **Net:** ₹${(totalRevenue - totalExpenses).toLocaleString()}`);
    lines.push("");
    for (const r of rows) {
      const amt = safeNum(r.amount) ?? 0;
      const sign = revCats.includes(safeStr(r.category)) ? "+" : "-";
      lines.push(`- **${fmtDate(safeStr(r.date))}** — ${sign}₹${amt.toLocaleString()} | ${safeStr(r.category)} | ${safeStr(r.title || r.name)}`);
      if (r.capitalEngine) lines.push(`  - Engine: ${safeStr(r.capitalEngine)}`);
      if (r.notes && safeStr(r.notes).length > 0) lines.push(`  - Notes: ${safeStr(r.notes).substring(0, 150)}`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_financial_log"] = financialLog;
  sessionServer.registerTool("lifeos_financial_log", {
    description: "Query financial transactions with date range, category, and capital engine filters.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      category: z.string().optional(),
      capitalEngine: z.string().optional().describe("Filter by capital engine (E/S/B/I)"),
      limit: z.number().optional().describe("Max rows (default: 100)"),
    }),
  }, financialLog);

  // ═══ 15. lifeos_diet_log ═══
  const dietLog = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string; limit?: number }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const result = await pg.query("diet_log", { date: { gte: dates.date_from, lte: dates.date_to } }, {
      orderBy: [{ column: "date", direction: "desc" }],
      limit: args.limit ?? 100,
    });
    const rows = result.rows as Row[];
    const lines = [`## Diet Log — ${dates.rangeLabel}`, "", `**Entries:** ${rows.length}`];
    for (const r of rows) {
      lines.push(`\n### ${fmtDate(safeStr(r.date))} — ${safeStr(r.title || r.name)}`);
      if (r.nutrition) lines.push(`- **Nutrition:** ${safeStr(r.nutrition).substring(0, 300)}`);
      if (r.mealType) lines.push(`- **Meal:** ${safeStr(r.mealType)}`);
      if (r.calories) lines.push(`- **Calories:** ${safeNum(r.calories)}`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_diet_log"] = dietLog;
  sessionServer.registerTool("lifeos_diet_log", {
    description: "Query diet/nutrition entries with date range.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      limit: z.number().optional().describe("Max rows (default: 100)"),
    }),
  }, dietLog);

  // ═══ 16. lifeos_content ═══
  const content = async (args: { status?: string; contentType?: string; limit?: number }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.status) filters.status = { eq: args.status };
    if (args.contentType) filters.contentType = { eq: args.contentType };
    const result = await pg.query("content_pipeline", Object.keys(filters).length > 0 ? filters : undefined, {
      orderBy: [{ column: "publishDate", direction: "desc" }],
      limit: args.limit ?? 50,
    });
    const rows = result.rows as Row[];
    const lines = [`## Content Pipeline`, "", `**Total:** ${rows.length}`];
    for (const r of rows) {
      const statusIcon = safeStr(r.status) === "Published" ? "✅" : safeStr(r.status) === "Draft" ? "📝" : "📋";
      lines.push(`- ${statusIcon} **${safeStr(r.title)}** — ${safeStr(r.status)} | ${fmtDate(safeStr(r.publishDate))} | ${safeStr(r.contentType)}`);
      if (r.topic) lines.push(`  - Topic: ${safeStr(r.topic).substring(0, 120)}`);
      if (r.platform) lines.push(`  - Platform: ${safeStr(r.platform)}`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_content"] = content;
  sessionServer.registerTool("lifeos_content", {
    description: "Query content pipeline with status and content type filters.",
    inputSchema: z.object({
      status: z.string().optional().describe("Filter by status (Draft, Published, etc.)"),
      contentType: z.string().optional().describe("Filter by content type"),
      limit: z.number().optional().describe("Max rows (default: 50)"),
    }),
  }, content);

  // ═══ 17. lifeos_campaigns ═══
  const campaigns = async (args: { status?: string; limit?: number }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.status) filters.status = { eq: args.status };
    const result = await pg.query("campaigns", Object.keys(filters).length > 0 ? filters : undefined, {
      orderBy: [{ column: "startDate", direction: "desc" }],
      limit: args.limit ?? 50,
    });
    const rows = result.rows as Row[];
    const lines = [`## Campaign Management`, "", `**Total:** ${rows.length}`];
    for (const r of rows) {
      lines.push(`\n### ${safeStr(r.name)} — ${safeStr(r.status)}`);
      if (r.startDate) lines.push(`- **Period:** ${fmtDate(safeStr(r.startDate))} → ${fmtDate(safeStr(r.endDate))}`);
      if (r.objective) lines.push(`- **Objective:** ${safeStr(r.objective).substring(0, 200)}`);
      if (r.budget) lines.push(`- **Budget:** ₹${safeNum(r.budget)?.toLocaleString()}`);
      if (r.metrics) lines.push(`- **Metrics:** ${safeStr(r.metrics).substring(0, 200)}`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_campaigns"] = campaigns;
  sessionServer.registerTool("lifeos_campaigns", {
    description: "Query campaign calendar with status filter.",
    inputSchema: z.object({
      status: z.string().optional().describe("Filter by campaign status"),
      limit: z.number().optional().describe("Max rows (default: 50)"),
    }),
  }, campaigns);

  // ═══ 18. lifeos_people_ops ═══
  const peopleOps = async (args: { category?: string; limit?: number }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.category) filters.category = { eq: args.category };
    const result = await pg.query("people", Object.keys(filters).length > 0 ? filters : undefined, {
      limit: args.limit ?? 50,
    });
    const rows = result.rows as Row[];
    const lines = [`## People`, "", `**Total:** ${rows.length}`];
    for (const r of rows) {
      lines.push(`\n### ${safeStr(r.name)}`);
      if (r.relationship) lines.push(`- **Relationship:** ${safeStr(r.relationship)}`);
      if (r.lastContacted) lines.push(`- **Last Contact:** ${fmtDate(safeStr(r.lastContacted))} (${daysAgo(safeStr(r.lastContacted))}d ago)`);
      if (r.notes) lines.push(`- **Notes:** ${safeStr(r.notes).substring(0, 200)}`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_people_ops"] = peopleOps;
  sessionServer.registerTool("lifeos_people_ops", {
    description: "Query people/relationship database.",
    inputSchema: z.object({
      category: z.string().optional().describe("Filter by relationship category"),
      limit: z.number().optional().describe("Max rows (default: 50)"),
    }),
  }, peopleOps);

  // ═══ 19. lifeos_finance_ops ═══
  const financeOps = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const finResult = await pg.query("financial_log", { date: { gte: dates.date_from, lte: dates.date_to } }, { orderBy: [{ column: "date", direction: "desc" }] });
    const finRows = finResult.rows as Row[];
    const revCats = ["Business Revenue", "Client Payment", "Investment Income", "Income"];
    let totalRevenue = 0;
    let totalExpenses = 0;
    const byCategory = new Map<string, number>();
    const byEngine = new Map<string, number>();
    for (const r of finRows) {
      const amt = safeNum(r.amount) ?? 0;
      const cat = safeStr(r.category);
      byCategory.set(cat, (byCategory.get(cat) || 0) + amt);
      if (r.capitalEngine) {
        const engine = safeStr(r.capitalEngine);
        const engineNames: Record<string, string> = { E: "Employment", S: "Self-employment", B: "Business", I: "Investment" };
        byEngine.set(engineNames[engine] || engine, (byEngine.get(engineNames[engine] || engine) || 0) + amt);
      }
      if (revCats.includes(cat)) totalRevenue += amt;
      else totalExpenses += amt;
    }
    const lines = [`# Finance Operations — ${dates.rangeLabel}`, ""];
    lines.push(`## Summary`);
    lines.push(`- **Revenue:** ₹${totalRevenue.toLocaleString()}`);
    lines.push(`- **Expenses:** ₹${totalExpenses.toLocaleString()}`);
    lines.push(`- **Net Income:** ₹${(totalRevenue - totalExpenses).toLocaleString()}`);
    lines.push(`- **Transactions:** ${finRows.length}`);
    lines.push("");
    if (byCategory.size > 0) {
      lines.push("## By Category");
      lines.push("| Category | Amount |");
      lines.push("|----------|--------|");
      for (const [cat, amt] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${cat} | ₹${amt.toLocaleString()} |`);
      }
      lines.push("");
    }
    if (byEngine.size > 0) {
      lines.push("## By Capital Engine");
      lines.push("| Engine | Amount |");
      lines.push("|--------|--------|");
      for (const [engine, amt] of [...byEngine.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${engine} | ₹${amt.toLocaleString()} |`);
      }
      lines.push("");
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_finance_ops"] = financeOps;
  sessionServer.registerTool("lifeos_finance_ops", {
    description: "Finance operations overview: revenue, expenses, breakdowns by category and capital engine.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  }, financeOps);

  // ═══ 20. lifeos_alignment ═══
  const alignment = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const [goalsResult, activitiesResult, tasksResult] = await Promise.all([
      pg.query("quarterly_goals", { status: { in: ["On Track", "At Risk"] } }),
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("tasks", { status: { in: ["Active", "Focus"] } }),
    ]);
    const goals = goalsResult.rows as Row[];
    const activities = activitiesResult.rows as Row[];
    const tasks = tasksResult.rows as Row[];
    const lines = [`# Goal-Activity Alignment — ${dates.rangeLabel}`, ""];
    for (const g of goals) {
      const goalName = safeStr(g.name);
      const goalProjects = safeArr(g.projects);
      const goalTasks = tasks.filter((t) => {
        const tProjects = safeArr(t.projects);
        return goalProjects.some((gp: unknown) => tProjects.some((tp: unknown) => tp === gp || (typeof tp === "object" && typeof gp === "object" && JSON.stringify(tp) === JSON.stringify(gp))));
      });
      const goalActivities = activities.filter((a) => {
        const aProjects = safeArr(a.projects);
        return goalProjects.some((gp: unknown) => aProjects.some((ap: unknown) => ap === gp || (typeof ap === "object" && typeof gp === "object" && JSON.stringify(ap) === JSON.stringify(gp))));
      });
      const totalHours = goalActivities.reduce((s: number, a: Row) => s + (safeNum(a.durationHours) ?? 0), 0);
      lines.push(`## ${goalName} (${safeStr(g.status)}, ${safeNum(g.progress) ?? 0}%)`);
      lines.push(`- **Linked activities:** ${goalActivities.length} (${totalHours.toFixed(1)}h)`);
      lines.push(`- **Linked tasks:** ${goalTasks.length}`);
      if (goalTasks.length === 0 && goalActivities.length === 0) {
        lines.push(`- ⚠️ **No recent activity aligned to this goal**`);
      }
      lines.push("");
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_alignment"] = alignment;
  sessionServer.registerTool("lifeos_alignment", {
    description: "Check goal-to-activity alignment: which goals have recent activity and which are orphaned.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  }, alignment);

  // ═══ 21. lifeos_project_health ═══
  const projectHealth = async (args: { project?: string }): Promise<ToolResult> => {
    const filters: Filters = {};
    if (args.project) filters.projectId = { eq: args.project };
    const projResult = await pg.query("projects", Object.keys(filters).length > 0 ? filters : undefined);
    const projects = projResult.rows as Row[];
    const lines = ["# Project Health Dashboard\n"];
    for (const p of projects) {
      lines.push(`## ${safeStr(p.name)}`);
      lines.push(`- **Status:** ${safeStr(p.status)}`);
      if (p.health) lines.push(`- **Health:** ${safeStr(p.health)}`);
      if (p.progress != null) lines.push(`- **Progress:** ${safeNum(p.progress)}%`);
      if (p.deadline) {
        const d = daysAgo(safeStr(p.deadline));
        lines.push(`- **Deadline:** ${fmtDate(safeStr(p.deadline))} ${d > 0 ? `⚠️ ${d}d overdue` : `(${Math.abs(d)}d remaining)`}`);
      }
      if (p.kpi) lines.push(`- **KPI:** ${safeStr(p.kpi).substring(0, 200)}`);
      if (p.projectSummary) lines.push(`- **Summary:** ${safeStr(p.projectSummary).substring(0, 200)}`);
      const taskCount = safeArr(p.tasks).length;
      const peopleCount = safeArr(p.people).length;
      if (taskCount > 0 || peopleCount > 0) lines.push(`- 🔗 Tasks(${taskCount}) People(${peopleCount})`);
      lines.push("");
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_project_health"] = projectHealth;
  sessionServer.registerTool("lifeos_project_health", {
    description: "Project health dashboard with status, health metrics, progress, deadlines, and KPIs.",
    inputSchema: z.object({ project: z.string().optional().describe("Filter by project ID") }),
  }, projectHealth);

  // ═══ 22. lifeos_okrs_progress ═══
  const okrsProgress = async (): Promise<ToolResult> => {
    const goalsResult = await pg.query("quarterly_goals", {}, { orderBy: [{ column: "progress", direction: "desc" }] });
    const goals = goalsResult.rows as Row[];
    const lines = ["# OKR Progress Tracker\n"];
    const onTrack = goals.filter((g) => safeStr(g.status) === "On Track");
    const atRisk = goals.filter((g) => safeStr(g.status) === "At Risk");
    const offTrack = goals.filter((g) => safeStr(g.status) === "Off Track");
    const done = goals.filter((g) => safeStr(g.status) === "Done");
    lines.push(`**Summary:** ${onTrack.length} On Track | ${atRisk.length} At Risk | ${offTrack.length} Off Track | ${done.length} Done\n`);
    for (const g of goals) {
      const statusIcon = safeStr(g.status) === "On Track" ? "✅" : safeStr(g.status) === "At Risk" ? "⚠️" : safeStr(g.status) === "Off Track" ? "🔴" : "🏁";
      lines.push(`### ${statusIcon} ${safeStr(g.name)} — ${safeNum(g.progress) ?? 0}%`);
      lines.push(`- **Status:** ${safeStr(g.status)}`);
      if (g.keyResult1) lines.push(`- **KR1:** ${safeStr(g.keyResult1).substring(0, 150)}`);
      if (g.keyResult2) lines.push(`- **KR2:** ${safeStr(g.keyResult2).substring(0, 150)}`);
      if (g.keyResult3) lines.push(`- **KR3:** ${safeStr(g.keyResult3).substring(0, 150)}`);
      if (g.health) lines.push(`- **Health:** ${safeStr(g.health)}`);
      if (g.keyLearning) lines.push(`- **Learning:** ${safeStr(g.keyLearning).substring(0, 150)}`);
      lines.push("");
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_okrs_progress"] = okrsProgress;
  sessionServer.registerTool("lifeos_okrs_progress", {
    description: "OKR progress tracking across all quarterly goals with key results and status.",
    inputSchema: z.object({}),
  }, okrsProgress);

  // ═══ 23. lifeos_journal_synthesis ═══
  const journalSynthesis = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const [subj, rel, sys, diet] = await Promise.all([
      pg.query("subjective_journal", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("relational_journal", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("systemic_journal", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("diet_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
    ]);
    const subjRows = subj.rows as Row[];
    const relRows = rel.rows as Row[];
    const sysRows = sys.rows as Row[];
    const dietRows = diet.rows as Row[];
    const lines = [`# Journal Synthesis — ${dates.rangeLabel}`, ""];
    lines.push(`## Overview`);
    lines.push(`- **Subjective entries:** ${subjRows.length}`);
    lines.push(`- **Relational entries:** ${relRows.length}`);
    lines.push(`- **Systemic entries:** ${sysRows.length}`);
    lines.push(`- **Diet entries:** ${dietRows.length}`);
    lines.push("");
    if (subjRows.length > 0) {
      const moods = subjRows.map((r) => safeStr(r.mood)).filter(Boolean);
      const moodCounts = new Map<string, number>();
      for (const m of moods) moodCounts.set(m, (moodCounts.get(m) || 0) + 1);
      if (moodCounts.size > 0) {
        lines.push("## Mood Distribution");
        for (const [mood, count] of [...moodCounts.entries()].sort((a, b) => b[1] - a[1])) {
          lines.push(`- ${mood}: ${count}`);
        }
        lines.push("");
      }
    }
    if (sysRows.length > 0) {
      const impacts = sysRows.map((r) => safeStr(r.impactLevel)).filter(Boolean);
      const impactCounts = new Map<string, number>();
      for (const i of impacts) impactCounts.set(i, (impactCounts.get(i) || 0) + 1);
      if (impactCounts.size > 0) {
        lines.push("## Impact Distribution");
        for (const [impact, count] of [...impactCounts.entries()].sort((a, b) => b[1] - a[1])) {
          lines.push(`- ${impact}: ${count}`);
        }
        lines.push("");
      }
    }
    if (relRows.length > 0) {
      const people = relRows.map((r) => safeStr(r.personName)).filter(Boolean);
      const personCounts = new Map<string, number>();
      for (const p of people) personCounts.set(p, (personCounts.get(p) || 0) + 1);
      if (personCounts.size > 0) {
        lines.push("## People Interactions");
        for (const [person, count] of [...personCounts.entries()].sort((a, b) => b[1] - a[1])) {
          lines.push(`- ${person}: ${count} interaction(s)`);
        }
        lines.push("");
      }
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_journal_synthesis"] = journalSynthesis;
  sessionServer.registerTool("lifeos_journal_synthesis", {
    description: "Cross-journal pattern synthesis: mood distribution, impact levels, people interactions.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  }, journalSynthesis);

  // ═══ 24. lifeos_financial_accounts ═══
  const financialAccounts = async (): Promise<ToolResult> => {
    const result = await pg.query("financial_accounts");
    const rows = result.rows as Row[];
    const lines = ["## Financial Accounts\n"];
    for (const r of rows) {
      lines.push(`### ${safeStr(r.accountName || r.name)}`);
      if (r.accountType) lines.push(`- **Type:** ${safeStr(r.accountType)}`);
      if (r.balance != null) lines.push(`- **Balance:** ₹${safeNum(r.balance)?.toLocaleString()}`);
      if (r.institution) lines.push(`- **Institution:** ${safeStr(r.institution)}`);
      if (r.status) lines.push(`- **Status:** ${safeStr(r.status)}`);
      lines.push("");
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_financial_accounts"] = financialAccounts;
  sessionServer.registerTool("lifeos_financial_accounts", {
    description: "List all financial accounts with balances and types.",
    inputSchema: z.object({}),
  }, financialAccounts);

  // ═══ 25. lifeos_productivity_report ═══
  const productivityReport = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const [activityResult, taskResult] = await Promise.all([
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("tasks"),
    ]);
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const tasks = (taskResult.rows as Row[]).map(transformTask);
    const report = computeProductivityReport(activities, tasks, dates.date_from, dates.date_to);
    return ok(productivityReportToMarkdown(report));
  };
  sessionToolImpls["lifeos_productivity_report"] = productivityReport;
  sessionServer.registerTool("lifeos_productivity_report", {
    description: "Synthesized productivity report correlating activities and tasks with time allocation analysis.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  }, productivityReport);

  // ═══ 26. lifeos_daily_briefing ═══
  const dailyBriefing = async (): Promise<ToolResult> => {
    const today = toISODate(new Date());
    const yesterday = toISODate(startOfDay(new Date(Date.now() - 86400000)));
    const [tasksResult, activityResult, goalsResult] = await Promise.all([
      pg.query("tasks", { status: { in: ["Active", "Focus", "Up Next"] } }, { orderBy: [{ column: "actionDate", direction: "asc" }], limit: 20 }),
      pg.query("activity_log", { date: { gte: yesterday } }, { orderBy: [{ column: "date", direction: "desc" }], limit: 20 }),
      pg.query("quarterly_goals", { status: { in: ["On Track", "At Risk"] } }),
    ]);
    const tasks = (tasksResult.rows as Row[]).map(transformTask);
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const goals = goalsResult.rows as Row[];
    const overdue = tasks.filter((t) => t.isOverdue);
    const focusTasks = tasks.filter((t) => safeStr(t.status) === "Focus");
    const lines = [`# Daily Briefing — ${today}`, ""];
    lines.push(`## 🎯 Focus Tasks (${focusTasks.length})`);
    for (const t of focusTasks) {
      lines.push(`- ${t.name} — Due: ${fmtDateTime(t.actionDate)}`);
    }
    if (focusTasks.length === 0) lines.push("- No focus tasks set");
    lines.push("");
    if (overdue.length > 0) {
      lines.push(`## ⚠️ Overdue (${overdue.length})`);
      for (const t of overdue.slice(0, 5)) {
        lines.push(`- ${t.name} — was due: ${fmtDateTime(t.actionDate)}`);
      }
      lines.push("");
    }
    lines.push(`## All Active Tasks (${tasks.length})`);
    for (const t of tasks.slice(0, 10)) {
      const tag = t.isOverdue ? " ⚠️" : "";
      lines.push(`- [${t.status}] ${t.name}${tag}`);
    }
    lines.push("");
    const totalHours = activities.reduce((s, a) => s + (a.durationHours ?? 0), 0);
    lines.push(`## Yesterday's Activity (${activities.length} entries, ${totalHours.toFixed(1)}h)`);
    const byType = new Map<string, number>();
    for (const a of activities) byType.set(a.activityType, (byType.get(a.activityType) || 0) + (a.durationHours ?? 0));
    for (const [type, hrs] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${type}: ${hrs.toFixed(1)}h`);
    }
    lines.push("");
    lines.push(`## Goals Status`);
    for (const g of goals.slice(0, 5)) {
      lines.push(`- ${safeStr(g.name)}: ${safeNum(g.progress) ?? 0}% (${safeStr(g.status)})`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_daily_briefing"] = dailyBriefing;
  sessionServer.registerTool("lifeos_daily_briefing", {
    description: "Cross-database daily briefing: focus tasks, overdue items, yesterday's activity, goal status.",
    inputSchema: z.object({}),
  }, dailyBriefing);

  // ═══ 27. lifeos_temporal_analysis ═══
  const temporalAnalysis = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const [activityResult, typesResult] = await Promise.all([
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("activity_types"),
    ]);
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const targets = loadActivityTargetsPg(typesResult.rows as Row[]);
    const metrics = computePeriodMetrics(activities, dates.date_from, dates.date_to, targets);
    const lines = [`# Temporal Analysis — ${dates.rangeLabel}`, ""];
    lines.push(`## Overview`);
    lines.push(`- **Calendar days:** ${metrics.days}`);
    lines.push(`- **Tracked days:** ${metrics.trackedDays}`);
    lines.push(`- **Total hours:** ${metrics.totalHours.toFixed(1)}h`);
    lines.push(`- **Daily average:** ${metrics.dailyAverage.toFixed(1)}h/day`);
    lines.push(`- **Peak day:** ${metrics.peakDay.date || "N/A"} (${metrics.peakDay.hours.toFixed(1)}h)`);
    lines.push(`- **Low day:** ${metrics.lowDay.date || "N/A"} (${metrics.lowDay.hours.toFixed(1)}h)`);
    lines.push("");
    if (metrics.categoryBreakdown.size > 0) {
      lines.push("## Category Breakdown");
      lines.push("| Category | Hours | % | Daily Avg |");
      lines.push("|----------|-------|---|-----------|");
      for (const [cat, data] of [...metrics.categoryBreakdown.entries()].sort((a, b) => b[1].hours - a[1].hours)) {
        const dailyAvg = metrics.trackedDays > 0 ? data.hours / metrics.trackedDays : 0;
        lines.push(`| ${cat} | ${data.hours.toFixed(1)}h | ${data.pctOfTotal.toFixed(0)}% | ${dailyAvg.toFixed(1)}h |`);
      }
      lines.push("");
    }
    if (metrics.habitCompliance > 0) {
      lines.push(`## Habit Compliance: ${metrics.habitCompliance.toFixed(0)}%`);
      lines.push(`- Target: ${metrics.habitTarget} entries`);
      lines.push("");
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_temporal_analysis"] = temporalAnalysis;
  sessionServer.registerTool("lifeos_temporal_analysis", {
    description: "Time-based pattern detection: period metrics, category breakdown, habit compliance.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  }, temporalAnalysis);

  // ═══ 28. lifeos_trajectory ═══
  const trajectory = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const [activityResult, typesResult] = await Promise.all([
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("activity_types"),
    ]);
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const targets = loadActivityTargetsPg(typesResult.rows as Row[]);
    const metrics = computePeriodMetrics(activities, dates.date_from, dates.date_to, targets);
    const lines = [`# Trajectory Analysis — ${dates.rangeLabel}`, ""];
    if (metrics.dailyHours.size < 3) {
      lines.push("Insufficient data for trend analysis (need at least 3 data points).");
      return ok(lines.join("\n"));
    }
    const sortedDays = [...metrics.dailyHours.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const trendPoints = sortedDays.map(([date, value]) => ({ date, value }));
    const trend = computeTrend(trendPoints, "Daily Hours", true);
    lines.push(`## Trend: ${trend.trend.toUpperCase()}`);
    lines.push(`- **Slope:** ${trend.slope.toFixed(3)} h/day`);
    lines.push(`- **R²:** ${trend.r2.toFixed(3)}`);
    lines.push(`- **7-day projection:** ${trend.projection7d.toFixed(1)}h`);
    lines.push(`- **30-day projection:** ${trend.projection30d.toFixed(1)}h`);
    lines.push("");
    if (targets.size > 0) {
      lines.push("## Trajectory vs Targets");
      for (const [name, target] of targets) {
        const catActivities = activities.filter((a) => a.activityType === name);
        const totalHrs = catActivities.reduce((s, a) => s + (a.durationHours ?? 0), 0);
        const dailyRate = metrics.trackedDays > 0 ? totalHrs / metrics.trackedDays : 0;
        const targetDaily = target.targetDuration;
        const mapping = mapTrajectory(totalHrs, targetDaily * metrics.days, dailyRate, metrics.days);
        mapping.metric = name;
        const icon = mapping.onTrack ? "✅" : "⚠️";
        lines.push(`\n### ${icon} ${name}`);
        lines.push(`- Current: ${totalHrs.toFixed(1)}h / Target: ${(targetDaily * metrics.days).toFixed(1)}h`);
        lines.push(`- Daily rate: ${dailyRate.toFixed(2)}h (need ${mapping.idealDailyRate.toFixed(2)}h/day)`);
        lines.push(`- ${mapping.insight}`);
      }
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_trajectory"] = trajectory;
  sessionServer.registerTool("lifeos_trajectory", {
    description: "Trend analysis and future projections with target trajectory mapping.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  }, trajectory);

  // ═══ 29. lifeos_weekday_patterns ═══
  const weekdayPatterns = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string; referenceWeeks?: number }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const [activityResult, typesResult] = await Promise.all([
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("activity_types"),
    ]);
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const targets = loadActivityTargetsPg(typesResult.rows as Row[]);
    const profiles = computeWeekdayProfiles(activities, args.referenceWeeks ?? 8);
    const todayDow = new Date().getDay();
    const todayProfile = profiles.get(todayDow);
    const todayActivities = activities.filter((a) => {
      if (!a.date) return false;
      return new Date(a.date).getDay() === todayDow && daysAgo(a.date) === 0;
    });
    const lines = [`# Weekday Patterns — ${dates.rangeLabel}`, ""];
    lines.push(weekdayOverviewToMarkdown(profiles, todayDow));
    if (todayProfile && todayProfile.instances > 0) {
      const anomalies = todayActivities.length > 0 ? detectAnomalies(todayActivities, todayProfile) : [];
      if (anomalies.length > 0) {
        lines.push(`## Today's Anomalies (${todayProfile.weekday})`);
        for (const a of anomalies) {
          const sev = a.severity === "significant" ? "🔴" : a.severity === "notable" ? "🟡" : "🟢";
          lines.push(`${sev} ${a.insight}`);
        }
        lines.push("");
      }
      const suggestions = suggestDayPlan(todayProfile, targets);
      if (suggestions.length > 0) {
        lines.push(`## Suggested Plan for ${todayProfile.weekday}`);
        for (const s of suggestions.slice(0, 10)) {
          const tag = s.isHabit ? " 🔄" : "";
          lines.push(`- **${s.category}:** ${s.suggestedHours}h${tag} — ${s.reasoning}`);
        }
        lines.push("");
      }
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_weekday_patterns"] = weekdayPatterns;
  sessionServer.registerTool("lifeos_weekday_patterns", {
    description: "Day-of-week behavior analysis with anomaly detection and day plan suggestions.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      referenceWeeks: z.number().optional().describe("Number of weeks for reference profiles (default: 8)"),
    }),
  }, weekdayPatterns);

  // ═══ 30. lifeos_health_vitality ═══
  const healthVitality = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const [dietResult, activityResult, subjResult] = await Promise.all([
      pg.query("diet_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("subjective_journal", { date: { gte: dates.date_from, lte: dates.date_to } }),
    ]);
    const dietEntries = (dietResult.rows as Row[]).map((r) => ({
      id: safeStr(r.id), name: safeStr(r.title || r.name), date: safeStr(r.date), nutrition: safeStr(r.nutrition),
    }));
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const workoutHours = activities.filter((a) => a.activityType.toLowerCase().includes("workout")).reduce((s, a) => s + (a.durationHours ?? 0), 0);
    const sleepHours = activities.filter((a) => a.activityType.toLowerCase().includes("sleep")).reduce((s, a) => s + (a.durationHours ?? 0), 0);
    const report = computeHealthVitality(dietEntries, workoutHours, sleepHours, subjResult.rows.length, dates.date_from, dates.date_to);
    return ok(healthVitalityToMarkdown(report));
  };
  sessionToolImpls["lifeos_health_vitality"] = healthVitality;
  sessionServer.registerTool("lifeos_health_vitality", {
    description: "Health & vitality report: nutrition, exercise, sleep, mood scores.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  }, healthVitality);

  // ═══ 31. lifeos_financial_productivity ═══
  const financialProductivity = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const [finResult, activityResult] = await Promise.all([
      pg.query("financial_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
    ]);
    const finEntries = (finResult.rows as Row[]).map((r) => ({
      id: safeStr(r.id), name: safeStr(r.title || r.name), date: safeStr(r.date),
      amount: safeNum(r.amount), category: safeStr(r.category),
      capitalEngine: safeStr(r.capitalEngine), notes: safeStr(r.notes),
    }));
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const report = computeFinancialProductivity(finEntries, activities, dates.date_from, dates.date_to);
    return ok(financialProductivityToMarkdown(report));
  };
  sessionToolImpls["lifeos_financial_productivity"] = financialProductivity;
  sessionServer.registerTool("lifeos_financial_productivity", {
    description: "Finance × productivity correlation: revenue per work hour, revenue by category/engine.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  }, financialProductivity);

  // ═══ 32. lifeos_weekly_review ═══
  const weeklyReview = async (): Promise<ToolResult> => {
    const dates = resolveDates("past_week" as const);
    const [activityResult, taskResult, subjResult, finResult, goalsResult] = await Promise.all([
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("tasks"),
      pg.query("subjective_journal", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("financial_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("quarterly_goals"),
    ]);
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const tasks = (taskResult.rows as Row[]).map(transformTask);
    const finRows = finResult.rows as Row[];
    const revCats = ["Business Revenue", "Client Payment", "Investment Income", "Income"];
    const weekRevenue = finRows.filter((r) => revCats.includes(safeStr(r.category))).reduce((s, r) => s + (safeNum(r.amount) ?? 0), 0);
    const weekExpenses = finRows.filter((r) => !revCats.includes(safeStr(r.category))).reduce((s, r) => s + (safeNum(r.amount) ?? 0), 0);
    const tasksDone = tasks.filter((t) => safeStr(t.status) === "Done").length;
    const tasksOverdue = tasks.filter((t) => t.isOverdue).length;
    const lines = [`# Weekly Review — ${dates.rangeLabel}`, ""];
    lines.push(`## Productivity`);
    const totalHours = activities.reduce((s, a) => s + (a.durationHours ?? 0), 0);
    lines.push(`- **Hours tracked:** ${totalHours.toFixed(1)}h`);
    lines.push(`- **Tasks completed:** ${tasksDone}`);
    lines.push(`- **Tasks overdue:** ${tasksOverdue}`);
    lines.push(`- **Journal entries:** ${subjResult.rows.length}`);
    lines.push("");
    lines.push(`## Finance`);
    lines.push(`- **Revenue:** ₹${weekRevenue.toLocaleString()}`);
    lines.push(`- **Expenses:** ₹${weekExpenses.toLocaleString()}`);
    lines.push(`- **Net:** ₹${(weekRevenue - weekExpenses).toLocaleString()}`);
    lines.push("");
    lines.push(`## Goals Progress`);
    for (const g of (goalsResult.rows as Row[]).slice(0, 5)) {
      lines.push(`- ${safeStr(g.name)}: ${safeNum(g.progress) ?? 0}% (${safeStr(g.status)})`);
    }
    lines.push("");
    const byType = new Map<string, number>();
    for (const a of activities) byType.set(a.activityType, (byType.get(a.activityType) || 0) + (a.durationHours ?? 0));
    lines.push(`## Time Allocation`);
    for (const [type, hrs] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${type}: ${hrs.toFixed(1)}h`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_weekly_review"] = weeklyReview;
  sessionServer.registerTool("lifeos_weekly_review", {
    description: "Weekly synthesis across productivity, journaling, strategy, and finance domains.",
    inputSchema: z.object({}),
  }, weeklyReview);

  // ═══ 33. lifeos_monthly_synthesis ═══
  const monthlySynthesis = async (): Promise<ToolResult> => {
    const dates = resolveDates("past_month" as const);
    const [activityResult, taskResult, finResult, subjResult, goalsResult] = await Promise.all([
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("tasks"),
      pg.query("financial_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("subjective_journal", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("quarterly_goals"),
    ]);
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const tasks = (taskResult.rows as Row[]).map(transformTask);
    const finRows = finResult.rows as Row[];
    const revCats = ["Business Revenue", "Client Payment", "Investment Income", "Income"];
    const monthRevenue = finRows.filter((r) => revCats.includes(safeStr(r.category))).reduce((s, r) => s + (safeNum(r.amount) ?? 0), 0);
    const monthExpenses = finRows.filter((r) => !revCats.includes(safeStr(r.category))).reduce((s, r) => s + (safeNum(r.amount) ?? 0), 0);
    const tasksDone = tasks.filter((t) => safeStr(t.status) === "Done").length;
    const lines = [`# Monthly Synthesis — ${dates.rangeLabel}`, ""];
    lines.push(`## Overview`);
    const totalHours = activities.reduce((s, a) => s + (a.durationHours ?? 0), 0);
    lines.push(`- **Tracked hours:** ${totalHours.toFixed(1)}h (${(totalHours / dates.calendarDays).toFixed(1)}h/day avg)`);
    lines.push(`- **Tasks completed:** ${tasksDone}`);
    lines.push(`- **Revenue:** ₹${monthRevenue.toLocaleString()}`);
    lines.push(`- **Expenses:** ₹${monthExpenses.toLocaleString()}`);
    lines.push(`- **Journal entries:** ${subjResult.rows.length}`);
    lines.push("");
    lines.push(`## Time Allocation`);
    const byType = new Map<string, number>();
    for (const a of activities) byType.set(a.activityType, (byType.get(a.activityType) || 0) + (a.durationHours ?? 0));
    for (const [type, hrs] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      const pct = totalHours > 0 ? ((hrs / totalHours) * 100).toFixed(0) : "0";
      lines.push(`- ${type}: ${hrs.toFixed(1)}h (${pct}%)`);
    }
    lines.push("");
    lines.push(`## Goals`);
    for (const g of (goalsResult.rows as Row[]).slice(0, 8)) {
      lines.push(`- ${safeStr(g.name)}: ${safeNum(g.progress) ?? 0}% (${safeStr(g.status)})`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_monthly_synthesis"] = monthlySynthesis;
  sessionServer.registerTool("lifeos_monthly_synthesis", {
    description: "Monthly pattern analysis and trend synthesis across all domains.",
    inputSchema: z.object({}),
  }, monthlySynthesis);

  // ═══ 34. lifeos_quarterly_retrospective ═══
  const quarterlyRetrospective = async (): Promise<ToolResult> => {
    const now = new Date();
    const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
    const quarterStart = new Date(Date.UTC(now.getUTCFullYear(), (currentQuarter - 1) * 3, 1));
    const dates = {
      date_from: toISODate(quarterStart),
      date_to: toISODate(now),
      rangeLabel: `${toISODate(quarterStart)} → ${toISODate(now)} (Q${currentQuarter})`,
    };
    const [goalsResult, activityResult, taskResult, finResult, projResult] = await Promise.all([
      pg.query("quarterly_goals"),
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("tasks"),
      pg.query("financial_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("projects"),
    ]);
    const goals = goalsResult.rows as Row[];
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const tasks = (taskResult.rows as Row[]).map(transformTask);
    const finRows = finResult.rows as Row[];
    const revCats = ["Business Revenue", "Client Payment", "Investment Income", "Income"];
    const qRevenue = finRows.filter((r) => revCats.includes(safeStr(r.category))).reduce((s, r) => s + (safeNum(r.amount) ?? 0), 0);
    const totalHours = activities.reduce((s, a) => s + (a.durationHours ?? 0), 0);
    const tasksDone = tasks.filter((t) => safeStr(t.status) === "Done").length;
    const lines = [`# Quarterly Retrospective — Q${currentQuarter} ${now.getUTCFullYear()}`, "", `## Period: ${dates.rangeLabel}`, ""];
    lines.push(`## Goals Performance`);
    for (const g of goals) {
      lines.push(`- ${safeStr(g.name)}: ${safeNum(g.progress) ?? 0}% (${safeStr(g.status)})`);
      if (g.keyLearning) lines.push(`  - Learning: ${safeStr(g.keyLearning).substring(0, 150)}`);
    }
    lines.push("");
    lines.push(`## Operations`);
    lines.push(`- **Hours tracked:** ${totalHours.toFixed(1)}h`);
    lines.push(`- **Tasks completed:** ${tasksDone}`);
    lines.push(`- **Revenue:** ₹${qRevenue.toLocaleString()}`);
    lines.push("");
    lines.push(`## Projects`);
    const activeProjects = (projResult.rows as Row[]).filter((p) => !["Done", "Cancelled"].includes(safeStr(p.status)));
    for (const p of activeProjects) {
      lines.push(`- ${safeStr(p.name)}: ${safeStr(p.status)} (Progress: ${safeNum(p.progress) ?? 0}%)`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_quarterly_retrospective"] = quarterlyRetrospective;
  sessionServer.registerTool("lifeos_quarterly_retrospective", {
    description: "Quarterly review with OKR progress, strategic alignment, and operations summary.",
    inputSchema: z.object({}),
  }, quarterlyRetrospective);

  // ═══ 35. lifeos_correlate ═══
  const correlate = async (args: { period?: "past_day" | "past_week" | "past_month"; date_from?: string; date_to?: string }): Promise<ToolResult> => {
    const dates = resolveDates(args.period, args.date_from, args.date_to);
    const [activityResult, finResult, subjResult] = await Promise.all([
      pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("financial_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      pg.query("subjective_journal", { date: { gte: dates.date_from, lte: dates.date_to } }),
    ]);
    const activities = (activityResult.rows as Row[]).map(transformActivity);
    const finRows = finResult.rows as Row[];
    const subjRows = subjResult.rows as Row[];
    const totalHours = activities.reduce((s, a) => s + (a.durationHours ?? 0), 0);
    const revCats = ["Business Revenue", "Client Payment", "Investment Income", "Income"];
    const totalRevenue = finRows.filter((r) => revCats.includes(safeStr(r.category))).reduce((s, r) => s + (safeNum(r.amount) ?? 0), 0);
    const workHours = activities.filter((a) => a.activityType.toLowerCase().includes("work")).reduce((s, a) => s + (a.durationHours ?? 0), 0);
    const revPerHour = workHours > 0 ? totalRevenue / workHours : 0;
    const moodEntries = subjRows.filter((r) => safeStr(r.mood));
    const lines = [`# Cross-Domain Correlation — ${dates.rangeLabel}`, ""];
    lines.push(`## Activity ↔ Finance`);
    lines.push(`- Work hours: ${workHours.toFixed(1)}h | Revenue: ₹${totalRevenue.toLocaleString()}`);
    lines.push(`- Revenue per work hour: ₹${revPerHour.toFixed(2)}`);
    lines.push(`- Total activity hours: ${totalHours.toFixed(1)}h`);
    lines.push("");
    lines.push(`## Activity ↔ Mood`);
    if (moodEntries.length > 0 && activities.length > 0) {
      const moodActivityMap = new Map<string, number>();
      for (const s of subjRows) {
        const mood = safeStr(s.mood);
        const dayActivities = activities.filter((a) => a.date && a.date.split("T")[0] === safeStr(s.date)?.split("T")[0]);
        const dayHours = dayActivities.reduce((sum, a) => sum + (a.durationHours ?? 0), 0);
        if (mood && dayHours > 0) moodActivityMap.set(mood, (moodActivityMap.get(mood) || 0) + dayHours);
      }
      for (const [mood, hrs] of [...moodActivityMap.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`- ${mood}: ${hrs.toFixed(1)}h avg activity`);
      }
    } else {
      lines.push("Insufficient data for mood correlation.");
    }
    lines.push("");
    const dailyHours = new Map<string, number>();
    for (const a of activities) {
      if (!a.date) continue;
      const dayKey = a.date.split("T")[0];
      dailyHours.set(dayKey, (dailyHours.get(dayKey) || 0) + (a.durationHours ?? 0));
    }
    const dailyRevenue = new Map<string, number>();
    for (const f of finRows) {
      if (!f.date) continue;
      const dayKey = safeStr(f.date).split("T")[0];
      if (revCats.includes(safeStr(f.category))) dailyRevenue.set(dayKey, (dailyRevenue.get(dayKey) || 0) + (safeNum(f.amount) ?? 0));
    }
    if (dailyHours.size > 2 && dailyRevenue.size > 2) {
      lines.push(`## Daily Activity vs Revenue Correlation`);
      const commonDays = [...dailyHours.keys()].filter((d) => dailyRevenue.has(d));
      if (commonDays.length > 2) {
        const hVals = commonDays.map((d) => dailyHours.get(d)!);
        const rVals = commonDays.map((d) => dailyRevenue.get(d)!);
        const hMean = hVals.reduce((s, v) => s + v, 0) / hVals.length;
        const rMean = rVals.reduce((s, v) => s + v, 0) / rVals.length;
        let num = 0, dH = 0, dR = 0;
        for (let i = 0; i < commonDays.length; i++) {
          const dh = hVals[i] - hMean;
          const dr = rVals[i] - rMean;
          num += dh * dr;
          dH += dh * dh;
          dR += dr * dr;
        }
        const corr = dH > 0 && dR > 0 ? num / Math.sqrt(dH * dR) : 0;
        lines.push(`- Pearson r: ${corr.toFixed(3)} (${Math.abs(corr) > 0.5 ? "moderate" : "weak"} correlation)`);
      }
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_correlate"] = correlate;
  sessionServer.registerTool("lifeos_correlate", {
    description: "Cross-domain correlation analysis: activity↔finance, activity↔mood, daily patterns.",
    inputSchema: z.object({
      period: z.enum(["past_day", "past_week", "past_month"]).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  }, correlate);

  // ═══ 36. lifeos_planning_ops ═══
  const planningOps = async (args: { action: "morning_planner" | "weekly_review" | "habit_compliance" }): Promise<ToolResult> => {
    if (args.action === "morning_planner") {
      const today = toISODate(new Date());
      const dow = new Date().getDay();
      const [tasksResult, activityResult, goalsResult] = await Promise.all([
        pg.query("tasks", { status: { in: ["Active", "Focus", "Up Next"] } }, { orderBy: [{ column: "actionDate", direction: "asc" }], limit: 20 }),
        pg.query("activity_log", { date: { gte: toISODate(startOfDay(new Date(Date.now() - 7 * 86400000))) } }),
        pg.query("quarterly_goals", { status: { in: ["On Track", "At Risk"] } }),
      ]);
      const tasks = (tasksResult.rows as Row[]).map(transformTask);
      const activities = (activityResult.rows as Row[]).map(transformActivity);
      const goals = goalsResult.rows as Row[];
      const lines = [`# Morning Planner — ${today}`, ""];
      const focusTasks = tasks.filter((t) => safeStr(t.status) === "Focus");
      if (focusTasks.length > 0) {
        lines.push(`## 🎯 Focus Tasks`);
        for (const t of focusTasks.slice(0, 3)) lines.push(`- ${t.name}`);
        lines.push("");
      }
      const overdue = tasks.filter((t) => t.isOverdue);
      if (overdue.length > 0) {
        lines.push(`## ⚠️ Overdue (${overdue.length})`);
        for (const t of overdue.slice(0, 5)) lines.push(`- ${t.name} (was due: ${fmtDateTime(t.actionDate)})`);
        lines.push("");
      }
      const totalHours = activities.reduce((s, a) => s + (a.durationHours ?? 0), 0);
      lines.push(`## Yesterday's Activity: ${activities.length} entries, ${totalHours.toFixed(1)}h`);
      const byType = new Map<string, number>();
      for (const a of activities) byType.set(a.activityType, (byType.get(a.activityType) || 0) + (a.durationHours ?? 0));
      for (const [type, hrs] of [...byType.entries()].sort((a, b) => b[1] - a[1])) lines.push(`- ${type}: ${hrs.toFixed(1)}h`);
      lines.push("");
      lines.push(`## Goals Status`);
      for (const g of goals.slice(0, 5)) lines.push(`- ${safeStr(g.name)}: ${safeNum(g.progress) ?? 0}% (${safeStr(g.status)})`);
      return ok(lines.join("\n"));
    }
    if (args.action === "weekly_review") {
      const dates = resolveDates("past_week" as const);
      const [activityResult, taskResult, finResult] = await Promise.all([
        pg.query("activity_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
        pg.query("tasks"),
        pg.query("financial_log", { date: { gte: dates.date_from, lte: dates.date_to } }),
      ]);
      const activities = (activityResult.rows as Row[]).map(transformActivity);
      const tasks = (taskResult.rows as Row[]).map(transformTask);
      const finRows = finResult.rows as Row[];
      const revCats = ["Business Revenue", "Client Payment", "Investment Income", "Income"];
      const weekRev = finRows.filter((r) => revCats.includes(safeStr(r.category))).reduce((s, r) => s + (safeNum(r.amount) ?? 0), 0);
      const weekExp = finRows.filter((r) => !revCats.includes(safeStr(r.category))).reduce((s, r) => s + (safeNum(r.amount) ?? 0), 0);
      const totalHours = activities.reduce((s, a) => s + (a.durationHours ?? 0), 0);
      const tasksDone = tasks.filter((t) => safeStr(t.status) === "Done").length;
      const lines = [`# Weekly Review — ${dates.rangeLabel}`, ""];
      lines.push(`- **Hours tracked:** ${totalHours.toFixed(1)}h`);
      lines.push(`- **Tasks completed:** ${tasksDone}`);
      lines.push(`- **Revenue:** ₹${weekRev.toLocaleString()}`);
      lines.push(`- **Expenses:** ₹${weekExp.toLocaleString()}`);
      lines.push(`- **Net:** ₹${(weekRev - weekExp).toLocaleString()}`);
      return ok(lines.join("\n"));
    }
    const habits = await Promise.all([
      pg.query("activity_types", { isHabit: { eq: true } }),
      pg.query("activity_log", { isHabitActivity: { eq: true }, date: { gte: toISODate(startOfDay(new Date(Date.now() - 7 * 86400000))) } }),
    ]);
    const habitTypes = habits[0].rows as Row[];
    const habitEntries = (habits[1].rows as Row[]).map(transformActivity);
    const lines = ["# Habit Compliance\n"];
    for (const ht of habitTypes) {
      const name = safeStr(ht.name);
      const count = habitEntries.filter((a) => a.activityType === name).length;
      const multiplier = frequencyToWeeklyMultiplier(safeStr(ht.frequency));
      lines.push(`- **${name}:** ${count}/${multiplier} this week (${((count / multiplier) * 100).toFixed(0)}%)`);
    }
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_planning_ops"] = planningOps;
  sessionServer.registerTool("lifeos_planning_ops", {
    description: "Planning operations: morning planner, weekly review summary, or habit compliance check.",
    inputSchema: z.object({
      action: z.enum(["morning_planner", "weekly_review", "habit_compliance"]).describe("Which planning operation to run"),
    }),
  }, planningOps);

  // ═══ 37. lifeos_create_entry ═══
  const createEntry = async (args: { table: string; data: Record<string, unknown> }): Promise<ToolResult> => {
    const tableKey = resolveTableKey(args.table, config);
    const table = tables[tableKey];
    const result = await pg.insert(tableKey, args.data);
    return ok(`Created entry in **${table.name}** (\`${tableKey}\`)\n\n- **ID:** ${result.id}\n- **Data:** ${JSON.stringify(args.data, null, 2)}`);
  };
  sessionToolImpls["lifeos_create_entry"] = createEntry;
  sessionServer.registerTool("lifeos_create_entry", {
    description: "Insert a new row into any LifeOS table. Pass table key and data object with camelCase column names.",
    inputSchema: z.object({
      table: z.string().describe("Table key (e.g., 'tasks', 'projects', 'subjective_journal')"),
      data: z.record(z.unknown()).describe("Column values as object with camelCase keys"),
    }),
  }, createEntry);

  // ═══ 38. lifeos_update_entry ═══
  const updateEntry = async (args: { table: string; id: string; data: Record<string, unknown> }): Promise<ToolResult> => {
    const tableKey = resolveTableKey(args.table, config);
    const table = tables[tableKey];
    const result = await pg.update(tableKey, args.id, args.data);
    if (result.affected === 0) return ok(`No entry found with ID \`${args.id}\` in \`${tableKey}\`.`);
    return ok(`Updated entry in **${table.name}** (\`${tableKey}\`)\n\n- **ID:** ${args.id}\n- **Affected:** ${result.affected}\n- **Data:** ${JSON.stringify(args.data, null, 2)}`);
  };
  sessionToolImpls["lifeos_update_entry"] = updateEntry;
  sessionServer.registerTool("lifeos_update_entry", {
    description: "Update a row by ID in any LifeOS table.",
    inputSchema: z.object({
      table: z.string().describe("Table key"),
      id: z.string().describe("Entry ID (UUID)"),
      data: z.record(z.unknown()).describe("Column values to update"),
    }),
  }, updateEntry);

  // ═══ 39. lifeos_delete_entry ═══
  const deleteEntry = async (args: { table: string; id: string }): Promise<ToolResult> => {
    const tableKey = resolveTableKey(args.table, config);
    const table = tables[tableKey];
    const result = await pg.delete(tableKey, args.id);
    if (result.affected === 0) return ok(`No entry found with ID \`${args.id}\` in \`${tableKey}\`.`);
    return ok(`Deleted entry from **${table.name}** (\`${tableKey}\`)\n\n- **ID:** ${args.id}\n- **Affected:** ${result.affected}`);
  };
  sessionToolImpls["lifeos_delete_entry"] = deleteEntry;
  sessionServer.registerTool("lifeos_delete_entry", {
    description: "Delete (or archive) a row by ID. Tables with an isArchived column will soft-delete.",
    inputSchema: z.object({
      table: z.string().describe("Table key"),
      id: z.string().describe("Entry ID (UUID)"),
    }),
  }, deleteEntry);

  // ═══ 40. lifeos_find_entry ═══
  const findEntry = async (args: { table: string; search: string; limit?: number }): Promise<ToolResult> => {
    const tableKey = resolveTableKey(args.table, config);
    const result = await pg.query(tableKey, { name: { like: `%${args.search}%` } }, { limit: args.limit ?? 20 });
    const altResult = (result.rows as Row[]).length === 0
      ? await pg.query(tableKey, { title: { like: `%${args.search}%` } }, { limit: args.limit ?? 20 })
      : result;
    const rows = (altResult.rows as Row[]).length > 0 ? altResult.rows : result.rows;
    const lines = [`## Search: "${args.search}" in ${tableKey}`, "", `**Results:** ${rows.length}`];
    for (const r of rows as Row[]) {
      const id = safeStr(r.id);
      const name = safeStr(r.name || r.title || "Untitled");
      const status = safeStr(r.status);
      const date = safeStr(r.date || r.actionDate || r.createdDate);
      lines.push(`- **${name}** (\`${id}\`)${status ? ` — ${status}` : ""}${date ? ` — ${fmtDate(date)}` : ""}`);
    }
    if ((rows as Row[]).length === 0) lines.push("\nNo matches found. Try a different search term or table.");
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_find_entry"] = findEntry;
  sessionServer.registerTool("lifeos_find_entry", {
    description: "Search entries by name or title in any table. Returns matching entries with IDs for use with update_entry/delete_entry.",
    inputSchema: z.object({
      table: z.string().describe("Table key to search in"),
      search: z.string().describe("Search term (partial match on name/title)"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    }),
  }, findEntry);

  // ═══ 41. lifeos_create_report ═══
  const createReport = async (args: { title: string; content: string; period?: string; tags?: string }): Promise<ToolResult> => {
    const data: Record<string, unknown> = {
      title: args.title,
      content: args.content,
      createdAt: new Date().toISOString(),
    };
    if (args.period) data.period = args.period;
    if (args.tags) data.tags = args.tags.split(",").map((t) => t.trim());
    const result = await pg.insert("reports", data);
    return ok(`Report saved to Reports DB\n\n- **ID:** ${result.id}\n- **Title:** ${args.title}${args.period ? `\n- **Period:** ${args.period}` : ""}`);
  };
  sessionToolImpls["lifeos_create_report"] = createReport;
  sessionServer.registerTool("lifeos_create_report", {
    description: "Save a structured analysis report to the Reports database.",
    inputSchema: z.object({
      title: z.string().describe("Report title"),
      content: z.string().describe("Report content (markdown)"),
      period: z.string().optional().describe("Time period (e.g., 'past_week')"),
      tags: z.string().optional().describe("Comma-separated tags"),
    }),
  }, createReport);

  // ═══ 42. lifeos_log_activity ═══
  const logActivity = async (args: { name: string; activityType: string; date?: string; durationHours?: number; notes?: string; isHabit?: boolean; energy?: string; moodDelta?: string; projects?: string[] }): Promise<ToolResult> => {
    const data: Record<string, unknown> = {
      name: args.name,
      activityType: args.activityType,
      date: args.date || toISODate(new Date()),
      isHabitActivity: args.isHabit ?? false,
    };
    if (args.durationHours != null) data.durationHrs = args.durationHours;
    if (args.notes) data.activityNotes = args.notes;
    if (args.energy) data.energy = args.energy;
    if (args.moodDelta) data.moodDelta = args.moodDelta;
    if (args.projects && args.projects.length > 0) data.projects = args.projects;
    const result = await pg.insert("activity_log", data);
    const durStr = args.durationHours != null ? ` (${args.durationHours}h)` : "";
    return ok(`Activity logged${durStr}\n\n- **ID:** ${result.id}\n- **Name:** ${args.name}\n- **Type:** ${args.activityType}\n- **Date:** ${data.date}`);
  };
  sessionToolImpls["lifeos_log_activity"] = logActivity;
  sessionServer.registerTool("lifeos_log_activity", {
    description: "Log a time-tracked activity entry with type, duration, and optional energy/mood.",
    inputSchema: z.object({
      name: z.string().describe("Activity name"),
      activityType: z.string().describe("Activity type (e.g., Work, Recreation, Workout, Sleep, Study)"),
      date: z.string().optional().describe("Date (YYYY-MM-DD, defaults to today)"),
      durationHours: z.number().optional().describe("Duration in hours"),
      notes: z.string().optional().describe("Activity notes"),
      isHabit: z.boolean().optional().describe("Whether this is a habit activity"),
      energy: z.string().optional().describe("Energy level (High/Medium/Low)"),
      moodDelta: z.string().optional().describe("Mood change (↑/→/↓)"),
      projects: z.array(z.string()).optional().describe("Linked project IDs"),
    }),
  }, logActivity);

  // ═══ 43. lifeos_complete_task ═══
  const completeTask = async (args: { search: string }): Promise<ToolResult> => {
    const result = await pg.query("tasks", { name: { like: `%${args.search}%` }, status: { in: ["Active", "Focus", "Up Next", "Waiting", "Paused"] } }, { limit: 10 });
    const rows = result.rows as Row[];
    if (rows.length === 0) return ok(`No active tasks found matching "${args.search}".`);
    if (rows.length === 1) {
      const task = rows[0];
      const updateResult = await pg.update("tasks", safeStr(task.id), { status: "Done", completedDate: new Date().toISOString() });
      return ok(`Task completed: **${safeStr(task.name)}**\n\n- **ID:** ${safeStr(task.id)}\n- **Affected:** ${updateResult.affected}`);
    }
    const lines = [`Multiple tasks match "${args.search}". Specify which one:`, ""];
    for (const t of rows) lines.push(`- **${safeStr(t.name)}** (\`${safeStr(t.id)}\`) — ${safeStr(t.status)}`);
    return ok(lines.join("\n"));
  };
  sessionToolImpls["lifeos_complete_task"] = completeTask;
  sessionServer.registerTool("lifeos_complete_task", {
    description: "Mark a task as Done by searching its name. Auto-completes if only one match.",
    inputSchema: z.object({
      search: z.string().describe("Task name to search for"),
    }),
  }, completeTask);

  // ═══ 44. lifeos_log_transaction ═══
  const logTransaction = async (args: { title: string; amount: number; category: string; date?: string; capitalEngine?: string; notes?: string }): Promise<ToolResult> => {
    const data: Record<string, unknown> = {
      title: args.title,
      amount: args.amount,
      category: args.category,
      date: args.date || toISODate(new Date()),
    };
    if (args.capitalEngine) data.capitalEngine = args.capitalEngine;
    if (args.notes) data.notes = args.notes;
    const result = await pg.insert("financial_log", data);
    return ok(`Transaction logged\n\n- **ID:** ${result.id}\n- **Title:** ${args.title}\n- **Amount:** ₹${args.amount.toLocaleString()}\n- **Category:** ${args.category}\n- **Date:** ${data.date}`);
  };
  sessionToolImpls["lifeos_log_transaction"] = logTransaction;
  sessionServer.registerTool("lifeos_log_transaction", {
    description: "Log a financial transaction with amount, category, and optional capital engine.",
    inputSchema: z.object({
      title: z.string().describe("Transaction description"),
      amount: z.number().describe("Transaction amount"),
      category: z.string().describe("Category (e.g., Business Revenue, Client Payment, Expense)"),
      date: z.string().optional().describe("Date (YYYY-MM-DD, defaults to today)"),
      capitalEngine: z.string().optional().describe("Capital engine (E/S/B/I)"),
      notes: z.string().optional().describe("Transaction notes"),
    }),
  }, logTransaction);

  // ═══ 45. lifeos_journal_entry ═══
  const journalEntry = async (args: { type: "subjective" | "relational" | "systemic" | "diet"; title: string; content: string; date?: string; mood?: string; energy?: string; impactLevel?: string; personName?: string; nutrition?: string }): Promise<ToolResult> => {
    const tableMap: Record<string, string> = {
      subjective: "subjective_journal",
      relational: "relational_journal",
      systemic: "systemic_journal",
      diet: "diet_log",
    };
    const tableKey = tableMap[args.type];
    if (!tableKey) return ok(`Unknown journal type: ${args.type}. Use: subjective, relational, systemic, diet.`);
    const data: Record<string, unknown> = {
      title: args.title,
      date: args.date || toISODate(new Date()),
    };
    if (args.content) {
      if (tableKey === "subjective_journal") data.reflection = args.content;
      else if (tableKey === "relational_journal") data.reflection = args.content;
      else if (tableKey === "systemic_journal") data.insight = args.content;
      else if (tableKey === "diet_log") data.nutrition = args.content;
    }
    if (args.mood) data.mood = args.mood;
    if (args.energy) data.energy = args.energy;
    if (args.impactLevel) data.impactLevel = args.impactLevel;
    if (args.personName) data.personName = args.personName;
    if (args.nutrition) data.nutrition = args.nutrition;
    const result = await pg.insert(tableKey, data);
    return ok(`Journal entry created\n\n- **ID:** ${result.id}\n- **Type:** ${args.type}\n- **Title:** ${args.title}\n- **Date:** ${data.date}`);
  };
  sessionToolImpls["lifeos_journal_entry"] = journalEntry;
  sessionServer.registerTool("lifeos_journal_entry", {
    description: "Create a journal entry in any journal database (subjective, relational, systemic, or diet).",
    inputSchema: z.object({
      type: z.enum(["subjective", "relational", "systemic", "diet"]).describe("Journal type"),
      title: z.string().describe("Entry title"),
      content: z.string().describe("Entry content (main text body)"),
      date: z.string().optional().describe("Date (YYYY-MM-DD, defaults to today)"),
      mood: z.string().optional().describe("Mood (for subjective journal)"),
      energy: z.string().optional().describe("Energy level (for subjective journal)"),
      impactLevel: z.string().optional().describe("Impact level P1-P5 (for systemic journal)"),
      personName: z.string().optional().describe("Person name (for relational journal)"),
      nutrition: z.string().optional().describe("Nutrition details (for diet log)"),
    }),
  }, journalEntry);
}
