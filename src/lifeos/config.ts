import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export type AgentDomain = "productivity" | "journaling" | "strategic";

export interface TableConfig {
  name: string;
  agent: AgentDomain;
}

// ─── Legacy types (deprecated — keep for tool compatibility during migration) ───

export interface DbConfig {
  name: string;
  data_source_id: string;
  agent: AgentDomain;
  properties: Record<string, string>;
}

export interface LifeOSConfig extends OperantConfig {
  apiVersion: string;
  rateLimit: {
    requestsPerSecond: number;
    cacheTtlSeconds: number;
  };
  databases: Record<string, DbConfig>;
}

export interface OperantConfig {
  database: {
    url: string;
    poolSize: number;
    connectionTimeout: number;
  };
  tables: Record<string, TableConfig>;
}

/**
 * Load config from operant-mcp's operant.config.json.
 * Searches relative to this file's location, walking up to find operant-mcp.
 */
export function loadConfig(): OperantConfig {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // From operant/src/lifeos/config.ts, walk up to find operant-mcp/operant.config.json
  const projectRoot = resolve(__dirname, "..", "..", "..", "..", "operant-mcp");
  const configPath = resolve(projectRoot, "operant.config.json");
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as OperantConfig;
}

/**
 * Load config from an explicit path — useful when the config lives elsewhere.
 */
export function loadConfigFromPath(configPath: string): OperantConfig {
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as OperantConfig;
}

export function getTableConfig(config: LifeOSConfig, key: string): TableConfig {
  const table = (config as OperantConfig).tables?.[key];
  if (!table) {
    const tables = (config as OperantConfig).tables || {};
    throw new Error(`Unknown table: ${key}. Available: ${Object.keys(tables).join(", ")}`);
  }
  return table;
}

export function getTablesByAgent(config: LifeOSConfig, agent: AgentDomain): Record<string, TableConfig> {
  const result: Record<string, TableConfig> = {};
  const tables = (config as OperantConfig).tables || {};
  for (const [key, table] of Object.entries(tables) as [string, TableConfig][]) {
    if (table.agent === agent) {
      result[key] = table;
    }
  }
  return result;
}

// ─── Backward-compatibility aliases ───

export function getDbConfig(config: LifeOSConfig, key: string): DbConfig {
  return getTableConfig(config, key) as unknown as DbConfig;
}

export function getDbsByAgent(config: LifeOSConfig, agent: AgentDomain): Record<string, DbConfig> {
  return getTablesByAgent(config, agent) as unknown as Record<string, DbConfig>;
}
