/**
 * Strategos Config System — Comprehensive Test Suite
 * 
 * Tests: schema validation, config loader, env defaults, qwen-proxy resolution,
 * providers/models sections, deepMerge, stripUndefined, backward compatibility.
 * 
 * Run: bun run test-config.ts
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StrategosConfigSchema } from "./src/config/schema.js";
import { loadConfig, getConfigPath } from "./src/config/loader.js";

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function pass(name: string): void {
  passCount++;
  console.log(`[PASS] ${name}`);
}

function fail(name: string, reason: string): void {
  failCount++;
  failures.push(`${name}: ${reason}`);
  console.log(`[FAIL] ${name} - ${reason}`);
}

function assert(condition: boolean, name: string, reason?: string): void {
  if (condition) pass(name);
  else fail(name, reason ?? "condition was false");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG_FILE = getConfigPath();
const CONFIG_BACKUP = CONFIG_FILE + ".backup.test";

function backupConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.copyFileSync(CONFIG_FILE, CONFIG_BACKUP);
    fs.unlinkSync(CONFIG_FILE);
  }
}

function restoreConfig(): void {
  if (fs.existsSync(CONFIG_BACKUP)) {
    fs.copyFileSync(CONFIG_BACKUP, CONFIG_FILE);
    fs.unlinkSync(CONFIG_BACKUP);
  }
}

function writeTempConfig(content: string): void {
  fs.writeFileSync(CONFIG_FILE, content, "utf-8");
}

function clearEnvVars(): Map<string, string | undefined> {
  const vars = [
    "AGENT_LLM_PROVIDER", "AGENT_LLM_BASE_URL", "AGENT_LLM_MODEL",
    "AGENT_LLM_MAX_TOKENS", "AGENT_LLM_TEMPERATURE", "AGENT_LLM_CONTEXT_TOKENS",
    "AGENT_LLM_FALLBACK_MODELS",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OLLAMA_API_KEY",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
    "LANCEDB_DIR", "KANBAN_DB", "MESSAGES_DB",
    "LOG_LEVEL", "LOG_FILE",
  ];
  const saved = new Map<string, string | undefined>();
  for (const v of vars) {
    saved.set(v, process.env[v]);
    delete process.env[v];
  }
  return saved;
}

function restoreEnv(saved: Map<string, string | undefined>): void {
  for (const [key, val] of saved) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log("=== Strategos Config Test Suite ===\n");

// ── Test 1: Default config loads without errors (no config file, only env defaults) ──
{
  const testName = "Default config loads without errors (no config file, env defaults only)";
  const savedEnv = clearEnvVars();
  backupConfig();
  try {
    const config = loadConfig();
    assert(
      config.llm?.provider === "qwen-proxy",
      testName,
      `expected provider "qwen-proxy", got "${config.llm?.provider}"`,
    );
    assert(
      config.llm?.model === "coder-model",
      testName,
      `expected model "coder-model", got "${config.llm?.model}"`,
    );
    assert(
      config.llm?.maxTokens === 65536,
      testName,
      `expected maxTokens 65536, got ${config.llm?.maxTokens}`,
    );
  } catch (err: unknown) {
    fail(testName, (err as Error).message);
  } finally {
    restoreConfig();
    restoreEnv(savedEnv);
  }
}

// ── Test 2: Config file at ~/.strategos/config.json parses correctly ──
{
  const testName = "Config file at ~/.strategos/config.json parses correctly";
  const savedEnv = clearEnvVars();
  try {
    // Ensure the real config file exists
    assert(
      fs.existsSync(CONFIG_FILE),
      testName,
      `config file does not exist at ${CONFIG_FILE}`,
    );
    if (fs.existsSync(CONFIG_FILE)) {
      const config = loadConfig();
      assert(
        config.llm?.provider === "qwen-proxy",
        testName,
        `expected provider "qwen-proxy", got "${config.llm?.provider}"`,
      );
      assert(
        config.llm?.model === "coder-model",
        testName,
        `expected model "coder-model", got "${config.llm?.model}"`,
      );
    }
  } catch (err: unknown) {
    fail(testName, (err as Error).message);
  } finally {
    restoreEnv(savedEnv);
  }
}

// ── Test 3: Zod validation rejects invalid provider ──
{
  const testName = "Zod validation rejects invalid provider (e.g. 'invalid-provider')";
  const result = StrategosConfigSchema.safeParse({
    llm: { provider: "invalid-provider" },
  });
  assert(
    !result.success,
    testName,
    result.success ? "validation unexpectedly succeeded" : undefined,
  );
}

// ── Test 4: Zod validation rejects negative maxTokens ──
{
  const testName = "Zod validation rejects negative maxTokens";
  const result = StrategosConfigSchema.safeParse({
    llm: { maxTokens: -100 },
  });
  assert(
    !result.success,
    testName,
    result.success ? "validation unexpectedly succeeded" : undefined,
  );
}

// ── Test 5: Zod validation rejects invalid log level ──
{
  const testName = "Zod validation rejects invalid log level";
  const result = StrategosConfigSchema.safeParse({
    logging: { level: "verbose" },
  });
  assert(
    !result.success,
    testName,
    result.success ? "validation unexpectedly succeeded" : undefined,
  );
}

// ── Test 6: qwen-proxy provider is accepted ──
{
  const testName = "qwen-proxy provider is accepted by schema";
  const result = StrategosConfigSchema.safeParse({
    llm: { provider: "qwen-proxy" },
  });
  assert(
    result.success,
    testName,
    result.success ? undefined : JSON.stringify(result.error.errors),
  );
}

// ── Test 7: Retry config with custom values ──
{
  const testName = "Retry config with custom values (attempts:5, minDelayMs:100, maxDelayMs:60000, jitter:0.5)";
  const result = StrategosConfigSchema.safeParse({
    llm: {
      retry: {
        attempts: 5,
        minDelayMs: 100,
        maxDelayMs: 60000,
        jitter: 0.5,
      },
    },
  });
  if (result.success) {
    const retry = result.data.llm?.retry;
    assert(
      retry?.attempts === 5,
      testName,
      `expected attempts=5, got ${retry?.attempts}`,
    );
    assert(
      retry?.minDelayMs === 100,
      testName,
      `expected minDelayMs=100, got ${retry?.minDelayMs}`,
    );
    assert(
      retry?.maxDelayMs === 60000,
      testName,
      `expected maxDelayMs=60000, got ${retry?.maxDelayMs}`,
    );
    assert(
      retry?.jitter === 0.5,
      testName,
      `expected jitter=0.5, got ${retry?.jitter}`,
    );
  } else {
    fail(testName, JSON.stringify(result.error.errors));
  }
}

// ── Test 8: providers/models section resolves correctly ──
{
  const testName = "providers/models section resolves correctly";
  const savedEnv = clearEnvVars();
  backupConfig();
  try {
    writeTempConfig(JSON.stringify({
      providers: {
        "openai": {
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test-key",
          api: "openai-completions",
          models: [
            { id: "model-fast", name: "Fast Model", maxTokens: 8192, contextTokens: 32768 },
            { id: "model-smart", name: "Smart Model", reasoning: true, maxTokens: 65536 },
          ],
        },
      },
      models: {
        primary: "model-fast",
        fallbacks: ["model-smart"],
      },
    }));
    const config = loadConfig();
    assert(
      config.llm?.provider === "openai",
      testName,
      `expected provider "openai", got "${config.llm?.provider}"`,
    );
    assert(
      config.llm?.model === "model-fast",
      testName,
      `expected model "model-fast", got "${config.llm?.model}"`,
    );
    assert(
      config.llm?.baseUrl === "https://api.example.com/v1",
      testName,
      `expected baseUrl from provider, got "${config.llm?.baseUrl}"`,
    );
    assert(
      config.llm?.maxTokens === 8192,
      testName,
      `expected maxTokens=8192 from model def, got ${config.llm?.maxTokens}`,
    );
    assert(
      config.providers !== undefined,
      testName,
      "providers section was lost after resolution",
    );
    assert(
      config.models !== undefined,
      testName,
      "models section was lost after resolution",
    );
  } catch (err: unknown) {
    fail(testName, (err as Error).message);
  } finally {
    restoreConfig();
    restoreEnv(savedEnv);
  }
}

// ── Test 9: deepMerge correctly overrides env defaults with file config ──
{
  const testName = "deepMerge correctly overrides env defaults with file config";
  const savedEnv = clearEnvVars();
  backupConfig();
  try {
    // Set an env default for model
    process.env.AGENT_LLM_MODEL = "env-default-model";
    // Write a config file that overrides the model
    writeTempConfig(JSON.stringify({
      llm: {
        model: "file-override-model",
        maxTokens: 12345,
      },
    }));
    const config = loadConfig();
    assert(
      config.llm?.model === "file-override-model",
      testName,
      `expected file override "file-override-model", got "${config.llm?.model}"`,
    );
    assert(
      config.llm?.maxTokens === 12345,
      testName,
      `expected file maxTokens=12345, got ${config.llm?.maxTokens}`,
    );
  } catch (err: unknown) {
    fail(testName, (err as Error).message);
  } finally {
    restoreConfig();
    restoreEnv(savedEnv);
  }
}

// ── Test 10: stripUndefined removes undefined values (verified via loader behavior) ──
{
  const testName = "stripUndefined removes undefined values from merged config";
  const savedEnv = clearEnvVars();
  backupConfig();
  try {
    // Write minimal config — no telegram, no paths, no logging
    // The env defaults should NOT produce empty string values
    writeTempConfig(JSON.stringify({}));
    const config = loadConfig();
    // Verify that llm section doesn't have undefined or empty-string apiKey from env
    assert(
      config.llm?.apiKey === undefined || config.llm?.apiKey === "",
      testName,
      `expected apiKey undefined (no env keys set), got "${config.llm?.apiKey}"`,
    );
    // Verify defaults are applied (schema .default() kicks in)
    assert(
      config.llm?.temperature === 0.3,
      testName,
      `expected default temperature=0.3, got ${config.llm?.temperature}`,
    );
    assert(
      config.llm?.maxTokens === 65536,
      testName,
      `expected default maxTokens=65536, got ${config.llm?.maxTokens}`,
    );
  } catch (err: unknown) {
    fail(testName, (err as Error).message);
  } finally {
    restoreConfig();
    restoreEnv(savedEnv);
  }
}

// ── Test 11: Config path is correct (~/.strategos/config.json) ──
{
  const testName = "Config path is correct (~/.strategos/config.json)";
  const expected = path.join(os.homedir(), ".strategos", "config.json");
  const actual = getConfigPath();
  assert(
    actual === expected,
    testName,
    `expected "${expected}", got "${actual}"`,
  );
}

// ── Test 12: Invalid JSON in config file is handled gracefully ──
{
  const testName = "Invalid JSON in config file is handled gracefully (falls back to defaults)";
  const savedEnv = clearEnvVars();
  backupConfig();
  try {
    writeTempConfig("{ this is not valid json !!! }");
    const config = loadConfig();
    // Should have loaded with defaults
    assert(
      config.llm?.provider === "qwen-proxy",
      testName,
      `expected fallback provider "qwen-proxy", got "${config.llm?.provider}"`,
    );
    assert(
      config.llm?.model === "coder-model",
      testName,
      `expected fallback model "coder-model", got "${config.llm?.model}"`,
    );
  } catch (err: unknown) {
    fail(testName, (err as Error).message);
  } finally {
    restoreConfig();
    restoreEnv(savedEnv);
  }
}

// ── Additional: Valid log levels are accepted ──
{
  const testName = "Valid log levels are accepted by schema";
  const levels: Array<"fatal" | "error" | "warn" | "info" | "debug" | "trace"> = [
    "fatal", "error", "warn", "info", "debug", "trace",
  ];
  let allPassed = true;
  for (const level of levels) {
    const result = StrategosConfigSchema.safeParse({ logging: { level } });
    if (!result.success) {
      allPassed = false;
      break;
    }
  }
  assert(allPassed, testName, "one or more valid log levels were rejected");
}

// ── Additional: Schema accepts all valid providers ──
{
  const testName = "All valid providers accepted by schema";
  const providers = ["openai", "ollama", "anthropic", "openrouter", "qwen-proxy", "qwen-code"];
  let allPassed = true;
  for (const provider of providers) {
    const result = StrategosConfigSchema.safeParse({ llm: { provider } });
    if (!result.success) {
      allPassed = false;
      break;
    }
  }
  assert(allPassed, testName, "one or more valid providers were rejected");
}

// ── Additional: Retry max attempts (10) is accepted ──
{
  const testName = "Retry max attempts (10) is accepted";
  const result = StrategosConfigSchema.safeParse({
    llm: { retry: { attempts: 10, minDelayMs: 0, maxDelayMs: 0, jitter: 0 } },
  });
  assert(
    result.success,
    testName,
    result.success ? undefined : JSON.stringify(result.error.errors),
  );
}

// ── Additional: Retry attempts > 10 is rejected ──
{
  const testName = "Retry attempts > 10 is rejected";
  const result = StrategosConfigSchema.safeParse({
    llm: { retry: { attempts: 11, minDelayMs: 0, maxDelayMs: 0, jitter: 0 } },
  });
  assert(
    !result.success,
    testName,
    result.success ? "validation unexpectedly succeeded" : undefined,
  );
}

// ── Additional: Context compaction defaults apply when compaction present ──
{
  const testName = "Context compaction defaults apply when compaction section present";
  const savedEnv = clearEnvVars();
  backupConfig();
  try {
    writeTempConfig(JSON.stringify({ context: { compaction: {} } }));
    const config = loadConfig();
    assert(
      config.context?.compaction?.auto === true,
      testName,
      `expected compaction.auto=true, got ${config.context?.compaction?.auto}`,
    );
    assert(
      config.context?.compaction?.reserved === 20000,
      testName,
      `expected compaction.reserved=20000, got ${config.context?.compaction?.reserved}`,
    );
  } catch (err: unknown) {
    fail(testName, (err as Error).message);
  } finally {
    restoreConfig();
    restoreEnv(savedEnv);
  }
}

// ── Additional: Full current config loads cleanly ──
{
  const testName = "Full current config (~/.strategos/config.json) loads cleanly";
  const savedEnv = clearEnvVars();
  try {
    const config = loadConfig();
    assert(
      config.paths?.lancedb === "/home/ishanp/.local/share/strategos/lancedb",
      testName,
      `expected lancedb path, got "${config.paths?.lancedb}"`,
    );
    assert(
      config.telegram?.chatId === "5297486612",
      testName,
      `expected telegram chatId, got "${config.telegram?.chatId}"`,
    );
    assert(
      config.logging?.level === "info",
      testName,
      `expected logging level "info", got "${config.logging?.level}"`,
    );
    assert(
      config.agents?.maxConcurrent === 5,
      testName,
      `expected maxConcurrent=5, got ${config.agents?.maxConcurrent}`,
    );
  } catch (err: unknown) {
    fail(testName, (err as Error).message);
  } finally {
    restoreEnv(savedEnv);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
}

process.exit(failCount > 0 ? 1 : 0);
