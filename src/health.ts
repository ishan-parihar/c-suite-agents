/**
 * Health check system — inspired by OpenClaw's channel-health-monitor and health-state patterns.
 *
 * Design principles:
 * - Health is continuously evaluated, not a one-time latch
 * - Each component reports its own snapshot with timestamps
 * - Evaluation is a pure function: snapshot + policy → { healthy, reason }
 * - Health responses are cached + deduplicated (Promise coalescing)
 */

export type ComponentStatus =
  | "ok"
  | "starting"
  | "degraded"
  | "stale"
  | "stopped"
  | "error";

export type ComponentHealth = {
  component: string;
  status: ComponentStatus;
  reason?: string;
  checkedAt: number;
  lastOkAt?: number;
  consecutiveFailures: number;
  metadata?: Record<string, unknown>;
};

export type HealthSummary = {
  status: "ok" | "degraded" | "critical" | "starting";
  uptimeMs: number;
  version: number;
  ts: number;
  components: ComponentHealth[];
  componentsByName: Record<string, ComponentHealth>;
};

import { ErrorBus } from "./runtime/error-emitter.js";

type ComponentRegistry = Map<string, ComponentHealth>;

// ── Global state ──
const startTime = Date.now();
let healthVersion = 0;
const components: ComponentRegistry = new Map();
let healthRefreshPromise: Promise<HealthSummary> | null = null;

// ── Registration ──
export function registerComponent(name: string): ComponentHealth {
  const entry: ComponentHealth = {
    component: name,
    status: "starting",
    checkedAt: Date.now(),
    consecutiveFailures: 0,
  };
  components.set(name, entry);
  return entry;
}

export function getComponent(name: string): ComponentHealth | undefined {
  return components.get(name);
}

// ── Status updates ──
export function markHealthy(name: string, metadata?: Record<string, unknown>) {
  const c = components.get(name);
  if (!c) return;
  c.status = "ok";
  c.reason = undefined;
  c.checkedAt = Date.now();
  c.lastOkAt = Date.now();
  c.consecutiveFailures = 0;
  if (metadata) c.metadata = metadata;
}

export function markDegraded(name: string, reason: string) {
  const c = components.get(name);
  if (!c) return;
  c.status = "degraded";
  c.reason = reason;
  c.checkedAt = Date.now();
  c.consecutiveFailures++;
  ErrorBus.emit({
    type: "health:changed",
    severity: "warn",
    component: name,
    error: null,
    message: `Health status changed: ${name} → degraded`,
    context: { reason, status: "degraded" },
  });
}

export function markError(name: string, reason: string) {
  const c = components.get(name);
  if (!c) return;
  c.status = "error";
  c.reason = reason;
  c.checkedAt = Date.now();
  c.consecutiveFailures++;
  ErrorBus.emit({
    type: "health:changed",
    severity: "error",
    component: name,
    error: null,
    message: `Health status changed: ${name} → error`,
    context: { reason, status: "error" },
  });
}

export function markStale(name: string, reason: string) {
  const c = components.get(name);
  if (!c) return;
  c.status = "stale";
  c.reason = reason;
  c.checkedAt = Date.now();
  c.consecutiveFailures++;
  ErrorBus.emit({
    type: "health:changed",
    severity: "warn",
    component: name,
    error: null,
    message: `Health status changed: ${name} → stale`,
    context: { reason, status: "stale" },
  });
}

export function markStopped(name: string) {
  const c = components.get(name);
  if (!c) return;
  c.status = "stopped";
  c.reason = undefined;
  c.checkedAt = Date.now();
  ErrorBus.emit({
    type: "health:changed",
    severity: "warn",
    component: name,
    error: null,
    message: `Health status changed: ${name} → stopped`,
    context: { reason: undefined, status: "stopped" },
  });
}

// ── Evaluation ──
function evaluateOverallStatus(): HealthSummary["status"] {
  const all = Array.from(components.values());
  if (all.length === 0) return "starting";

  const hasError = all.some(c => c.status === "error");
  const hasStopped = all.some(c => c.status === "stopped");
  const hasDegraded = all.some(c => c.status === "degraded" || c.status === "stale");
  const allStarting = all.every(c => c.status === "starting");

  if (hasError || hasStopped) return "critical";
  if (hasDegraded) return "degraded";
  if (allStarting) return "starting";
  return "ok";
}

// ── Snapshot (with Promise deduplication, inspired by OpenClaw health-state.ts) ──
export async function getHealthSnapshot(): Promise<HealthSummary> {
  if (!healthRefreshPromise) {
    healthRefreshPromise = (async () => {
      const comps = Array.from(components.values());
      healthVersion++;
      return {
        status: evaluateOverallStatus(),
        uptimeMs: Date.now() - startTime,
        version: healthVersion,
        ts: Date.now(),
        components: comps,
        componentsByName: Object.fromEntries(comps.map(c => [c.component, c])),
      };
    })().finally(() => {
      healthRefreshPromise = null;
    });
  }
  return healthRefreshPromise;
}

// ── HTTP-friendly JSON response ──
export async function healthResponse(): Promise<Record<string, unknown>> {
  const snap = await getHealthSnapshot();
  return {
    status: snap.status,
    uptimeMs: snap.uptimeMs,
    version: snap.version,
    components: snap.components.map(c => ({
      component: c.component,
      status: c.status,
      reason: c.reason,
      checkedAt: c.checkedAt,
      lastOkAt: c.lastOkAt,
      consecutiveFailures: c.consecutiveFailures,
      metadata: c.metadata,
    })),
  };
}

// ── Component listing ──
export function listComponents(): string[] {
  return Array.from(components.keys());
}
