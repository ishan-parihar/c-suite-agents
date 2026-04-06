import { z } from "zod";

// ---------------------------------------------------------------------------
// Strategos Configuration Schema
// ---------------------------------------------------------------------------
// Combines patterns from OpenClaw (providers, agents, MCP, memory, model
// fallback chains) and OpenCode (compaction, pruning, overflow detection)
// into a single strict Zod schema.
// ---------------------------------------------------------------------------

/** MCP server: local stdio process */
const McpLocalServerSchema = z.object({
  type: z.literal("local"),
  command: z.array(z.string()).min(1),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional().default(true),
  timeoutMs: z.number().int().positive().optional(),
}).strict();

/** MCP server: remote HTTP/SSE endpoint */
const McpRemoteServerSchema = z.object({
  type: z.literal("remote"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional().default(true),
}).strict();

/** Model-specific limits (OpenClaw pattern) */
const ModelLimitSchema = z.object({
  context: z.number().int().positive().optional(),
  output: z.number().int().positive().optional(),
}).strict().optional();

/** Individual model definition (OpenClaw providers[].models[] pattern) */
const ModelDefSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  reasoning: z.boolean().optional(),
  contextTokens: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
}).strict();

/** Provider definition — multiple providers with fallback support (OpenClaw pattern) */
const ProviderDefSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  api: z.enum(["openai-completions", "anthropic", "google"]).optional().default("openai-completions"),
  models: z.array(ModelDefSchema).optional(),
}).strict();

/** Compaction strategy (merged OpenClaw + OpenCode patterns) */
const CompactionSchema = z.object({
  auto: z.boolean().default(true),
  prune: z.boolean().default(true),
  reserved: z.number().int().min(0).default(20_000),
  keepRecent: z.number().int().min(0).default(6),
  maxHistoryShare: z.number().min(0.1).max(0.9).default(0.5),
  timeoutSeconds: z.number().int().positive().default(900),
}).strict();

/** Pruning thresholds */
const PruningSchema = z.object({
  protectTokens: z.number().int().positive().default(40_000),
  minimumFree: z.number().int().positive().default(20_000),
  protectedTools: z.array(z.string()).default(["memory.consolidate"]),
}).strict();

/** Retry configuration (OpenClaw pattern: exponential backoff + jitter) */
const RetrySchema = z.object({
  attempts: z.number().int().min(1).max(10).default(3),
  minDelayMs: z.number().int().min(0).default(300),
  maxDelayMs: z.number().int().min(0).default(30_000),
  jitter: z.number().min(0).max(1).default(0.2),
}).strict();

/** Embedding model configuration */
const EmbeddingSchema = z.object({
  provider: z.enum(["ollama", "openai", "qwen-proxy"]).default("ollama"),
  model: z.string().default("nomic-embed-text"),
  fallbackModel: z.string().optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  dimensions: z.number().int().positive().default(1024),
}).strict();

export const StrategosConfigSchema = z.object({
  $schema: z.string().optional(),

  // ── LLM provider (simple flat mode) ──────────────────────────────────
  llm: z.object({
    provider: z.enum(["openai", "ollama", "anthropic", "openrouter", "qwen-proxy", "qwen-code"]).default("qwen-proxy"),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    model: z.string().default("qwen3-coder-plus"),
    maxTokens: z.number().int().positive().default(65536),
    temperature: z.number().min(0).max(2).default(0.3),
    timeoutMs: z.number().int().positive().default(180_000),
    contextTokens: z.number().int().positive().optional(),
    retry: RetrySchema.optional(),
  }).strict().optional(),

  // ── Model providers with fallback chains (OpenClaw pattern) ──────────
  providers: z.record(z.string(), ProviderDefSchema).optional(),
  models: z.object({
    primary: z.string().optional(),
    fallbacks: z.array(z.string()).optional(),
  }).optional(),

  // ── Context management ───────────────────────────────────────────────
  context: z.object({
    maxMessages: z.number().int().positive().default(50),
    maxContextTokens: z.number().int().positive().default(32_000),
    compaction: CompactionSchema.optional(),
    pruning: PruningSchema.optional(),
  }).strict().optional(),

  // ── Agent defaults ───────────────────────────────────────────────────
  agents: z.object({
    defaultAutonomy: z.number().int().min(1).max(4).default(3),
    maxConcurrent: z.number().int().positive().default(5),
    maxToolRounds: z.number().int().positive().default(10),
    heartbeatInterval: z.string().optional(),
    directToUser: z.boolean().default(true),
    toolScoping: z.record(z.string(), z.object({
      nativeTools: z.array(z.string()).optional(),
      mcpServers: z.array(z.string()),
      mcpServerTools: z.record(z.string(), z.array(z.string())).optional(),
    }).strict()).optional(),
    // ── Heartbeat configuration (role-based, per-agent) ──────────────
    heartbeat: z.object({
      mode: z.enum(["selective", "all"]).default("selective"),
      defaultAgent: z.string().default("ceo-strategic"),
      agents: z.record(z.string(), z.object({
        enabled: z.boolean().default(false),
        intervalMs: z.number().int().positive().optional(),
      }).strict()).optional().default({}),
    }).strict().optional(),
  }).strict().optional(),

  // ── Board Meeting ──────────────────────────────────────────────────
  boardMeeting: z.object({
    enabled: z.boolean().default(true),
    cronExpression: z.string().default("30 11 * * *"),  // 5 PM IST
    maxTurns: z.number().int().min(2).max(15).default(12),
    perTurnTimeoutMs: z.number().int().default(90000),
    totalMeetingTimeoutMs: z.number().int().default(900000),  // 15 minutes
  }).optional(),

  // ── File paths ───────────────────────────────────────────────────────
  paths: z.object({
    lancedb: z.string().default("/var/lib/strategos/lancedb"),
    kanbanDb: z.string().default("/var/lib/strategos/kanban/kanban.db"),
    messagesDb: z.string().default("/var/lib/strategos/messages/messages.db"),
    agentOffices: z.string().default("/etc/strategos/agents"),
    logFile: z.string().default("/var/log/strategos/strategos.log"),
  }).strict().optional(),

  // ── Telegram ─────────────────────────────────────────────────────────
  telegram: z.object({
    botToken: z.string().optional(),
    chatId: z.string().optional(),
  }).strict().optional(),

  // ── MCP servers ──────────────────────────────────────────────────────
  mcp: z.record(z.string(), z.union([McpLocalServerSchema, McpRemoteServerSchema])).optional(),

  // ── Embedding model ──────────────────────────────────────────────────
  embedding: EmbeddingSchema.optional(),

  // ── Logging ──────────────────────────────────────────────────────────
  logging: z.object({
    level: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    file: z.string().optional(),
    maxFileBytes: z.number().int().positive().default(10 * 1024 * 1024),
  }).strict().optional(),

  // ── Setup wizard metadata ────────────────────────────────────────────
  wizard: z.object({
    lastRunAt: z.string().optional(),
    lastRunVersion: z.string().optional(),
    lastRunCommand: z.enum(["onboard", "configure", "reset"]).optional().default("onboard"),
    lastRunMode: z.enum(["quickstart", "advanced", "remote"]).optional().default("quickstart"),
  }).strict().optional(),

  // Config version metadata (set by stampConfigVersion during migrations)
  _version: z.string().optional(),
}).strict();

export type StrategosConfig = z.infer<typeof StrategosConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingSchema>;
export type RetryConfig = z.infer<typeof RetrySchema>;
export type ModelDef = z.infer<typeof ModelDefSchema>;
export type ProviderDef = z.infer<typeof ProviderDefSchema>;
export type WizardResetScope = "config" | "config+creds" | "full";
