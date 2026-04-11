import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OperantConfigSchema } from "../config/schema";
import { getConfigPath } from "../config/loader";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigSnapshot {
  exists: boolean;
  valid: boolean;
  config: Record<string, unknown> | null;
  error?: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a sensitive value — shows first N chars, replaces rest with `***`.
 */
export function maskValue(value: string, visibleChars = 6): string {
  if (value.length <= visibleChars) return "***";
  return value.slice(0, visibleChars) + "***";
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

// ---------------------------------------------------------------------------
// readConfigSnapshot
// ---------------------------------------------------------------------------

export function readConfigSnapshot(configPath?: string): ConfigSnapshot {
  const resolvedPath = configPath ?? getConfigPath();

  if (!fs.existsSync(resolvedPath)) {
    return { exists: false, valid: false, config: null, path: resolvedPath };
  }

  let raw: string;
  try {
    const stat = fs.statSync(resolvedPath);
    if (stat.size > 100 * 1024) {
      return {
        exists: true,
        valid: false,
        config: null,
        error: `Config file too large (${stat.size} bytes), refusing to read`,
        path: resolvedPath,
      };
    }
    raw = fs.readFileSync(resolvedPath, "utf-8");
  } catch (err: unknown) {
    return {
      exists: true,
      valid: false,
      config: null,
      error: (err as Error).message,
      path: resolvedPath,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err: unknown) {
    return {
      exists: true,
      valid: false,
      config: null,
      error: `Invalid JSON: ${(err as Error).message}`,
      path: resolvedPath,
    };
  }

  const result = OperantConfigSchema.safeParse(parsed);
  if (result.success) {
    return { exists: true, valid: true, config: result.data as Record<string, unknown>, path: resolvedPath };
  }

  const zodErrors = result.error.errors
    .map((e) => `${e.path.join(".")}: ${e.message}`)
    .join("\n");

  return {
    exists: true,
    valid: false,
    config: parsed,
    error: zodErrors,
    path: resolvedPath,
  };
}

// ---------------------------------------------------------------------------
// summarizeConfig
// ---------------------------------------------------------------------------

export function summarizeConfig(config: Record<string, unknown>): string {
  const lines: string[] = [];

  // ── LLM ──────────────────────────────────────────────────────────────
  const llm = config.llm as Record<string, unknown> | undefined;
  if (llm) {
    const provider = (llm.provider as string) ?? "not configured";
    const model = (llm.model as string) ?? "default";
    const contextTokens = llm.contextTokens as number | undefined;
    const maxTokens = (llm.maxTokens as number) ?? 0;
    const temperature = llm.temperature as number | undefined;
    const retry = llm.retry as Record<string, unknown> | undefined;

    lines.push(`  LLM Provider:    ${provider}/${model}`);

    if (contextTokens) {
      lines.push(`  Context:         ${formatNumber(contextTokens)} tokens`);
    }

    if (maxTokens) {
      lines.push(`  Max Output:      ${formatNumber(maxTokens)} tokens`);
    }

    if (temperature !== undefined) {
      lines.push(`  Temperature:     ${temperature}`);
    }

    if (retry) {
      const attempts = retry.attempts as number | undefined;
      const minDelay = retry.minDelayMs as number | undefined;
      const maxDelay = retry.maxDelayMs as number | undefined;
      const parts: string[] = [];
      if (attempts !== undefined) parts.push(`${attempts} attempts`);
      if (minDelay !== undefined && maxDelay !== undefined) {
        parts.push(`${formatNumber(minDelay)}-${formatNumber(maxDelay)}ms`);
      } else if (minDelay !== undefined) {
        parts.push(`${formatNumber(minDelay)}ms`);
      }
      if (parts.length > 0) {
        lines.push(`  Retry:           ${parts.join(", ")}`);
      }
    }
  } else {
    lines.push("  LLM:             not configured");
  }

  // ── Telegram ─────────────────────────────────────────────────────────
  const telegram = config.telegram as Record<string, unknown> | undefined;
  if (telegram?.botToken || telegram?.chatId) {
    const token = telegram.botToken as string | undefined;
    const chatId = telegram.chatId as string | undefined;
    const masked = token ? maskValue(token) : (chatId ? maskValue(chatId) : "");
    lines.push(`  Telegram:        configured (${masked})`);
  } else {
    lines.push("  Telegram:        not configured");
  }

  // ── Agent Offices (paths) ────────────────────────────────────────────
  const pathsSection = config.paths as Record<string, unknown> | undefined;
  if (pathsSection?.agentOffices) {
    lines.push(`  Agent Offices:   ${pathsSection.agentOffices as string}`);
  } else {
    lines.push("  Agent Offices:   not configured");
  }

  // ── MCP Servers ──────────────────────────────────────────────────────
  const mcp = config.mcp as Record<string, unknown> | undefined;
  if (mcp && Object.keys(mcp).length > 0) {
    const names = Object.keys(mcp).join(", ");
    lines.push(`  MCP Servers:     ${names}`);
  } else {
    lines.push("  MCP Servers:     none configured");
  }

  // ── Embedding (from providers if ollama exists) ──────────────────────
  const providers = config.providers as Record<string, unknown> | undefined;
  if (providers?.ollama) {
    const ollama = providers.ollama as Record<string, unknown>;
    const models = ollama.models as Array<{ id?: string }> | undefined;
    const embedModel = models?.find((m) => m.id?.includes("embed"));
    if (embedModel?.id) {
      lines.push(`  Embedding:       ollama/${embedModel.id}`);
    }
  }
  // Also check if there's an explicit embedding config
  const embedding = config.embedding as Record<string, unknown> | undefined;
  if (embedding) {
    const provider = embedding.provider as string | undefined;
    const model = embedding.model as string | undefined;
    const dims = embedding.dimensions as number | undefined;
    const parts: string[] = [];
    if (provider) parts.push(provider);
    if (model) parts.push(model);
    if (dims) parts.push(`${dims}d`);
    lines.push(`  Embedding:       ${parts.join("/") || "configured"}`);
  }

  // ── Logging ──────────────────────────────────────────────────────────
  const logging = config.logging as Record<string, unknown> | undefined;
  if (logging) {
    const level = (logging.level as string) ?? "info";
    const file = (logging.file as string) ?? "~/.local/log/operant/operant.log";
    lines.push(`  Logging:         ${level} → ${resolvePath(file)}`);
  } else {
    lines.push("  Logging:         not configured");
  }

  // ── Context Management ───────────────────────────────────────────────
  const context = config.context as Record<string, unknown> | undefined;
  if (context) {
    const compaction = context.compaction as Record<string, unknown> | undefined;
    const pruning = context.pruning as Record<string, unknown> | undefined;
    const maxMessages = context.maxMessages as number | undefined;
    const parts: string[] = [];
    if (compaction) {
      parts.push(`compaction=${compaction.auto !== false ? "on" : "off"}`);
    }
    if (pruning || compaction?.prune !== undefined) {
      parts.push(`pruning=${compaction?.prune !== false ? "on" : "off"}`);
    }
    if (maxMessages !== undefined) {
      parts.push(`maxMessages=${maxMessages}`);
    }
    lines.push(`  Context Mgmt:    ${parts.length > 0 ? parts.join(", ") : "configured"}`);
  } else {
    lines.push("  Context Mgmt:    not configured");
  }

  // ── Agent Defaults ───────────────────────────────────────────────────
  const agents = config.agents as Record<string, unknown> | undefined;
  if (agents) {
    const autonomy = agents.defaultAutonomy as number | undefined;
    const maxConcurrent = agents.maxConcurrent as number | undefined;
    const maxToolRounds = agents.maxToolRounds as number | undefined;
    const parts: string[] = [];
    if (autonomy !== undefined) parts.push(`autonomy=${autonomy}`);
    if (maxConcurrent !== undefined) parts.push(`maxConcurrent=${maxConcurrent}`);
    if (maxToolRounds !== undefined) parts.push(`maxToolRounds=${maxToolRounds}`);
    lines.push(`  Agent Defaults:  ${parts.length > 0 ? parts.join(", ") : "configured"}`);
  } else {
    lines.push("  Agent Defaults:  not configured");
  }

  return lines.join("\n");
}
