import { Pool, PoolClient } from 'pg';
import { DbAuditLogger } from '../audit-logger.js';

export interface QueryResult<T = unknown> {
  success: boolean;
  data?: T[];
  count?: number;
  table: string;
  error?: string;
}

export interface InsertResult<T = unknown> {
  success: boolean;
  data?: T[];
  count?: number;
  table: string;
  error?: string;
}

export interface UpdateResult<T = unknown> {
  success: boolean;
  data?: T[];
  count?: number;
  table: string;
  error?: string;
}

export interface SchemaInfo {
  tables: Record<string, string[]>;
}

type FilterValue = string | number | boolean | null | (string | number)[] | { $like?: string; $gt?: unknown; $gte?: unknown; $lt?: unknown; $lte?: unknown; $in?: unknown[]; $isNull?: boolean; $ne?: unknown };
type Filters = Record<string, FilterValue>;
interface QueryOptions { limit?: number; offset?: number; orderBy?: string; orderDir?: 'asc' | 'desc'; }

function buildWhereClause(filters: Filters): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ('$like' in obj) { parts.push(`${key} LIKE $${idx++}`); params.push(`%${obj.$like}%`); }
      else if ('$gt' in obj) { parts.push(`${key} > $${idx++}`); params.push(obj.$gt); }
      else if ('$gte' in obj) { parts.push(`${key} >= $${idx++}`); params.push(obj.$gte); }
      else if ('$lt' in obj) { parts.push(`${key} < $${idx++}`); params.push(obj.$lt); }
      else if ('$lte' in obj) { parts.push(`${key} <= $${idx++}`); params.push(obj.$lte); }
      else if ('$in' in obj && Array.isArray(obj.$in)) { parts.push(`${key} = ANY($${idx++})`); params.push(obj.$in); }
      else if ('$isNull' in obj) { parts.push(obj.$isNull ? `${key} IS NULL` : `${key} IS NOT NULL`); }
      else if ('$ne' in obj) { parts.push(`${key} != $${idx++}`); params.push(obj.$ne); }
      else { parts.push(`${key} = $${idx++}`); params.push(value); }
    } else if (Array.isArray(value)) { parts.push(`${key} = ANY($${idx++})`); params.push(value); }
    else { parts.push(`${key} = $${idx++}`); params.push(value); }
  }
  return { sql: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '', params };
}

function safeTableName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Invalid table name: ${name}`);
  return name;
}

export class PostgresClient {
  private pool: Pool;
  private auditLogger?: DbAuditLogger;
  private callerAgentId?: string;

  constructor(connectionString: string, poolSize: number = 10, auditLogger?: DbAuditLogger, callerAgentId?: string) {
    this.pool = new Pool({ connectionString, max: poolSize });
    this.auditLogger = auditLogger;
    this.callerAgentId = callerAgentId;
  }

  getPool(): Pool { return this.pool; }

  private async runQuery(sql: string, params: unknown[], table: string, operation: string): Promise<{ rows: unknown[] }> {
    const start = process.hrtime.bigint();
    try {
      const result = await this.pool.query(sql, params);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      this.auditLogger?.log({ agent_id: this.callerAgentId ?? null, operation: operation as any, table, row_count: result.rowCount ?? 0, duration_ms: Math.round(elapsed), success: true });
      return result;
    } catch (err: any) {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      this.auditLogger?.log({ agent_id: this.callerAgentId ?? null, operation: operation as any, table, filters: { sql }, duration_ms: Math.round(elapsed), success: false, error: err.message });
      throw err;
    }
  }

  async query(tableName: string, filters: Filters = {}, options: QueryOptions = {}): Promise<QueryResult> {
    try {
      const t = safeTableName(tableName);
      const { sql: where, params } = buildWhereClause(filters);
      let sql = `SELECT * FROM ${t} ${where}`;
      const queryParams = [...params];
      if (options.orderBy) {
        const col = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.orderBy) ? options.orderBy : 'id';
        const dir = options.orderDir === 'desc' ? 'DESC' : 'ASC';
        sql += ` ORDER BY ${col} ${dir}`;
      }
      if (options.limit) { sql += ` LIMIT $${queryParams.length + 1}`; queryParams.push(options.limit); }
      if (options.offset) { sql += ` OFFSET $${queryParams.length + 1}`; queryParams.push(options.offset); }
      const result = await this.runQuery(sql, queryParams, t, 'query');
      return { success: true, data: result.rows, count: result.rows.length, table: t };
    } catch (err: any) { return { success: false, error: err.message, table: tableName }; }
  }

  async insert(tableName: string, data: Record<string, unknown> | Record<string, unknown>[]): Promise<InsertResult> {
    try {
      const t = safeTableName(tableName);
      const items = Array.isArray(data) ? data : [data];
      const results: unknown[] = [];
      for (const item of items) {
        const keys = Object.keys(item);
        const values = Object.values(item);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO ${t} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
        const result = await this.runQuery(sql, values, t, 'insert');
        results.push(...result.rows);
      }
      return { success: true, data: results, count: results.length, table: t };
    } catch (err: any) { return { success: false, error: err.message, table: tableName }; }
  }

  async update(tableName: string, filters: Filters, data: Record<string, unknown>): Promise<UpdateResult> {
    try {
      const t = safeTableName(tableName);
      const filterKeys = Object.keys(filters);
      if (filterKeys.length === 0) throw new Error('Update requires at least one filter');
      const setKeys = Object.keys(data);
      const setParts = setKeys.map((k, i) => `${k} = $${i + 1}`);
      const { sql: where, params: filterParams } = buildWhereClause(filters);
      const setValues = Object.values(data);
      const adjustedWhere = where.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + setValues.length}`);
      const sql = `UPDATE ${t} SET ${setParts.join(', ')} ${adjustedWhere} RETURNING *`;
      const result = await this.runQuery(sql, [...setValues, ...filterParams], t, 'update');
      return { success: true, data: result.rows, count: result.rows.length, table: t };
    } catch (err: any) { return { success: false, error: err.message, table: tableName }; }
  }

  async delete(tableName: string, filters: Filters): Promise<{ success: boolean; count?: number; table: string; error?: string }> {
    try {
      const t = safeTableName(tableName);
      const filterKeys = Object.keys(filters);
      if (filterKeys.length === 0) throw new Error('Delete requires at least one filter');
      const { sql: where, params } = buildWhereClause(filters);
      const sql = `DELETE FROM ${t} ${where} RETURNING *`;
      const result = await this.runQuery(sql, params, t, 'delete');
      return { success: true, count: result.rows.length, table: t };
    } catch (err: any) { return { success: false, error: err.message, table: tableName }; }
  }

  async getSchemaInfo(): Promise<SchemaInfo> {
    const result = await this.pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name NOT IN ('__drizzle_migrations', 'agent_domain_mapping')
      ORDER BY table_name, ordinal_position
    `);
    const tables: Record<string, string[]> = {};
    for (const row of result.rows) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push(row.column_name);
    }
    return { tables };
  }

  async listTables(): Promise<string[]> {
    const result = await this.pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    return result.rows.map((r: any) => r.table_name);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
