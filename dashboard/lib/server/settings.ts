import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type TableInfo = {
  tableName: string;
  rowCount: number;
  lastUpdated: string | null;
};

export type DatabaseStatus = {
  connectionStatus: "healthy" | "unhealthy";
  tables: TableInfo[];
  lastMigration: string | null;
};

export type AgentBoard = {
  agentId: string;
  boardName: string;
  cardCount: number;
};

export type AgentConfig = {
  agents: AgentBoard[];
};

export type SystemInfo = {
  postgresVersion: string;
  dashboardVersion: string;
  uptime: string | null;
};

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  try {
    const tables: TableInfo[] = [];

    const result = await db.execute(sql`
      SELECT
        schemaname || '.' || relname AS table_name,
        n_live_tup AS row_count,
        last_autovacuum AS last_updated
      FROM pg_stat_user_tables
      ORDER BY schemaname, relname
    `);

    for (const r of result.rows as any[]) {
      tables.push({
        tableName: r.table_name,
        rowCount: parseInt(r.row_count) || 0,
        lastUpdated: r.last_updated ? new Date(r.last_updated).toISOString().split("T")[0] : null,
      });
    }

    // Get last migration timestamp from pg_catalog
    let lastMigration: string | null = null;
    try {
      const migResult = await db.execute(sql`
        SELECT MAX(obj_description(oid)) AS last_migration
        FROM pg_class
        WHERE relkind = 'r'
          AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      `);
      lastMigration = (migResult.rows as any[])[0]?.last_migration ?? null;
    } catch {
      // not critical
    }

    return {
      connectionStatus: "healthy",
      tables,
      lastMigration,
    };
  } catch {
    return {
      connectionStatus: "unhealthy",
      tables: [],
      lastMigration: null,
    };
  }
}

export async function getAgentConfig(): Promise<AgentConfig> {
  try {
    const result = await db.execute(sql`
      SELECT
        kb.agent_id,
        kb.name AS board_name,
        COUNT(kc.id) AS card_count
      FROM kanban_boards kb
      LEFT JOIN kanban_cards kc ON kc.board_id = kb.id
      GROUP BY kb.id, kb.agent_id, kb.name
      ORDER BY kb.agent_id ASC
    `);

    const agents: AgentBoard[] = (result.rows as any[]).map((r) => ({
      agentId: r.agent_id,
      boardName: r.board_name,
      cardCount: parseInt(r.card_count) || 0,
    }));

    return { agents };
  } catch {
    return { agents: [] };
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  try {
    const versionResult = await db.execute(sql`SELECT version() AS version`);
    const versionStr = (versionResult.rows as any[])[0]?.version ?? "Unknown";
    const pgMatch = versionStr.match(/PostgreSQL\s+([\d.]+)/);

    return {
      postgresVersion: pgMatch ? `PostgreSQL ${pgMatch[1]}` : versionStr.substring(0, 60),
      dashboardVersion: "0.5.0",
      uptime: null,
    };
  } catch {
    return {
      postgresVersion: "Unknown",
      dashboardVersion: "0.5.0",
      uptime: null,
    };
  }
}
