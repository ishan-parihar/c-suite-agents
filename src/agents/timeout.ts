/**
 * Centralized timeout resolution for all operant subsystems.
 * Mirrors openclaw's timeout.ts pattern: single source of truth for timeout values.
 *
 * Philosophy: Agents should NOT be artificially restricted.
 * - Default: 48 hours (matching openclaw)
 * - timeoutMs: 0 = unlimited (MAX_SAFE_TIMEOUT_MS, ~24.8 days)
 * - Negative timeout = use system default
 *
 * All timeout values across the codebase should flow through these functions.
 */

import type { OperantConfig } from "../config/schema";

// ── Constants ──────────────────────────────────────────────────────────

/** 48 hours in seconds — matches openclaw's DEFAULT_AGENT_TIMEOUT_SECONDS */
const DEFAULT_AGENT_TIMEOUT_SECONDS = 48 * 60 * 60;

/**
 * Maximum safe timer value (~24.85 days).
 * Node.js setTimeout uses a signed 32-bit millisecond value internally.
 * 2^31 - 1 = 2,147,483,647ms, but we use a slightly lower safe value.
 */
export const MAX_SAFE_TIMEOUT_MS = 2_147_000_000;

/** Default timeout for HTTP server-level settings (headers, request, idle). */
export const DEFAULT_HTTP_SERVER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Default timeout for tool execution calls. */
export const DEFAULT_TOOL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Default timeout for media operations (TTS, image gen, download). */
export const DEFAULT_MEDIA_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Default timeout for memory/embedding operations. */
export const DEFAULT_MEMORY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// ── Helpers ────────────────────────────────────────────────────────────

const normalizeNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;

// ── Core Resolver ──────────────────────────────────────────────────────

/**
 * Get the global default agent timeout in seconds.
 * Respects config.agents.defaults.timeoutSeconds if set.
 */
export function resolveAgentTimeoutSeconds(cfg?: OperantConfig): number {
  const raw = normalizeNumber((cfg?.agents as any)?.defaults?.timeoutSeconds);
  const seconds = raw ?? DEFAULT_AGENT_TIMEOUT_SECONDS;
  return Math.max(seconds, 1);
}

/**
 * Resolve a timeout in milliseconds with support for:
 * - `overrideMs: 0` → MAX_SAFE_TIMEOUT_MS (unlimited)
 * - `overrideMs < 0` → use default
 * - `overrideMs > 0` → clamped to MAX_SAFE_TIMEOUT_MS
 *
 * @param opts.cfg - Full operant config (for default resolution)
 * @param opts.overrideMs - Direct millisecond override (takes priority)
 * @param opts.defaultMs - Fallback default if no override and no config
 * @param opts.minMs - Minimum allowed timeout (default: 1ms)
 */
export function resolveTimeoutMs(opts: {
  cfg?: OperantConfig;
  overrideMs?: number | null;
  defaultMs?: number;
  minMs?: number;
}): number {
  const minMs = Math.max(normalizeNumber(opts.minMs) ?? 1, 1);
  const clampTimeoutMs = (valueMs: number) =>
    Math.min(Math.max(valueMs, minMs), MAX_SAFE_TIMEOUT_MS);

  const defaultMs = clampTimeoutMs(opts.defaultMs ?? resolveAgentTimeoutSeconds(opts.cfg) * 1000);

  // timeoutMs: 0 means unlimited
  const NO_TIMEOUT_MS = MAX_SAFE_TIMEOUT_MS;

  const overrideMs = normalizeNumber(opts.overrideMs);
  if (overrideMs !== undefined) {
    if (overrideMs === 0) return NO_TIMEOUT_MS;
    if (overrideMs < 0) return defaultMs;
    return clampTimeoutMs(overrideMs);
  }

  return defaultMs;
}

/**
 * Resolve a subsystem-specific timeout.
 * Use when a subsystem has its own config section with a timeout field.
 */
export function resolveSubsystemTimeoutMs(opts: {
  subsystemTimeoutMs?: number | null;
  defaultMs: number;
  minMs?: number;
}): number {
  const minMs = Math.max(normalizeNumber(opts.minMs) ?? 1, 1);
  const clampTimeoutMs = (valueMs: number) =>
    Math.min(Math.max(valueMs, minMs), MAX_SAFE_TIMEOUT_MS);

  const raw = normalizeNumber(opts.subsystemTimeoutMs);
  if (raw === undefined) return clampTimeoutMs(opts.defaultMs);
  if (raw === 0) return MAX_SAFE_TIMEOUT_MS;
  if (raw < 0) return clampTimeoutMs(opts.defaultMs);
  return clampTimeoutMs(raw);
}

// ── Pre-built Resolvers for Common Subsystems ──────────────────────────

/** LLM call timeout — defaults to 48h (agents shouldn't be rushed). */
export function resolveLLMTimeoutMs(cfg?: OperantConfig, overrideMs?: number | null): number {
  return resolveTimeoutMs({
    cfg,
    overrideMs: overrideMs ?? cfg?.llm?.timeoutMs,
    defaultMs: DEFAULT_AGENT_TIMEOUT_SECONDS * 1000,
  });
}

/** Tool execution timeout — 10min default. */
export function resolveToolTimeoutMs(overrideMs?: number | null): number {
  return resolveTimeoutMs({
    overrideMs,
    defaultMs: DEFAULT_TOOL_TIMEOUT_MS,
  });
}

/** Media operation timeout (TTS, image gen, download) — 5min default. */
export function resolveMediaTimeoutMs(overrideMs?: number | null): number {
  return resolveTimeoutMs({
    overrideMs,
    defaultMs: DEFAULT_MEDIA_TIMEOUT_MS,
  });
}

/** Memory/embedding operation timeout — 2min default. */
export function resolveMemoryTimeoutMs(overrideMs?: number | null): number {
  return resolveTimeoutMs({
    overrideMs,
    defaultMs: DEFAULT_MEMORY_TIMEOUT_MS,
  });
}

/** HTTP server timeout (headersTimeout, requestTimeout) — 5min default. */
export function resolveHTTPServerTimeoutMs(overrideMs?: number | null): number {
  return resolveTimeoutMs({
    overrideMs,
    defaultMs: DEFAULT_HTTP_SERVER_TIMEOUT_MS,
  });
}

/** HTTP server idle timeout — 30min default (for long-running webhook delivery). */
export function resolveHTTPIdleTimeoutMs(overrideMs?: number | null): number {
  return resolveTimeoutMs({
    overrideMs,
    defaultMs: 30 * 60 * 1000, // 30 minutes
  });
}

/** Check if a timeout value represents "unlimited". */
export function isUnlimitedTimeout(timeoutMs: number): boolean {
  return timeoutMs >= MAX_SAFE_TIMEOUT_MS;
}
