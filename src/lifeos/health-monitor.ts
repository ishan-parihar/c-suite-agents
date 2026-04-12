import { logger } from '../logger';
import type { Pool } from 'pg';

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
  active: number;
  max: number;
  utilization_pct: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency_ms: number;
  pool: PoolStats;
  last_check: string;
  consecutive_failures: number;
}

export class DbHealthMonitor {
  private pool: Pool;
  private interval: ReturnType<typeof setInterval> | null = null;
  private _status: HealthStatus = { status: 'healthy', latency_ms: 0, pool: { total: 0, idle: 0, waiting: 0, active: 0, max: 0, utilization_pct: 0 }, last_check: new Date().toISOString(), consecutive_failures: 0 };
  private readonly checkIntervalMs: number;
  private readonly failureThreshold: number;

  constructor(pool: Pool, options?: { checkIntervalMs?: number; failureThreshold?: number }) {
    this.pool = pool;
    this.checkIntervalMs = options?.checkIntervalMs ?? 30000;
    this.failureThreshold = options?.failureThreshold ?? 3;
  }

  start(): void {
    if (this.interval) return;
    this.check();
    this.interval = setInterval(() => this.check(), this.checkIntervalMs);
    logger.info(`DB health monitor started (interval=${this.checkIntervalMs}ms, threshold=${this.failureThreshold})`);
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  private async check(): Promise<void> {
    const start = process.hrtime.bigint();
    try {
      await this.pool.query('SELECT 1');
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      const p = this.pool;
      const total = (p as any).totalCount ?? 0;
      const idle = (p as any).idleCount ?? 0;
      const waiting = (p as any).waitingCount ?? 0;
      const max = (p as any).max ?? 10;
      this._status = {
        status: 'healthy',
        latency_ms: Math.round(elapsed),
        pool: {
          total,
          idle,
          waiting,
          active: total - idle,
          max,
          utilization_pct: max ? Math.round((total / max) * 100) : 0,
        },
        last_check: new Date().toISOString(),
        consecutive_failures: 0,
      };
    } catch (err: any) {
      this._status.consecutive_failures++;
      this._status.status = this._status.consecutive_failures >= this.failureThreshold ? 'unhealthy' : 'degraded';
      this._status.last_check = new Date().toISOString();
      logger.warn({ err: err.message, failures: this._status.consecutive_failures }, 'DB health check failed');
    }
  }

  getStatus(): HealthStatus { return { ...this._status }; }
  isHealthy(): boolean { return this._status.status === 'healthy'; }
}
