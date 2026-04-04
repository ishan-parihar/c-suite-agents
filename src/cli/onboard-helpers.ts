import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 1. LLM Reachability Probe
// ---------------------------------------------------------------------------

/**
 * Tests if the LLM provider endpoint is reachable.
 * Returns true for HTTP 200/404/405 (server alive), false on connection error.
 */
export async function probeLLMReachable(
  baseUrl: string,
  timeoutMs?: number,
): Promise<boolean> {
  try {
    const response = await fetch(baseUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs ?? 5_000),
    });
    if (response.ok || response.status === 404 || response.status === 405) {
      console.log(`✓ LLM endpoint reachable (${baseUrl})`);
      return true;
    }
    console.log(`✗ LLM endpoint unreachable`);
    return false;
  } catch {
    console.log(`✗ LLM endpoint unreachable`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Workspace Directory Creation
// ---------------------------------------------------------------------------

/**
 * Creates all necessary data directories.
 * Extracts parent directory for file-like paths, creates with mkdirSync recursive.
 * Only logs if directory was newly created.
 */
export function ensureWorkspaceDirs(configPaths: {
  lancedb?: string;
  kanbanDb?: string;
  messagesDb?: string;
  agentOffices?: string;
}): void {
  for (const [_key, path] of Object.entries(configPaths)) {
    if (!path) continue;

    // If path looks like a file (has an extension after the last slash), use dirname
    const dir = path.includes(".") && !path.endsWith("/") ? dirname(path) : path;

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`  Created directory: ${dir}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Wizard Metadata
// ---------------------------------------------------------------------------

/**
 * Adds wizard metadata to the config object.
 * Returns the mutated config.
 */
export function applyWizardMetadata(
  rawConfig: Record<string, unknown>,
): Record<string, unknown> {
  rawConfig.wizard = {
    lastRunAt: new Date().toISOString(),
    lastRunVersion: readPackageVersion(),
    lastRunCommand: "onboard",
    lastRunMode: "quickstart",
  };
  return rawConfig;
}

// ---------------------------------------------------------------------------
// 4. Package Version Reader
// ---------------------------------------------------------------------------

/**
 * Reads version from package.json.
 * Tries import.meta.dirname relative path first, falls back to process.cwd().
 * Returns version string or "0.0.0".
 */
export function readPackageVersion(): string {
  const candidates: string[] = [];

  // Try relative to this file (src/cli/ -> ../../package.json)
  try {
    const fileRelative = import.meta.dirname + "/../../package.json";
    candidates.push(fileRelative);
  } catch {
    // import.meta.dirname not available in some runtimes
  }

  // Fallback to cwd
  candidates.push(process.cwd() + "/package.json");

  for (const path of candidates) {
    try {
      if (existsSync(path)) {
        const pkg = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
        if (typeof pkg.version === "string" && pkg.version) {
          return pkg.version;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  return "0.0.0";
}

// ---------------------------------------------------------------------------
// 5. Config Summary for Re-onboarding
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable summary of existing config for display during re-onboarding.
 */
export function summarizeExistingConfig(
  config: Record<string, unknown>,
): string {
  const lines: string[] = [];

  // LLM section
  const llm = config.llm as Record<string, unknown> | undefined;
  if (llm) {
    const provider = llm.provider ?? "unknown";
    const model = llm.model ?? "unknown";
    const ctx = llm.contextTokens
      ? ` (${Number(llm.contextTokens).toLocaleString()} context)`
      : "";
    lines.push(`  LLM: ${provider}/${model}${ctx}`);
  } else {
    lines.push(`  LLM: not configured`);
  }

  // Telegram section
  const telegram = config.telegram as Record<string, unknown> | undefined;
  if (telegram?.botToken && typeof telegram.botToken === "string") {
    const masked = telegram.botToken.slice(0, 8) + "***";
    lines.push(`  Telegram: configured (${masked})`);
  } else if (telegram) {
    lines.push(`  Telegram: not configured`);
  }

  // Wizard section
  const wizard = config.wizard as Record<string, unknown> | undefined;
  if (wizard?.lastRunAt && typeof wizard.lastRunAt === "string") {
    const date = new Date(wizard.lastRunAt);
    const dateStr = date.toISOString().split("T")[0];
    const mode = (wizard.lastRunMode as string) ?? "unknown";
    lines.push(`  Wizard: last run ${dateStr} (${mode} mode)`);
  }

  // Paths section
  const paths = config.paths as Record<string, unknown> | undefined;
  if (paths) {
    const count = Object.keys(paths).length;
    lines.push(`  Paths: ${count} configured`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 6. Config Reset Handler
// ---------------------------------------------------------------------------

/**
 * Handles config reset with confirmation.
 * Returns true if reset was performed, false if user cancelled.
 */
export async function handleReset(
  scope: "config" | "config+creds" | "full",
  configDir: string,
): Promise<boolean> {
  const configPath = `${configDir}/config.json`;

  // Build list of items to remove
  const filesToRemove: string[] = [];
  const dirsToRemove: string[] = [];

  // Always remove config
  if (existsSync(configPath)) {
    filesToRemove.push(configPath);
  }

  if (scope === "config+creds" || scope === "full") {
    // Remove .env files in config dir
    try {
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(configDir);
      for (const entry of entries) {
        if (entry.startsWith(".env") || entry.endsWith(".env")) {
          const fullPath = `${configDir}/${entry}`;
          if (existsSync(fullPath)) {
            filesToRemove.push(fullPath);
          }
        }
      }
    } catch {
      // Directory not readable, skip
    }
  }

  if (scope === "full") {
    // Parse config to find workspace paths
    try {
      if (existsSync(configPath)) {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const paths = parsed.paths as Record<string, string> | undefined;
        if (paths) {
          for (const path of Object.values(paths)) {
            if (typeof path === "string" && existsSync(path)) {
              const dir = path.includes(".") && !path.endsWith("/") ? dirname(path) : path;
              dirsToRemove.push(dir);
            }
          }
        }
        // Also remove agent offices
        if (parsed.paths && typeof (parsed.paths as Record<string, unknown>).agentOffices === "string") {
          const officeDir = (parsed.paths as Record<string, unknown>).agentOffices as string;
          if (existsSync(officeDir) && !dirsToRemove.includes(officeDir)) {
            dirsToRemove.push(officeDir);
          }
        }
      }
    } catch {
      // Config parse error, skip workspace removal
    }
  }

  if (filesToRemove.length === 0 && dirsToRemove.length === 0) {
    console.log("Nothing to reset — no files or directories found.");
    return false;
  }

  // Remove files
  for (const file of filesToRemove) {
    rmSync(file, { force: true });
    console.log(`  Removed: ${file}`);
  }

  // Remove directories
  for (const dir of dirsToRemove) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`  Removed directory: ${dir}`);
  }

  return true;
}

// ---------------------------------------------------------------------------
// 7. Existing Config Detection
// ---------------------------------------------------------------------------

/**
 * Checks if config exists and parses it.
 */
export function detectExistingConfig(
  configPath: string,
):
  | { exists: false }
  | { exists: true; config: Record<string, unknown> }
  | { exists: true; config: null; error: string } {
  if (!existsSync(configPath)) {
    return { exists: false };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { exists: true, config: parsed };
  } catch (err: unknown) {
    return {
      exists: true,
      config: null,
      error: err instanceof Error ? err.message : "Unknown parse error",
    };
  }
}

// ---------------------------------------------------------------------------
// 8. Random Token Generator
// ---------------------------------------------------------------------------

/**
 * Generates a random hex token.
 * Default: 16 bytes → 32 hex chars.
 */
export function randomToken(length?: number): string {
  return randomBytes(length ?? 16).toString("hex");
}
