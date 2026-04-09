import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { StrategosConfigSchema, type StrategosConfig, type ProviderDef, type ModelDef } from "./schema.js";

const CONFIG_DIR = path.join(os.homedir(), ".strategos");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function envOr<T>(key: string, fallback: T): T {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return value as unknown as T;
}

function envNumber(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return isNaN(parsed) ? fallback : parsed;
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) result[key] = value;
  }
  return result;
}

const VALID_PROVIDERS = ["openai", "ollama", "anthropic", "openrouter", "qwen-proxy", "qwen-code"];

function buildEnvDefaults(): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // LLM - always included with qwen-proxy defaults
  const provider = envOr("AGENT_LLM_PROVIDER", "qwen-proxy") as string;
  const baseUrl = envOr("AGENT_LLM_BASE_URL", "http://127.0.0.1:3000/v1") as string;
  const openaiKey = envOr("OPENAI_API_KEY", "") as string;
  const anthropicKey = envOr("ANTHROPIC_API_KEY", "") as string;
  const openrouterKey = envOr("OPENROUTER_API_KEY", "") as string;
  const ollamaKey = envOr("OLLAMA_API_KEY", "") as string;
  const model = envOr("AGENT_LLM_MODEL", "coder-model") as string;
  const maxTokens = envNumber("AGENT_LLM_MAX_TOKENS", 65536);
  const temperature = envNumber("AGENT_LLM_TEMPERATURE", 0.3);
  const contextTokens = envNumber("AGENT_LLM_CONTEXT_TOKENS", 262144);

  const apiKey = openaiKey || anthropicKey || openrouterKey || ollamaKey || "";

  // Parse fallback models from env (comma-separated)
  const fallbackModelsRaw = envOr("AGENT_LLM_FALLBACK_MODELS", "") as string;
  const fallbackModels = fallbackModelsRaw
    ? fallbackModelsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  result.llm = stripUndefined({
    provider: VALID_PROVIDERS.includes(provider) ? provider : "qwen-proxy",
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    model: model || undefined,
    maxTokens: maxTokens,
    temperature: temperature,
    contextTokens: contextTokens,
  });

  // models section from env (fallback chain support)
  if (fallbackModels?.length) {
    result.models = stripUndefined({
      primary: model || undefined,
      fallbacks: fallbackModels,
    });
  }

  const telegramToken = envOr("TELEGRAM_BOT_TOKEN", "") as string;
  const telegramChatId = envOr("TELEGRAM_CHAT_ID", "") as string;
  if (telegramToken || telegramChatId) {
    result.telegram = stripUndefined({
      botToken: telegramToken || undefined,
      chatId: telegramChatId || undefined,
    });
  }

  const lancedb = envOr("LANCEDB_DIR", "") as string;
  const kanbanDb = envOr("KANBAN_DB", "") as string;
  const messagesDb = envOr("MESSAGES_DB", "") as string;
  if (lancedb || kanbanDb || messagesDb) {
    result.paths = stripUndefined({
      lancedb: lancedb || undefined,
      kanbanDb: kanbanDb || undefined,
      messagesDb: messagesDb || undefined,
    });
  }

  const logLevel = envOr("LOG_LEVEL", "") as string;
  const logFile = envOr("LOG_FILE", "") as string;
  if (logLevel || logFile) {
    result.logging = stripUndefined({
      level: ["fatal", "error", "warn", "info", "debug", "trace"].includes(logLevel)
        ? (logLevel as "fatal" | "error" | "warn" | "info" | "debug" | "trace")
        : undefined,
      file: logFile || undefined,
    });
  }

  // Embedding provider config
  const embedProvider = envOr("EMBEDDING_PROVIDER", "") as string;
  const embedModel = envOr("EMBEDDING_MODEL", "") as string;
  const embedBaseUrl = envOr("EMBEDDING_BASE_URL", "") as string;
  const embedApiKey = envOr("EMBEDDING_API_KEY", "") as string;
  const embedDimensions = envNumber("EMBEDDING_DIMENSIONS", 0);
  if (embedProvider || embedModel || embedBaseUrl) {
    result.embedding = stripUndefined({
      provider: ["ollama", "openai", "qwen-proxy"].includes(embedProvider) ? embedProvider : undefined,
      model: embedModel || undefined,
      baseUrl: embedBaseUrl || undefined,
      apiKey: embedApiKey || undefined,
      dimensions: embedDimensions > 0 ? embedDimensions : undefined,
    });
  }

  // Media handling config
  const mediaEnabled = process.env.MEDIA_ENABLED === 'true' || undefined;
  const mediaMaxSizeMB = process.env.MEDIA_MAX_SIZE_MB ? parseInt(process.env.MEDIA_MAX_SIZE_MB) : undefined;
  const mediaApexWrapper = process.env.MEDIA_APEX_WRAPPER || undefined;
  const mediaApexPython = process.env.MEDIA_APEX_PYTHON || undefined;
  if (mediaEnabled || mediaMaxSizeMB || mediaApexWrapper || mediaApexPython) {
    result.media = stripUndefined({
      enabled: mediaEnabled,
      maxSizeMB: mediaMaxSizeMB,
      apexWrapper: mediaApexWrapper,
      apexPython: mediaApexPython,
    });
  }

  return result;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];
    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue as Record<string, unknown>, sourceValue as Record<string, unknown>);
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }
  return result;
}

/** Find a model by ID across all providers. */
function findModelInProviders(
  providers: Record<string, ProviderDef>,
  modelId: string,
): { providerName: string; provider: ProviderDef; model?: ModelDef } | null {
  for (const [name, provider] of Object.entries(providers)) {
    if (provider.models) {
      const model = provider.models.find((m) => m.id === modelId);
      if (model) {
        return { providerName: name, provider, model };
      }
    }
  }
  return null;
}

/** Resolve model configuration from providers/models sections. */
function resolveModelConfig(merged: Record<string, unknown>): Record<string, unknown> | null {
  const providers = merged.providers as Record<string, ProviderDef> | undefined;
  const models = merged.models as { primary?: string; fallbacks?: string[] } | undefined;

  if (!providers || !models?.primary) return null;

  const resolved = findModelInProviders(providers, models.primary);
  if (!resolved) return null;

  const { provider, model } = resolved;

  const existingLlm = (merged.llm || {}) as Record<string, unknown>;

  return stripUndefined({
    provider: resolved.providerName,
    baseUrl: provider.baseUrl ?? existingLlm.baseUrl,
    apiKey: provider.apiKey ?? existingLlm.apiKey,
    model: models.primary,
    maxTokens: model?.maxTokens ?? existingLlm.maxTokens,
    contextTokens: model?.contextTokens ?? existingLlm.contextTokens,
    temperature: existingLlm.temperature,
    timeoutMs: existingLlm.timeoutMs,
  });
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): StrategosConfig {
  let fileConfig: Record<string, unknown> = {};

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const stat = fs.statSync(CONFIG_FILE);
      if (stat.size > 100 * 1024) {
        console.warn(`[strategos] WARN: Config file too large (${stat.size} bytes), skipping. Falling back to defaults + .env`);
      } else {
        const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
        fileConfig = JSON.parse(raw) as Record<string, unknown>;
      }
    } catch (err: unknown) {
      console.error(
        `[strategos] ERROR: Failed to parse ${CONFIG_FILE}: ${(err as Error).message}. Falling back to defaults + .env`,
      );
    }
  }

  const envDefaults = buildEnvDefaults();
  const merged = deepMerge(
    envDefaults as Record<string, unknown>,
    fileConfig,
  );

  // Resolve models.primary from providers section
  const resolvedLlm = resolveModelConfig(merged);
  if (resolvedLlm) {
    const existingLlm = (merged.llm || {}) as Record<string, unknown>;
    merged.llm = deepMerge(existingLlm, resolvedLlm);
  }

  const parseResult = StrategosConfigSchema.safeParse(merged);

  if (!parseResult.success) {
    const errors = parseResult.error.errors
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(
      `Invalid Strategos config (${CONFIG_FILE}):\n${errors}`,
    );
  }

  return parseResult.data;
}
