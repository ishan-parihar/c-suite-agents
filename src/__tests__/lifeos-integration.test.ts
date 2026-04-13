import "dotenv/config";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { PostgresClient } from "../lifeos/postgres/client.js";
import { loadConfigFromPath, getTablesByAgent, type OperantConfig, type AgentDomain } from "../lifeos/config.js";
import { getAgentToolScope } from "../staff/tool-scoping.js";
import { getAllToolDefinitions } from "../runtime/tool-bridge.js";

const LIFEOS_DATABASE_URL = process.env.LIFEOS_DATABASE_URL || process.env.DATABASE_URL;
const LIFEOS_CONFIG_PATH = process.env.LIFEOS_CONFIG_PATH;
const shouldSkip = () => !LIFEOS_DATABASE_URL;

const CONFIG_PATH = process.cwd() + "/../operant-mcp/operant.config.json";

const lifeosTools = [
  "lifeos_discover", "lifeos_query", "lifeos_query_db_schema", "lifeos_context_card",
  "lifeos_tasks", "lifeos_projects", "lifeos_quarterly_goals", "lifeos_annual_goals",
  "lifeos_directives_risks", "lifeos_opportunities_strengths",
  "lifeos_subjective_journal", "lifeos_relational_journal", "lifeos_systemic_journal",
  "lifeos_financial_log", "lifeos_diet_log", "lifeos_content", "lifeos_campaigns",
  "lifeos_people_ops", "lifeos_finance_ops", "lifeos_alignment",
  "lifeos_project_health", "lifeos_okrs_progress", "lifeos_journal_synthesis",
  "lifeos_financial_accounts", "lifeos_productivity_report", "lifeos_daily_briefing",
  "lifeos_temporal_analysis", "lifeos_trajectory", "lifeos_weekday_patterns",
  "lifeos_health_vitality", "lifeos_financial_productivity", "lifeos_weekly_review",
  "lifeos_monthly_synthesis", "lifeos_quarterly_retrospective", "lifeos_correlate",
  "lifeos_planning_ops", "lifeos_create_entry", "lifeos_update_entry",
  "lifeos_delete_entry", "lifeos_find_entry", "lifeos_create_report",
  "lifeos_log_activity", "lifeos_complete_task", "lifeos_log_transaction",
  "lifeos_journal_entry",
];

// ---------------------------------------------------------------------------
// PostgresClient tests
// ---------------------------------------------------------------------------

describe("PostgresClient", () => {
  let client: PostgresClient;

  beforeAll(() => {
    if (shouldSkip()) return;
    client = new PostgresClient(LIFEOS_DATABASE_URL!);
  });

  afterAll(async () => {
    if (client) await client.close();
  });

  test.skipIf(shouldSkip())("connects and lists tables", async () => {
    const tables = await client.listTables();
    expect(tables.length).toBeGreaterThan(20);
    expect(tables).toContain("activity_log");
    expect(tables).toContain("tasks");
    expect(tables).toContain("projects");
    expect(tables).toContain("subjective_journal");
    expect(tables).toContain("financial_log");
    expect(tables).toContain("diet_log");
  });

  test.skipIf(shouldSkip())("queries a table with no filters", async () => {
    const result = await client.query("tasks", undefined, { limit: 5 });
    expect(result.rows).toBeArray();
    expect(result.rows.length).toBeLessThanOrEqual(5);
  });

  test.skipIf(shouldSkip())("queries with filters", async () => {
    const result = await client.query("tasks", { status: { eq: "Done" } }, { limit: 10 });
    expect(result.rows).toBeArray();
    for (const row of result.rows) {
      expect((row as Record<string, unknown>).status).toBe("Done");
    }
  });

  test.skipIf(shouldSkip())("gets schema for a table", async () => {
    const schema = await client.getSchema("tasks");
    expect(schema.tableName).toBe("tasks");
    expect(schema.columns.length).toBeGreaterThan(0);
    expect(schema.columns.some(c => c.name === "name")).toBe(true);
  });

  test.skipIf(shouldSkip())("throws on unknown table", async () => {
    await expect(client.query("nonexistent_table")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Config loading tests
// ---------------------------------------------------------------------------

describe("LifeOS config", () => {
  test.skipIf(!LIFEOS_CONFIG_PATH)("loads config from path", () => {
    const config = loadConfigFromPath(LIFEOS_CONFIG_PATH!);
    expect(config.tables).toBeDefined();
    expect(Object.keys(config.tables).length).toBeGreaterThan(20);
  });

  test("getTablesByAgent returns productivity tables", () => {
    const config = loadConfigFromPath(CONFIG_PATH);
    const prodTables = getTablesByAgent(config as any, "productivity");
    expect(Object.keys(prodTables).length).toBeGreaterThan(0);
    expect(prodTables).toHaveProperty("tasks");
    expect(prodTables).toHaveProperty("activity_log");
  });

  test("getTablesByAgent returns journaling tables", () => {
    const config = loadConfigFromPath(CONFIG_PATH);
    const journalTables = getTablesByAgent(config as any, "journaling");
    expect(Object.keys(journalTables).length).toBeGreaterThan(0);
    expect(journalTables).toHaveProperty("subjective_journal");
  });

  test("getTablesByAgent returns strategic tables", () => {
    const config = loadConfigFromPath(CONFIG_PATH);
    const stratTables = getTablesByAgent(config as any, "strategic");
    expect(Object.keys(stratTables).length).toBeGreaterThan(0);
    expect(stratTables).toHaveProperty("projects");
    expect(stratTables).toHaveProperty("quarterly_goals");
  });
});

// ---------------------------------------------------------------------------
// Tool definitions tests
// ---------------------------------------------------------------------------

describe("LifeOS tool definitions", () => {
  test("all 45 LifeOS tools are in getAllToolDefinitions", () => {
    const allDefs = getAllToolDefinitions();
    const allNames = allDefs.map(d => d.name);

    for (const tool of lifeosTools) {
      expect(allNames, `Missing tool definition: ${tool}`).toContain(tool);
    }
  });

  test("write tools have correct permissionTier", () => {
    const allDefs = getAllToolDefinitions();
    const writeTools = ["lifeos_create_entry", "lifeos_update_entry", "lifeos_delete_entry",
      "lifeos_create_report", "lifeos_log_activity", "lifeos_complete_task",
      "lifeos_log_transaction", "lifeos_journal_entry"];

    for (const def of allDefs) {
      if (writeTools.includes(def.name)) {
        expect(def.permissionTier, `${def.name} should be write tier`).toBe("write");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Per-agent tool scoping tests
// ---------------------------------------------------------------------------

describe("LifeOS per-agent tool scoping", () => {
  test("CEO has all 45 LifeOS tools", () => {
    const scope = getAgentToolScope("ceo-strategic");
    const lifeos = scope.filter(t => t.startsWith("lifeos_"));
    expect(lifeos.length).toBe(45);
  });

  test("COO has productivity LifeOS tools", () => {
    const scope = getAgentToolScope("coo-productivity");
    const lifeos = scope.filter(t => t.startsWith("lifeos_"));
    expect(lifeos.length).toBeGreaterThan(10);
    expect(lifeos).toContain("lifeos_tasks");
    expect(lifeos).toContain("lifeos_projects");
  });

  test("CFO has financial LifeOS tools", () => {
    const scope = getAgentToolScope("cfo-financial");
    const lifeos = scope.filter(t => t.startsWith("lifeos_"));
    expect(lifeos).toContain("lifeos_financial_log");
    expect(lifeos).toContain("lifeos_financial_accounts");
  });

  test("CMO has content LifeOS tools", () => {
    const scope = getAgentToolScope("cmo-content");
    const lifeos = scope.filter(t => t.startsWith("lifeos_"));
    expect(lifeos).toContain("lifeos_content");
    expect(lifeos).toContain("lifeos_campaigns");
  });

  test("CRO has relational LifeOS tools", () => {
    const scope = getAgentToolScope("cro-relational");
    const lifeos = scope.filter(t => t.startsWith("lifeos_"));
    expect(lifeos).toContain("lifeos_relational_journal");
    expect(lifeos).toContain("lifeos_people_ops");
  });

  test("CIO has analysis LifeOS tools", () => {
    const scope = getAgentToolScope("cio-intelligence");
    const lifeos = scope.filter(t => t.startsWith("lifeos_"));
    expect(lifeos).toContain("lifeos_temporal_analysis");
    expect(lifeos).toContain("lifeos_correlate");
    expect(lifeos).toContain("lifeos_trajectory");
  });

  test("CPO has journaling LifeOS tools", () => {
    const scope = getAgentToolScope("cpo-psychologist");
    const lifeos = scope.filter(t => t.startsWith("lifeos_"));
    expect(lifeos).toContain("lifeos_subjective_journal");
    expect(lifeos).toContain("lifeos_systemic_journal");
  });

  test("Physician has health LifeOS tools", () => {
    const scope = getAgentToolScope("physician-health");
    const lifeos = scope.filter(t => t.startsWith("lifeos_"));
    expect(lifeos).toContain("lifeos_diet_log");
    expect(lifeos).toContain("lifeos_health_vitality");
  });

  test("CTO has read-only LifeOS tools (no write/delete)", () => {
    const scope = getAgentToolScope("cto-technical");
    const lifeos = scope.filter(t => t.startsWith("lifeos_"));
    expect(lifeos.length).toBeGreaterThan(20);
    expect(lifeos).not.toContain("lifeos_create_entry");
    expect(lifeos).not.toContain("lifeos_update_entry");
    expect(lifeos).not.toContain("lifeos_delete_entry");
    expect(lifeos).not.toContain("lifeos_log_transaction");
    expect(lifeos).not.toContain("lifeos_journal_entry");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: registerLifeOSTools
// ---------------------------------------------------------------------------

describe("registerLifeOSTools", () => {
  test.skipIf(shouldSkip())("registers all 45 tools when PG is configured", async () => {
    const { registerLifeOSTools } = await import("../lifeos/tools.js");
    const client = new PostgresClient(LIFEOS_DATABASE_URL!);
    const config = loadConfigFromPath(CONFIG_PATH);

    const sessionToolImpls: Record<string, (args: any) => Promise<any>> = {};
    const registeredTools: string[] = [];
    const mockServer = {
      registerTool: (name: string, _opts: any, _handler: Function) => {
        registeredTools.push(name);
      },
    };

    registerLifeOSTools(sessionToolImpls, mockServer as any, client, config);

    expect(registeredTools.length).toBe(45);
    expect(Object.keys(sessionToolImpls).length).toBe(45);
    expect(registeredTools).toContain("lifeos_discover");
    expect(registeredTools).toContain("lifeos_query");
    expect(registeredTools).toContain("lifeos_create_entry");
    expect(registeredTools).toContain("lifeos_journal_entry");

    await client.close();
  });
});
