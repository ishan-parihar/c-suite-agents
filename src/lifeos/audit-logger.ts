import { logger } from '../logger';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

export interface AuditLogEntry {
  timestamp: string;
  agent_id: string | null;
  operation: 'query' | 'insert' | 'update' | 'delete';
  table: string;
  filters?: Record<string, unknown>;
  row_count?: number;
  duration_ms: number;
  success: boolean;
  error?: string;
  caller_agent_id?: string;
}

export class DbAuditLogger {
  private logs: AuditLogEntry[] = [];
  private readonly maxLogs: number;
  private readonly logFilePath: string;

  constructor(options?: { maxLogs?: number; logDir?: string }) {
    this.maxLogs = options?.maxLogs ?? 10000;
    const logDir = options?.logDir ?? resolve(process.cwd(), '.operant-logs');
    this.logFilePath = resolve(logDir, 'db-audit.jsonl');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  }

  log(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    const fullEntry: AuditLogEntry = { ...entry, timestamp: new Date().toISOString() };
    this.logs.push(fullEntry);
    if (this.logs.length > this.maxLogs) this.logs = this.logs.slice(-this.maxLogs);
    try { appendFileSync(this.logFilePath, JSON.stringify(fullEntry) + '\n'); } catch (e) { logger.warn({ err: e }, 'Failed to persist audit log'); }
    if (!fullEntry.success) logger.warn({ ...fullEntry }, `DB ${fullEntry.operation} failed on ${fullEntry.table}`);
  }

  getLogs(filters?: { agent_id?: string; table?: string; operation?: string; since?: string }): AuditLogEntry[] {
    let result = [...this.logs];
    if (filters?.agent_id) result = result.filter(l => l.agent_id === filters.agent_id);
    if (filters?.table) result = result.filter(l => l.table === filters.table);
    if (filters?.operation) result = result.filter(l => l.operation === filters.operation);
    if (filters?.since) { const since = new Date(filters.since).getTime(); result = result.filter(l => new Date(l.timestamp).getTime() >= since); }
    return result;
  }

  getLogsByAgent(agent_id: string, limit = 100): AuditLogEntry[] { return this.getLogs({ agent_id }).slice(-limit); }
  getLogsByTable(table: string, limit = 100): AuditLogEntry[] { return this.getLogs({ table }).slice(-limit); }
  getRecentErrors(limit = 20): AuditLogEntry[] { return this.logs.filter(l => !l.success).slice(-limit); }

  getStats() {
    const byOperation: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    const byTable: Record<string, number> = {};
    let errors = 0;
    for (const l of this.logs) {
      byOperation[l.operation] = (byOperation[l.operation] || 0) + 1;
      if (l.agent_id) byAgent[l.agent_id] = (byAgent[l.agent_id] || 0) + 1;
      byTable[l.table] = (byTable[l.table] || 0) + 1;
      if (!l.success) errors++;
    }
    return { total: this.logs.length, byOperation, byAgent, byTable, errors };
  }

  prune(maxAgeHours = 24): number {
    const cutoff = Date.now() - maxAgeHours * 3600000;
    const before = this.logs.length;
    this.logs = this.logs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    return before - this.logs.length;
  }

  clear(): void { this.logs = []; }
}

export const dbAuditLogger = new DbAuditLogger();
