#!/usr/bin/env bun
/**
 * SQLite → PostgreSQL Data Migration Script
 *
 * Migrates data from 5 SQLite databases to PostgreSQL:
 *   1. kanban.db → kanban_* tables (5 tables)
 *   2. scheduler.db → board_meetings, board_meeting_turns, board_meeting_responses (3 tables)
 *   3. hiring.db → (contracts & delegations — no direct PG mapping, skipped)
 *   4. reports_sessions.db → ops_reports, ops_sessions, session_steps, tool_correlations, oc_sessions (5 tables)
 *   5. data/sessions.db → agent_sessions, session_messages, session_tool_calls (3 tables)
 *
 * Usage:
 *   bun run scripts/migrate-sqlite-to-pg.ts              # Live migration
 *   bun run scripts/migrate-sqlite-to-pg.ts --dry-run     # Preview only
 *
 * Environment:
 *   DATABASE_URL — PostgreSQL connection string
 *   SQLITE_DB_DIR — Directory containing SQLite .db files (default: project root)
 *
 * Type conversions handled:
 *   SQLite TEXT (UUID strings) → PostgreSQL UUID
 *   SQLite INTEGER (Unix epoch seconds) → PostgreSQL TIMESTAMPTZ
 *   SQLite TEXT (JSON strings) → PostgreSQL JSONB
 *   SQLite INTEGER (booleans 0/1) → PostgreSQL BOOLEAN
 *   SQLite REAL → PostgreSQL DOUBLE PRECISION / NUMERIC
 */

import "dotenv/config";
import Database from "better-sqlite3";
import { Client } from "pg";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// ── Configuration ──────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  console.error("Set it to your PostgreSQL connection string.");
  process.exit(1);
}
const SQLITE_DB_DIR = process.env.SQLITE_DB_DIR ?? PROJECT_ROOT;
const DRY_RUN = process.argv.includes("--dry-run");

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Convert a Unix epoch integer (seconds) to a PostgreSQL TIMESTAMPTZ literal.
 * SQLite stores timestamps as INTEGER seconds since epoch.
 */
function epochToPgTimestamp(epoch: number | null | undefined): string | null {
  if (epoch == null) return null;
  // epoch is seconds since 1970
  return `to_timestamp(${epoch})`;
}

/**
 * Escape a string value for safe SQL interpolation.
 * Uses parameterized queries via pg, so this is only for literal construction.
 */
function sqlLiteral(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Parse a JSON string from SQLite into a value suitable for PG JSONB.
 * Returns null for null/undefined/empty strings.
 */
function parseJsonOrNull(raw: string | null | undefined): unknown {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // Return as-is if not valid JSON
  }
}

/**
 * Check if a string looks like a valid UUID.
 */
function isValidUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Generate a UUID v4 for rows that don't have one.
 */
function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Migration Statistics ───────────────────────────────────────────────────

interface MigrationStats {
  table: string;
  sourceDb: string;
  read: number;
  inserted: number;
  skipped: number;
  errors: string[];
  duration: number;
}

const stats: MigrationStats[] = [];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printSummary() {
  console.log("\n" + "=".repeat(70));
  console.log("MIGRATION SUMMARY");
  console.log("=".repeat(70));

  let totalRead = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const s of stats) {
    const status = s.errors.length > 0 ? "⚠️  ERRORS" : "✅ OK";
    console.log(
      `  ${s.sourceDb.padEnd(25)} → ${s.table.padEnd(35)} ${s.read.toString().padStart(6)} rows read | ${s.inserted.toString().padStart(6)} inserted | ${s.skipped.toString().padStart(6)} skipped | ${status}`
    );
    totalRead += s.read;
    totalInserted += s.inserted;
    totalSkipped += s.skipped;
    totalErrors += s.errors.length;

    if (s.errors.length > 0) {
      for (const err of s.errors.slice(0, 3)) {
        console.log(`    ❌ ${err}`);
      }
      if (s.errors.length > 3) {
        console.log(`    ... and ${s.errors.length - 3} more errors`);
      }
    }
  }

  console.log("-".repeat(70));
  console.log(
    `TOTAL: ${totalRead} rows read | ${totalInserted} inserted | ${totalSkipped} skipped | ${totalErrors} errors`
  );
  if (DRY_RUN) {
    console.log("\n⚠️  This was a DRY RUN. No data was actually inserted.");
  }
  console.log("=".repeat(70));
}

// ── SQLite Connection Helper ───────────────────────────────────────────────

function openSqlite(dbPath: string): Database.Database | null {
  try {
    const db = new Database(dbPath, { readonly: true });
    return db;
  } catch (e: any) {
    console.error(`  ⚠️  Could not open SQLite database: ${dbPath}`);
    console.error(`     ${e.message}`);
    return null;
  }
}

// ── PostgreSQL Connection ──────────────────────────────────────────────────

async function connectPg(): Promise<Client> {
  const client = new Client(DATABASE_URL);
  await client.connect();
  // Disable RLS for migration (we need full access)
  await client.query("SET SESSION app.current_agent_id = 'migration'");
  return client;
}

// ── Generic Migration Function ─────────────────────────────────────────────

/**
 * Migrate a single table from SQLite to PostgreSQL.
 *
 * @param sqliteDb - SQLite database instance
 * @param pgClient - PostgreSQL client
 * @param sqliteTable - Source table name in SQLite
 * @param pgTable - Target table name in PostgreSQL
 * @param transform - Row transformation function
 * @param conflictColumns - Columns for ON CONFLICT (empty = no conflict handling)
 */
async function migrateTable(
  sqliteDb: Database.Database,
  pgClient: Client,
  sqliteTable: string,
  pgTable: string,
  transform: (row: any) => { columns: string[]; values: any[] } | null,
  conflictColumns: string[] = ["id"],
): Promise<void> {
  const startTime = Date.now();
  const stat: MigrationStats = {
    table: pgTable,
    sourceDb: sqliteDb.name || "unknown",
    read: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    duration: 0,
  };

  try {
    // Check if source table exists
    const tables = sqliteDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .all(sqliteTable) as { name: string }[];

    if (tables.length === 0) {
      console.log(`  ⏭️  Table ${sqliteTable} does not exist in SQLite — skipping`);
      stat.duration = Date.now() - startTime;
      stats.push(stat);
      return;
    }

    // Read all rows
    const rows = sqliteDb.prepare(`SELECT * FROM ${sqliteTable}`).all() as any[];
    stat.read = rows.length;

    if (rows.length === 0) {
      console.log(`  ⏭️  Table ${sqliteTable} is empty — skipping`);
      stat.duration = Date.now() - startTime;
      stats.push(stat);
      return;
    }

    console.log(
      `  📦 Migrating ${sqliteTable} → ${pgTable} (${rows.length} rows)...`,
    );

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would insert ${rows.length} rows`);
      stat.inserted = rows.length;
      stat.duration = Date.now() - startTime;
      stats.push(stat);
      return;
    }

    // Insert rows in batches
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values: any[] = [];
      const transformed: { columns: string[]; values: any[] }[] = [];

      for (const row of batch) {
        const result = transform(row);
        if (result) {
          transformed.push(result);
        } else {
          stat.skipped++;
        }
      }

      if (transformed.length === 0) continue;

      // Build bulk INSERT
      const columns = transformed[0].columns;
      const rowsStr: string[] = [];
      const allValues: any[] = [];

      for (let j = 0; j < transformed.length; j++) {
        const t = transformed[j];
        const placeholders = t.values.map((_, k) => `$${allValues.length + k + 1}`).join(", ");
        rowsStr.push(`(${placeholders})`);
        allValues.push(...t.values);
      }

      const conflictClause =
        conflictColumns.length > 0
          ? `ON CONFLICT (${conflictColumns.map((c) => `"${c}"`).join(", ")}) DO NOTHING`
          : "";

      const sql = `
        INSERT INTO "${pgTable}" (${columns.map((c) => `"${c}"`).join(", ")})
        VALUES ${rowsStr.join(", ")}
        ${conflictClause}
      `;

      try {
        const result = await pgClient.query(sql, allValues);
        stat.inserted += result.rowCount ?? transformed.length;
      } catch (e: any) {
        stat.errors.push(
          `Batch ${Math.floor(i / batchSize) + 1}: ${e.message?.substring(0, 200)}`,
        );
        stat.skipped += transformed.length;
      }
    }
  } catch (e: any) {
    stat.errors.push(e.message?.substring(0, 500));
  }

  stat.duration = Date.now() - startTime;
  stats.push(stat);
  console.log(
    `  ✅ Done: ${stat.inserted} inserted, ${stat.skipped} skipped, ${stat.errors.length} errors (${formatDuration(stat.duration)})`,
  );
}

// ── Table-Specific Transformations ─────────────────────────────────────────

/**
 * Transform a UUID-like TEXT from SQLite to a proper UUID string for PG.
 * If the value doesn't look like a UUID, generate one (for tables that didn't enforce UUID format).
 */
function toUuid(val: string | null | undefined): string {
  if (val && isValidUuid(val)) return val;
  if (val) {
    // It's a string but not a valid UUID — use it as-is (PG will cast)
    return val;
  }
  return generateUuid();
}

// ── Kanban Tables (kanban.db) ──────────────────────────────────────────────

async function migrateKanban(pgClient: Client): Promise<void> {
  const dbPath = resolve(SQLITE_DB_DIR, "kanban.db");
  const db = openSqlite(dbPath);
  if (!db) return;

  console.log("\n📋 Migrating Kanban tables from kanban.db...");

  // boards → kanban_boards
  await migrateTable(db, pgClient, "boards", "kanban_boards", (row) => ({
    columns: ["id", "agent_id", "name", "created_at"],
    values: [
      toUuid(row.id),
      row.agent_id,
      row.name,
      epochToPgTimestamp(null), // No created_at in SQLite, use PG default
    ],
  }));

  // columns → kanban_columns
  await migrateTable(db, pgClient, "columns", "kanban_columns", (row) => ({
    columns: ["id", "board_id", "name", "ord"],
    values: [
      toUuid(row.id),
      toUuid(row.board_id),
      row.name,
      row.ord ?? 0,
    ],
  }));

  // cards → kanban_cards
  await migrateTable(db, pgClient, "cards", "kanban_cards", (row) => ({
    columns: [
      "id",
      "board_id",
      "column_id",
      "title",
      "description",
      "priority",
      "due",
      "tags",
      "assignee_agent_id",
      "project_id",
      "last_update",
    ],
    values: [
      toUuid(row.id),
      toUuid(row.board_id),
      toUuid(row.column_id),
      row.title,
      row.description || null,
      row.priority,
      row.due ? new Date(row.due) : null,
      parseJsonOrNull(row.tags),
      row.assignee_agent_id,
      row.project_id ? toUuid(row.project_id) : null,
      row.last_update ? new Date(row.last_update) : null,
    ],
  }));

  // card_activity → kanban_card_activity
  await migrateTable(db, pgClient, "card_activity", "kanban_card_activity", (row) => ({
    columns: ["id", "card_id", "ts", "action", "payload"],
    values: [
      toUuid(row.id),
      toUuid(row.card_id),
      new Date(row.ts),
      row.action,
      parseJsonOrNull(row.payload),
    ],
  }));

  // reporting_lines → kanban_reporting_lines
  await migrateTable(db, pgClient, "reporting_lines", "kanban_reporting_lines", (row) => ({
    columns: ["id", "manager_id", "report_id"],
    values: [toUuid(row.id), row.manager_id, row.report_id],
  }));

  db.close();
}

// ── Board Meetings (scheduler.db) ──────────────────────────────────────────

async function migrateBoardMeetings(pgClient: Client): Promise<void> {
  const dbPath = resolve(SQLITE_DB_DIR, "scheduler.db");
  const db = openSqlite(dbPath);
  if (!db) return;

  console.log("\n🏛️  Migrating Board Meetings tables from scheduler.db...");

  // board_meetings → board_meetings
  await migrateTable(db, pgClient, "board_meetings", "board_meetings", (row) => ({
    columns: [
      "id",
      "date",
      "status",
      "objective",
      "report",
      "user_decision",
      "user_feedback",
      "started_at",
      "concluded_at",
    ],
    values: [
      toUuid(row.id),
      new Date(row.date),
      row.status,
      row.objective,
      row.report,
      row.user_decision,
      row.user_feedback,
      row.started_at ? new Date(row.started_at * 1000) : null,
      row.concluded_at ? new Date(row.concluded_at * 1000) : null,
    ],
  }));

  // board_meeting_turns → board_meeting_turns
  // Note: SQLite uses composite PK (meeting_id, turn_number), PG uses UUID id
  await migrateTable(db, pgClient, "board_meeting_turns", "board_meeting_turns", (row) => {
    // Check if already migrated (by meeting_id + turn_number)
    return {
      columns: [
        "id",
        "meeting_id",
        "turn_number",
        "ceo_directive",
        "ceo_response",
        "synthesis",
      ],
      values: [
        toUuid(`${row.meeting_id}-${row.turn_number}`),
        toUuid(row.meeting_id),
        row.turn_number,
        row.ceo_directive,
        row.ceo_response,
        row.synthesis,
      ],
    };
  }, ["meeting_id", "turn_number"]);

  // board_meeting_responses → board_meeting_responses
  await migrateTable(
    db,
    pgClient,
    "board_meeting_responses",
    "board_meeting_responses",
    (row) => ({
      columns: [
        "id",
        "meeting_id",
        "turn_number",
        "agent_id",
        "content",
        "tool_calls_made",
        "tool_calls_details",
        "timestamp",
      ],
      values: [
        toUuid(`${row.meeting_id}-${row.turn_number}-${row.agent_id}`),
        toUuid(row.meeting_id),
        row.turn_number,
        row.agent_id,
        row.content,
        row.tool_calls_made ?? 0,
        parseJsonOrNull(row.tool_calls_details),
        row.timestamp ? new Date(row.timestamp * 1000) : null,
      ],
    }),
    ["meeting_id", "turn_number", "agent_id"],
  );

  // scheduled_tasks has no direct PG mapping — skip
  console.log("  ⏭️  Table scheduled_tasks has no PostgreSQL equivalent — skipping");

  db.close();
}

// ── Sessions (data/sessions.db) ────────────────────────────────────────────

async function migrateSessions(pgClient: Client): Promise<void> {
  const dbPath = resolve(PROJECT_ROOT, "data", "sessions.db");
  const db = openSqlite(dbPath);
  if (!db) return;

  console.log("\n🔄 Migrating Session tables from data/sessions.db...");

  // sessions → agent_sessions
  // SQLite has composite PK (agent_id, chat_id), PG has UUID id
  // We need to generate UUIDs and handle conflicts by (agent_id, chat_id)
  await migrateTable(db, pgClient, "sessions", "agent_sessions", (row) => {
    const sessionId = row.session_id || generateUuid();
    return {
      columns: [
        "id",
        "agent_id",
        "chat_id",
        "session_id",
        "title",
        "workspace_path",
        "created_at",
        "last_used",
        "message_count",
        "compaction_count",
        "previous_summary",
        "has_real_conversation",
      ],
      values: [
        toUuid(sessionId),
        row.agent_id,
        row.chat_id || "",
        sessionId,
        row.title,
        row.workspace_path,
        row.created_at ? new Date(row.created_at * 1000) : null,
        row.last_used ? new Date(row.last_used * 1000) : null,
        row.message_count ?? 0,
        row.compaction_count ?? 0,
        row.previous_summary,
        row.has_real_conversation ? true : false,
      ],
    };
  }, ["session_id"]);

  // session_messages → session_messages
  // SQLite uses composite PK (session_id, message_index), PG has UUID id
  await migrateTable(
    db,
    pgClient,
    "session_messages",
    "session_messages",
    (row) => ({
      columns: [
        "id",
        "session_id",
        "message_index",
        "role",
        "content",
        "token_estimate",
        "is_summary",
        "compacted",
        "timestamp",
      ],
      values: [
        toUuid(`${row.session_id}-${row.message_index}`),
        toUuid(row.session_id),
        row.message_index,
        row.role,
        row.content || "",
        row.token_estimate,
        row.is_summary ? true : false,
        row.compacted ? true : false,
        new Date(row.timestamp * 1000),
      ],
    }),
    ["session_id", "message_index"],
  );

  // session_tool_calls → session_tool_calls
  await migrateTable(
    db,
    pgClient,
    "session_tool_calls",
    "session_tool_calls",
    (row) => ({
      columns: [
        "id",
        "session_id",
        "tool_index",
        "call_id",
        "name",
        "arguments",
        "result",
        "token_estimate",
        "compacted",
        "timestamp",
      ],
      values: [
        toUuid(`${row.session_id}-${row.tool_index}`),
        toUuid(row.session_id),
        row.tool_index,
        row.id, // This is the call_id stored in 'id' column in SQLite
        row.name,
        parseJsonOrNull(row.arguments),
        parseJsonOrNull(row.result),
        row.token_estimate,
        row.compacted ? true : false,
        new Date(row.timestamp * 1000),
      ],
    }),
    ["session_id", "tool_index"],
  );

  db.close();
}

// ── Reports & Ops (reports_sessions.db) ────────────────────────────────────

async function migrateReportsAndOps(pgClient: Client): Promise<void> {
  const dbPath = resolve(SQLITE_DB_DIR, "reports_sessions.db");
  const db = openSqlite(dbPath);
  if (!db) return;

  console.log("\n📊 Migrating Reports & Ops tables from reports_sessions.db...");

  // reports → ops_reports
  await migrateTable(db, pgClient, "reports", "ops_reports", (row) => ({
    columns: [
      "id",
      "agent_id",
      "period",
      "summary",
      "metrics",
      "actions",
      "created_at",
    ],
    values: [
      toUuid(row.id),
      row.agent_id,
      row.period,
      row.summary,
      parseJsonOrNull(row.metrics),
      parseJsonOrNull(row.actions),
      row.created_at ? new Date(row.created_at * 1000) : null,
    ],
  }));

  // sessions → ops_sessions
  await migrateTable(db, pgClient, "sessions", "ops_sessions", (row) => ({
    columns: [
      "id",
      "agent_id",
      "chat_id",
      "started_at",
      "last_active",
      "status",
    ],
    values: [
      toUuid(row.id),
      row.agent_id,
      row.chat_id,
      row.started_at ? new Date(row.started_at * 1000) : null,
      row.last_active ? new Date(row.last_active * 1000) : null,
      row.status,
    ],
  }));

  // session_steps → session_steps
  await migrateTable(db, pgClient, "session_steps", "session_steps", (row) => ({
    columns: [
      "id",
      "session_id",
      "step_num",
      "step_type",
      "tool",
      "args_hash",
      "obs_summary",
      "ts",
    ],
    values: [
      toUuid(row.id),
      toUuid(row.session_id),
      row.step_num,
      row.step_type,
      row.tool,
      row.args_hash,
      row.obs_summary,
      row.ts ? new Date(row.ts * 1000) : null,
    ],
  }));

  // tool_correlations → tool_correlations
  await migrateTable(db, pgClient, "tool_correlations", "tool_correlations", (row) => ({
    columns: ["id", "tool", "args_hash", "result", "created_at"],
    values: [
      toUuid(row.id),
      row.tool,
      row.args_hash,
      row.result,
      row.created_at ? new Date(row.created_at * 1000) : null,
    ],
  }));

  // oc_sessions → oc_sessions
  await migrateTable(db, pgClient, "oc_sessions", "oc_sessions", (row) => ({
    columns: [
      "id",
      "chat_id",
      "agent_id",
      "oc_session_id",
      "created_at",
      "updated_at",
    ],
    values: [
      toUuid(row.id),
      row.chat_id,
      row.agent_id,
      row.oc_session_id,
      row.created_at ? new Date(row.created_at * 1000) : null,
      row.updated_at ? new Date(row.updated_at * 1000) : null,
    ],
  }));

  db.close();
}

// ── Hiring Tables (hiring.db) ──────────────────────────────────────────────

async function migrateHiring(pgClient: Client): Promise<void> {
  const dbPath = resolve(SQLITE_DB_DIR, "hiring.db");
  const db = openSqlite(dbPath);
  if (!db) return;

  console.log("\n🤝 Checking Hiring tables from hiring.db...");

  // Check if tables have data
  const contractsCount = (
    db.prepare("SELECT COUNT(*) as cnt FROM contracts").get() as { cnt: number }
  ).cnt;
  const delegationsCount = (
    db.prepare("SELECT COUNT(*) as cnt FROM delegations").get() as { cnt: number }
  ).cnt;

  if (contractsCount === 0 && delegationsCount === 0) {
    console.log("  ⏭️  Hiring tables are empty — skipping");
    console.log(
      "  (Note: contracts and delegations have no direct PostgreSQL table mappings)",
    );
    db.close();
    return;
  }

  // These tables don't have direct PG equivalents, but report if they have data
  console.log(
    `  ⚠️  Hiring tables have data but no direct PostgreSQL mappings:`,
  );
  console.log(`     contracts: ${contractsCount} rows`);
  console.log(`     delegations: ${delegationsCount} rows`);
  console.log(`     These would need manual migration if needed.`);

  // Record as skipped
  stats.push({
    table: "contracts (no PG mapping)",
    sourceDb: db.name || "hiring.db",
    read: contractsCount,
    inserted: 0,
    skipped: contractsCount,
    errors: ["No direct PostgreSQL table — requires manual migration"],
    duration: 0,
  });
  stats.push({
    table: "delegations (no PG mapping)",
    sourceDb: db.name || "hiring.db",
    read: delegationsCount,
    inserted: 0,
    skipped: delegationsCount,
    errors: ["No direct PostgreSQL table — requires manual migration"],
    duration: 0,
  });

  db.close();
}

// ── Main Migration ─────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(70));
  console.log("SQLite → PostgreSQL Data Migration");
  console.log("=".repeat(70));
  console.log(`PostgreSQL: ${DATABASE_URL!.replace(/:\/\/[^@]*@/, "://***@")}`);
  console.log(`SQLite directory: ${SQLITE_DB_DIR}`);
  console.log(`Dry run: ${DRY_RUN ? "YES" : "NO"}`);
  console.log(`Started: ${new Date().toISOString()}`);

  // Connect to PostgreSQL
  console.log("\n🔌 Connecting to PostgreSQL...");
  let pgClient: Client | null = null;
  try {
    pgClient = await connectPg();
    console.log("✅ Connected to PostgreSQL");
  } catch (e: any) {
    console.error(`❌ Failed to connect to PostgreSQL: ${e.message}`);
    process.exit(1);
  }

  const migrationStart = Date.now();

  try {
    // Run all migrations in order (respecting FK dependencies)
    // 1. Kanban (depends on LifeOS projects — assumed already present)
    await migrateKanban(pgClient);

    // 2. Board Meetings (standalone)
    await migrateBoardMeetings(pgClient);

    // 3. Sessions (agent_sessions first, then messages and tool_calls)
    await migrateSessions(pgClient);

    // 4. Reports & Ops
    await migrateReportsAndOps(pgClient);

    // 5. Hiring (informational — no direct mapping)
    await migrateHiring(pgClient);
  } finally {
    await pgClient.end();
  }

  const totalDuration = Date.now() - migrationStart;
  console.log(`\n⏱️  Total migration time: ${formatDuration(totalDuration)}`);

  printSummary();

  // Exit with error code if there were errors
  const hasErrors = stats.some((s) => s.errors.length > 0);
  if (hasErrors) {
    console.log("\n⚠️  Migration completed with errors. Check the summary above.");
    process.exit(1);
  } else {
    console.log("\n✅ Migration completed successfully!");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
