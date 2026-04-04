import readline from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { StrategosConfigSchema } from "../config/schema.js";
import { loadConfig } from "../config/loader.js";
import {
  detectExistingConfig,
  handleReset,
  applyWizardMetadata,
  ensureWorkspaceDirs,
  probeLLMReachable,
} from "./onboard-helpers.js";
import { initializeWorkspace } from "./workspace-bootstrap.js";
import { runDoctor } from "./doctor.js";

// ---------------------------------------------------------------------------
// ANSI Color Helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

function heading(text: string): string {
  return `${BOLD}${CYAN}═${"═".repeat(60)}═${RESET}\n${BOLD}${CYAN}  ${text}${RESET}\n${BOLD}${CYAN}═${"═".repeat(60)}═${RESET}`;
}

function subheading(text: string): string {
  return `\n${BOLD}${MAGENTA}── ${text} ──${RESET}`;
}

function promptLabel(text: string): string {
  return `${BOLD}${YELLOW}?${RESET} ${BOLD}${text}${RESET}`;
}

function hint(text: string): string {
  return `${DIM}   ${text}${RESET}`;
}

function success(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

function error(text: string): string {
  return `${RED}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Readline Prompt Helper
// ---------------------------------------------------------------------------

let rlInstance: readline.Interface | null = null;

function getRl(): readline.Interface {
  if (!rlInstance) {
    rlInstance = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rlInstance;
}

function closeRl(): void {
  if (rlInstance) {
    rlInstance.close();
    rlInstance = null;
  }
}

/**
 * Display a prompt and return the user's answer.
 * If the user enters nothing and a defaultValue is provided, returns defaultValue.
 */
async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = getRl();
  const defaultHint = defaultValue !== undefined && defaultValue !== ""
    ? ` (${defaultValue})`
    : "";

  return new Promise<string>((resolve) => {
    rl.question(`${promptLabel(question)}${defaultHint}: `, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed === "" && defaultValue !== undefined ? defaultValue : trimmed);
    });
  });
}

// ---------------------------------------------------------------------------
// Ctrl+C Graceful Exit
// ---------------------------------------------------------------------------

function setupGracefulExit(): void {
  process.on("SIGINT", () => {
    console.log(`\n\n${YELLOW}Setup cancelled. No changes were made.${RESET}`);
    closeRl();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a Telegram bot token format.
 * Format: <digits>:<alphanumeric_underscore-hyphen>
 * Example: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
 */
function isValidTelegramBotToken(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]{30,}$/.test(token);
}

/**
 * Validate a Telegram chat ID.
 * Can be positive (group/channel) or negative (user) integer, or @username.
 */
function isValidTelegramChatId(chatId: string): boolean {
  return /^-?\d+$/.test(chatId) || /^@/.test(chatId);
}

/**
 * Validate a URL string.
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Path Helpers
// ---------------------------------------------------------------------------

function resolveHomePath(p: string): string {
  return p.replace(/^~/, homedir());
}

function defaultPath(relativeToHome: string): string {
  return join(homedir(), relativeToHome);
}

const DEFAULT_PATHS = {
  lancedb: defaultPath(".local/share/strategos/lancedb"),
  kanbanDb: defaultPath(".local/share/strategos/kanban/kanban.db"),
  messagesDb: defaultPath(".local/share/strategos/messages/messages.db"),
  agentOffices: defaultPath(".strategos/agents"),
  logFile: defaultPath(".local/log/strategos/strategos.log"),
};

const CONFIG_DIR = join(homedir(), ".strategos");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ---------------------------------------------------------------------------
// Quickstart Defaults
// ---------------------------------------------------------------------------

const QUICKSTART_CONFIG = {
  llm: {
    provider: "qwen-proxy" as const,
    baseUrl: "http://127.0.0.1:3000/v1",
    model: "coder-model",
    contextTokens: 262_144,
    maxTokens: 65_536,
  },
  embedding: {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 1024,
  },
  paths: DEFAULT_PATHS,
};

// ---------------------------------------------------------------------------
// Model Presets (for advanced flow)
// ---------------------------------------------------------------------------

interface ModelPreset {
  label: string;
  description: string;
  provider: string;
  baseUrl: string;
  model: string;
  contextTokens: number;
  maxTokens: number;
}

const MODEL_PRESETS: ModelPreset[] = [
  {
    label: "qwen-proxy/coder-model",
    description: "Local Qwen proxy — best for development",
    provider: "qwen-proxy",
    baseUrl: "http://127.0.0.1:3000/v1",
    model: "coder-model",
    contextTokens: 262_144,
    maxTokens: 65_536,
  },
  {
    label: "qwen-proxy/qwen3-coder-plus",
    description: "Cloud Qwen coder model via proxy",
    provider: "qwen-proxy",
    baseUrl: "http://127.0.0.1:3000/v1",
    model: "qwen3-coder-plus",
    contextTokens: 131_072,
    maxTokens: 32_768,
  },
  {
    label: "Custom OpenAI-compatible",
    description: "Any OpenAI-compatible API (OpenRouter, vLLM, etc.)",
    provider: "",
    baseUrl: "",
    model: "",
    contextTokens: 32_768,
    maxTokens: 8_192,
  },
];

// ---------------------------------------------------------------------------
// Agent Office Registry
// ---------------------------------------------------------------------------

const C_SUITE_AGENTS = [
  { id: "ceo-strategic", name: "CEO-Strategic", role: "CEO — Chief Executive Officer" },
  { id: "coo-productivity", name: "COO", role: "COO — Chief Operating Officer" },
  { id: "cpo-psychologist", name: "CPO", role: "CPO — Chief Psychology Officer" },
  { id: "cro-relational", name: "CRO", role: "CRO — Chief Relational Officer" },
  { id: "cfo-financial", name: "CFO", role: "CFO — Chief Financial Officer" },
  { id: "cmo-content", name: "CMO", role: "CMO — Chief Marketing Officer" },
  { id: "cio-intelligence", name: "CIO", role: "CIO — Chief Intelligence Officer" },
  { id: "physician-health", name: "Physician", role: "Chief Health Officer" },
];

// ---------------------------------------------------------------------------
// Configuration Flows
// ---------------------------------------------------------------------------

/**
 * Quickstart: print defaults and confirm.
 */
async function quickstartFlow(): Promise<Record<string, unknown>> {
  console.log(subheading("Quickstart Configuration"));
  console.log(`\nWe'll configure Strategos with sensible defaults:`);
  console.log(`\n${BOLD}LLM Provider:${RESET}`);
  console.log(`  Provider:     ${success("qwen-proxy")}`);
  console.log(`  Base URL:     ${success("http://127.0.0.1:3000/v1")}`);
  console.log(`  Model:        ${success("coder-model")}`);
  console.log(`  Context:      ${success("262,144 tokens")}`);
  console.log(`  Max output:   ${success("65,536 tokens")}`);
  console.log(`\n${BOLD}Agent Offices:${RESET}`);
  console.log(`  ${success("8 C-suite agents")} pre-configured:`);
  for (const agent of C_SUITE_AGENTS) {
    console.log(`    ${BOLD}•${RESET} ${agent.name} — ${DIM}${agent.role}${RESET}`);
  }
  console.log(`\n${BOLD}Paths:${RESET}`);
  console.log(`  LanceDB:      ${DIM}${DEFAULT_PATHS.lancedb}${RESET}`);
  console.log(`  Kanban DB:    ${DIM}${DEFAULT_PATHS.kanbanDb}${RESET}`);
  console.log(`  Messages DB:  ${DIM}${DEFAULT_PATHS.messagesDb}${RESET}`);
  console.log(`  Agent Offices:${DIM}${DEFAULT_PATHS.agentOffices}${RESET}`);
  console.log(`  Log file:     ${DIM}${DEFAULT_PATHS.logFile}${RESET}`);
  console.log(`\n${BOLD}Embedding:${RESET}`);
  console.log(`  Provider:     ${success("ollama")}`);
  console.log(`  Model:        ${success("nomic-embed-text")}`);
  console.log(`  Dimensions:   ${success("1024")}`);
  console.log(hint("Change with 'strategos configure --section embedding'"));

  const confirm = await prompt("\nAccept these defaults?", "yes");
  if (confirm.toLowerCase().startsWith("n")) {
    console.log(`\n${YELLOW}Falling back to advanced configuration...${RESET}`);
    return advancedFlow();
  }

  return {
    llm: { ...QUICKSTART_CONFIG.llm },
    embedding: { ...QUICKSTART_CONFIG.embedding },
    paths: { ...QUICKSTART_CONFIG.paths },
  };
}

/**
 * Advanced: ask each question individually.
 */
async function advancedFlow(): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = {};

  // ── LLM Configuration ──
  config.llm = await configureLlm();

  // ── Telegram Configuration ──
  const telegram = await configureTelegram();
  if (telegram) {
    config.telegram = telegram;
  }

  // ── Embedding Configuration ──
  const embedding = await configureEmbedding();
  if (embedding) {
    config.embedding = embedding;
  }

  // ── Agent Office Setup ──
  await configureAgentOffices(config);

  // ── Path Configuration ──
  config.paths = await configurePaths();

  return config;
}

/**
 * Interactive LLM configuration with endpoint probing.
 */
async function configureLlm(existingDefaults?: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(subheading("LLM Configuration"));
  console.log(hint("Choose how Strategos connects to an AI model.\n"));

  console.log(`${BOLD}Model Presets:${RESET}`);
  for (let i = 0; i < MODEL_PRESETS.length; i++) {
    const preset = MODEL_PRESETS[i];
    console.log(`  ${i + 1}. ${BOLD}${preset.label}${RESET} — ${DIM}${preset.description}${RESET}`);
  }
  console.log(`  ${BOLD}4${RESET}. ${BOLD}Fully custom${RESET} — ${DIM}Enter every field manually${RESET}`);

  const choice = await prompt("\nSelect a preset (1-4)", "1");
  const num = parseInt(choice, 10);

  let llmConfig: Record<string, unknown>;

  if (num >= 1 && num <= 3) {
    const preset = MODEL_PRESETS[num - 1];
    console.log(`\n${success(`Selected: ${preset.label}`)}`);
    llmConfig = {
      provider: preset.provider,
      baseUrl: preset.baseUrl,
      model: preset.model,
      contextTokens: preset.contextTokens,
      maxTokens: preset.maxTokens,
    };
  } else {
    // Fully custom
    console.log(`\n${BOLD}Custom LLM Configuration${RESET}`);

    const provider = await prompt(
      "Provider name (openai, ollama, anthropic, openrouter, qwen-proxy, qwen-code)",
      existingDefaults?.provider as string ?? "openai",
    );

    const baseUrl = await promptWithValidation(
      "Base URL (OpenAI-compatible API endpoint)",
      "e.g., https://api.openai.com/v1",
      (existingDefaults?.baseUrl as string) ?? "https://api.openai.com/v1",
      isValidUrl,
      "Please enter a valid URL (e.g., https://api.openai.com/v1)",
    );

    const model = await prompt(
      "Model name",
      (existingDefaults?.model as string) ?? "gpt-4o",
    );

    const contextTokensStr = await prompt(
      "Context window size (in tokens)",
      existingDefaults?.contextTokens ? String(existingDefaults.contextTokens) : "32768",
    );
    const contextTokens = parseInt(contextTokensStr, 10) || 32_768;

    const maxTokensStr = await prompt(
      "Maximum output tokens",
      existingDefaults?.maxTokens ? String(existingDefaults.maxTokens) : "8192",
    );
    const maxTokens = parseInt(maxTokensStr, 10) || 8_192;

    llmConfig = {
      provider,
      baseUrl,
      model,
      contextTokens,
      maxTokens,
    };
  }

  // Probe the endpoint
  const baseUrl = llmConfig.baseUrl as string;
  if (baseUrl) {
    console.log(`\n${DIM}Probing LLM endpoint: ${baseUrl}...${RESET}`);
    const reachable = await probeLLMReachable(baseUrl);
    if (!reachable) {
      console.log(`${YELLOW}⚠ LLM endpoint is not reachable.${RESET}`);
      console.log(hint("This may be because the service is not yet running."));
      const proceed = await prompt("Continue anyway?", "yes");
      if (proceed.toLowerCase().startsWith("n")) {
        console.log(`${YELLOW}Retrying LLM configuration...${RESET}`);
        return configureLlm(existingDefaults);
      }
    } else {
      console.log(success("✓ LLM endpoint confirmed reachable."));
    }
  }

  return llmConfig;
}

/**
 * Interactive Telegram configuration.
 * Returns undefined if user skips.
 */
async function configureTelegram(): Promise<Record<string, unknown> | undefined> {
  console.log(subheading("Telegram Bot Configuration"));
  console.log(hint("Connect a Telegram bot for chat-based interaction."));
  console.log(hint("Skip this if you don't need Telegram integration.\n"));

  const skip = await prompt("Configure Telegram bot?", "no");
  if (skip.toLowerCase().startsWith("n")) {
    console.log(`${YELLOW}Telegram configuration skipped.${RESET}`);
    return undefined;
  }

  const botToken = await promptWithValidation(
    "Bot Token (from @BotFather)",
    "Format: 123456789:ABCdefGHI...",
    "",
    isValidTelegramBotToken,
    "Invalid token format. Expected format: digits:alphanumeric (e.g., 123456789:ABCdef...)",
  );

  const chatId = await promptWithValidation(
    "Chat ID",
    "Your Telegram user/group ID (negative for users, positive for groups, or @username)",
    "",
    isValidTelegramChatId,
    "Invalid chat ID. Use a numeric ID (e.g., -1001234567890) or @username",
  );

  return { botToken, chatId };
}

/**
 * Interactive embedding model configuration.
 * Returns null if user skips.
 */
async function configureEmbedding(existing?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  console.log(subheading("Embedding Model Configuration"));
  console.log(hint("Embedding models power memory search and similarity. Configure your embedding provider.\n"));

  const answer = await prompt("Configure embedding model?", "yes");
  if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
    console.log(`${YELLOW}Embedding configuration skipped.${RESET}`);
    return null;
  }

  // Provider selection
  const provider = await promptWithValidation(
    "Embedding provider (ollama/openai/qwen-proxy)",
    "Choose your embedding provider",
    ((existing?.provider as string) || "ollama"),
    (v: string) => ["ollama", "openai", "qwen-proxy"].includes(v.trim().toLowerCase()),
    "Must be ollama, openai, or qwen-proxy",
  );

  // Model
  const model = await prompt(
    "Embedding model",
    (existing?.model as string) || "nomic-embed-text",
  );

  // Dimensions
  const dimAnswer = await prompt(
    "Vector dimensions",
    String((existing?.dimensions as number) || 1024),
  );
  const dimensions = parseInt(dimAnswer, 10) || 1024;

  // Fallback model (optional)
  const fallback = await prompt(
    "Fallback model (optional, or Enter to skip)",
    (existing?.fallbackModel as string) || "",
  );

  // Base URL (optional)
  const baseUrl = await prompt(
    "Base URL (optional, or Enter to use provider default)",
    (existing?.baseUrl as string) || "",
  );

  const result: Record<string, unknown> = {
    provider: provider.toLowerCase(),
    model: model.trim() || "nomic-embed-text",
    dimensions,
  };
  if (fallback.trim()) result.fallbackModel = fallback.trim();
  if (baseUrl.trim()) result.baseUrl = baseUrl.trim();

  console.log(success(`✓ Embedding configured: ${result.provider}/${result.model} (${dimensions}d)`));
  return result;
}

/**
 * Agent office setup: display C-suite agents and create offices.
 */
async function configureAgentOffices(config: Record<string, unknown>): Promise<void> {
  console.log(subheading("Agent Office Setup"));
  console.log(hint("Strategos uses a C-suite multi-agent architecture."));
  console.log(hint("Each agent gets its own office directory with identity files.\n"));

  console.log(`${BOLD}C-Suite Agents:${RESET}`);
  for (const agent of C_SUITE_AGENTS) {
    console.log(`  ${BOLD}•${RESET} ${agent.name} ${DIM}(${agent.role})${RESET}`);
  }

  const officesPath = (config.paths as Record<string, string> | undefined)?.agentOffices
    ?? DEFAULT_PATHS.agentOffices;

  console.log(`\nThis will create agent offices at: ${BOLD}${officesPath}${RESET}`);
  const confirm = await prompt("Create agent offices?", "yes");
  if (confirm.toLowerCase().startsWith("n")) {
    console.log(`${YELLOW}Agent office creation skipped.${RESET}`);
    return;
  }

  console.log(`\n${DIM}Initializing workspace and seeding agent offices...${RESET}`);
  await initializeWorkspace(config);

  for (const agent of C_SUITE_AGENTS) {
    console.log(`  ${success("✓")} ${agent.name} office created`);
  }
}

/**
 * Interactive path configuration.
 */
async function configurePaths(existingDefaults?: Record<string, string>): Promise<Record<string, unknown>> {
  console.log(subheading("Directory & File Paths"));
  console.log(hint("Where Strategos stores data. Press Enter to accept defaults.\n"));

  const defaults = existingDefaults ?? DEFAULT_PATHS;

  const lancedb = await prompt(
    "LanceDB directory (vector embeddings)",
    defaults.lancedb,
  );

  const kanbanDb = await prompt(
    "Kanban database file",
    defaults.kanbanDb,
  );

  const messagesDb = await prompt(
    "Messages database file",
    defaults.messagesDb,
  );

  const agentOffices = await prompt(
    "Agent offices directory (agent memory files)",
    defaults.agentOffices,
  );

  const logFile = await prompt(
    "Log file path",
    defaults.logFile,
  );

  return {
    lancedb: resolveHomePath(lancedb),
    kanbanDb: resolveHomePath(kanbanDb),
    messagesDb: resolveHomePath(messagesDb),
    agentOffices: resolveHomePath(agentOffices),
    logFile: resolveHomePath(logFile),
  };
}

/**
 * Prompt with validation: repeats until valid input or user accepts default.
 */
async function promptWithValidation(
  question: string,
  description: string,
  defaultValue: string,
  validator: (value: string) => boolean,
  errorMessage: string,
): Promise<string> {
  while (true) {
    console.log(hint(description));
    const answer = await prompt(question, defaultValue || undefined);

    if (answer === "" && defaultValue === "") {
      console.log(error("This field is required."));
      continue;
    }

    if (validator(answer)) {
      return answer;
    }

    console.log(error(errorMessage));
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// Config Writing
// ---------------------------------------------------------------------------

/**
 * Validate the assembled config against the schema.
 */
function validateConfig(raw: Record<string, unknown>): { valid: boolean; errors?: string } {
  const result = StrategosConfigSchema.safeParse(raw);
  if (result.success) {
    return { valid: true };
  }
  const errors = result.error.errors
    .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
    .join("\n");
  return { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Main Wizard
// ---------------------------------------------------------------------------

export async function runSetupWizard(): Promise<boolean> {
  setupGracefulExit();

  // ── Step 1: Welcome + Risk Acknowledgment ──
  console.log(``);
  console.log(heading("  Strategos Setup Wizard"));
  console.log(``);
  console.log(`  Welcome! This wizard will configure Strategos for first-time use.`);
  console.log(`  You'll set up:`);
  console.log(`    ${BOLD}•${RESET} AI model provider and connection`);
  console.log(`    ${BOLD}•${RESET} Telegram bot (optional)`);
  console.log(`    ${BOLD}•${RESET} Agent offices for C-suite multi-agent architecture`);
  console.log(`    ${BOLD}•${RESET} Data directories and log file`);
  console.log(``);

  // Risk acknowledgment
  console.log(`${RED}${BOLD}⚠ SECURITY WARNING${RESET}`);
  console.log(`${RED}Strategos runs autonomous agents that can execute code, manage tasks,${RESET}`);
  console.log(`${RED}and interact with external services. Ensure you trust the configuration.${RESET}`);
  console.log(``);
  const ack = await prompt('Type "I understand" to continue');
  if (ack !== "I understand") {
    console.log(`\n${YELLOW}Acknowledgment not received. Setup cancelled.${RESET}`);
    closeRl();
    return false;
  }
  console.log(success("✓ Risk acknowledged."));

  // ── Step 2: Existing Config Detection ──
  const existing = detectExistingConfig(CONFIG_FILE);
  if (existing.exists) {
    console.log(subheading("Existing Configuration Detected"));

    if (existing.config) {
      // Use summarizeExistingConfig if available
      const { summarizeExistingConfig } = await import("./onboard-helpers.js");
      console.log(summarizeExistingConfig(existing.config));
    } else {
      console.log(`${YELLOW}⚠ Config file exists but could not be parsed:${RESET}`);
      console.log(`  ${error(existing.error)}`);
    }

    console.log(`\n${BOLD}What would you like to do?${RESET}`);
    console.log(`  ${BOLD}1.${RESET} ${BOLD}Keep${RESET}     — Use existing config, skip to verification`);
    console.log(`  ${BOLD}2.${RESET} ${BOLD}Modify${RESET}   — Load existing values as defaults, run full wizard`);
    console.log(`  ${BOLD}3.${RESET} ${BOLD}Reset${RESET}    — Remove config and start fresh`);

    const choice = await prompt("\nSelect option (1-3)", "1");

    if (choice === "1") {
      // Keep — skip to verification
      console.log(`\n${success("Keeping existing configuration.")}`);
      closeRl();
      return true;
    }

    if (choice === "3") {
      // Reset
      console.log(`\n${BOLD}Reset scope:${RESET}`);
      console.log(`  ${BOLD}1.${RESET} ${BOLD}config${RESET}       — Config file only`);
      console.log(`  ${BOLD}2.${RESET} ${BOLD}config+creds${RESET} — Config + credentials (.env files)`);
      console.log(`  ${BOLD}3.${RESET} ${BOLD}full${RESET}         — Everything including workspace data`);

      const scopeChoice = await prompt("\nSelect scope (1-3)", "1");
      const scopeMap: Record<string, "config" | "config+creds" | "full"> = {
        "1": "config",
        "2": "config+creds",
        "3": "full",
      };
      const scope = scopeMap[scopeChoice] ?? "config";

      const confirmReset = await prompt(
        `\nThis will remove ${scope === "full" ? "all data" : scope === "config+creds" ? "config and credentials" : "the config file"}. Continue?`,
        "no",
      );
      if (!confirmReset.toLowerCase().startsWith("y")) {
        console.log(`\n${YELLOW}Reset cancelled.${RESET}`);
        closeRl();
        return false;
      }

      await handleReset(scope, CONFIG_DIR);
      console.log(`\n${success("Reset complete. Starting fresh configuration...")}`);
      // Fall through to full wizard
    }

    if (choice === "2" || choice === "3") {
      // Modify or after Reset — run advanced flow with existing defaults
      const llmDefaults = existing.config?.llm as Record<string, unknown> | undefined;
      const pathDefaults = existing.config?.paths as Record<string, string> | undefined;

      console.log(subheading("Advanced Configuration (modify mode)"));
      console.log(hint("Existing values shown as defaults. Press Enter to keep.\n"));

      const rawConfig: Record<string, unknown> = {};
      rawConfig.llm = await configureLlm(llmDefaults);

      const telegram = await configureTelegram();
      if (telegram) {
        rawConfig.telegram = telegram;
      }

      const embeddingExisting = existing.config?.embedding as Record<string, unknown> | undefined;
      const embedding = await configureEmbedding(embeddingExisting);
      if (embedding) {
        rawConfig.embedding = embedding;
      }

      await configureAgentOffices(rawConfig);

      rawConfig.paths = await configurePaths(pathDefaults);

      // Validate
      console.log(subheading("Validating Configuration"));
      const validation = validateConfig(rawConfig);
      if (!validation.valid) {
        console.log(error("\n✗ Configuration validation failed:\n"));
        console.log(error(validation.errors!));
        console.log(`\n${YELLOW}Please fix the issues and try again.${RESET}`);
        closeRl();
        return false;
      }
      console.log(success("✓ All inputs validated successfully."));

      // Apply metadata, ensure dirs, write
      await writeConfigWithMetadata(rawConfig);

      // Summary
      await printSummary(rawConfig);
      closeRl();
      return true;
    }
  }

  // ── Step 3: Flow Selection ──
  console.log(`${BOLD}Choose your setup flow:${RESET}`);
  console.log(`  ${BOLD}1.${RESET} ${BOLD}Quickstart${RESET} — ${DIM}Sensible defaults, minimal questions${RESET}`);
  console.log(`  ${BOLD}2.${RESET} ${BOLD}Advanced${RESET}   — ${DIM}Customize every setting${RESET}`);

  const flowChoice = await prompt("\nSelect flow (1 or 2)", "1");

  let rawConfig: Record<string, unknown>;

  if (flowChoice === "1") {
    rawConfig = await quickstartFlow();
  } else {
    rawConfig = await advancedFlow();
  }

  // ── Step 8: Validate + Write ──
  await writeConfigWithMetadata(rawConfig);

  // ── Step 9: Summary ──
  await printSummary(rawConfig);

  closeRl();
  return true;
}

/**
 * Apply wizard metadata, ensure workspace directories, and write config to disk.
 */
async function writeConfigWithMetadata(rawConfig: Record<string, unknown>): Promise<void> {
  // Validate before writing
  console.log(subheading("Validating Configuration"));
  const validation = validateConfig(rawConfig);

  if (!validation.valid) {
    console.log(error("\n✗ Configuration validation failed:\n"));
    console.log(error(validation.errors!));
    console.log(`\n${YELLOW}Please fix the issues and try again.${RESET}`);
    closeRl();
    throw new Error("Config validation failed");
  }

  console.log(success("✓ All inputs validated successfully."));

  // Apply wizard metadata
  applyWizardMetadata(rawConfig);

  // Ensure workspace directories exist
  const paths = rawConfig.paths as Record<string, string> | undefined;
  if (paths) {
    console.log(`\n${DIM}Creating workspace directories...${RESET}`);
    ensureWorkspaceDirs(paths);
  }

  // Create config directory
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    console.log(`\n${success(`Created directory: ${CONFIG_DIR}`)}`);
  }

  // Warn if config already exists
  if (existsSync(CONFIG_FILE)) {
    console.log(`\n${YELLOW}⚠ Config file already exists at:${RESET}`);
    console.log(`  ${CONFIG_FILE}`);
    console.log(`${YELLOW}  It will be overwritten.${RESET}`);
  }

  // Write config
  const json = JSON.stringify(rawConfig, null, 2);
  writeFileSync(CONFIG_FILE, json, "utf-8");
  chmodSync(CONFIG_FILE, 0o600);
  console.log(`\n${success(`Config written to: ${CONFIG_FILE}`)}`);
}

/**
 * Display final configuration summary and offer doctor check.
 */
async function printSummary(rawConfig: Record<string, unknown>): Promise<void> {
  const llm = rawConfig.llm as Record<string, unknown> | undefined;
  const telegram = rawConfig.telegram as Record<string, unknown> | undefined;
  const paths = rawConfig.paths as Record<string, string> | undefined;

  console.log(`\n${heading("  Configuration Summary")}`);
  console.log(``);

  if (llm) {
    console.log(`${BOLD}LLM Provider:${RESET}`);
    console.log(`  Provider:     ${success(String(llm.provider ?? "unknown"))}`);
    console.log(`  Model:        ${success(String(llm.model ?? "unknown"))}`);
    console.log(`  Base URL:     ${DIM}${llm.baseUrl ?? "default"}${RESET}`);
    if (llm.contextTokens) {
      console.log(`  Context:      ${success(`${Number(llm.contextTokens).toLocaleString()} tokens`)}${RESET}`);
    }
    if (llm.maxTokens) {
      console.log(`  Max output:   ${success(`${Number(llm.maxTokens).toLocaleString()} tokens`)}${RESET}`);
    }
  }

  if (telegram) {
    console.log(`\n${BOLD}Telegram:${RESET}`);
    console.log(`  Bot token:    ${success("configured")}`);
    console.log(`  Chat ID:      ${success(String(telegram.chatId ?? "default"))}`);
  } else {
    console.log(`\n${BOLD}Telegram:${RESET} ${YELLOW}not configured${RESET}`);
  }

  const embedding = rawConfig.embedding as Record<string, unknown> | undefined;
  if (embedding) {
    console.log(`\n${BOLD}Embedding:${RESET}`);
    console.log(`  Provider:     ${success(String(embedding.provider ?? "unknown"))}`);
    console.log(`  Model:        ${success(String(embedding.model ?? "unknown"))}`);
    if (embedding.dimensions) {
      console.log(`  Dimensions:   ${success(`${embedding.dimensions}d`)}`);
    }
    if (embedding.fallbackModel) {
      console.log(`  Fallback:     ${DIM}${embedding.fallbackModel}${RESET}`);
    }
  } else {
    console.log(`\n${BOLD}Embedding:${RESET} ${YELLOW}not configured${RESET}`);
  }

  console.log(`\n${BOLD}Agent Offices:${RESET}`);
  console.log(`  ${success("8 C-suite agents")} configured`);
  if (paths?.agentOffices) {
    console.log(`  Directory:    ${DIM}${paths.agentOffices}${RESET}`);
  }

  if (paths) {
    console.log(`\n${BOLD}Data Paths:${RESET}`);
    console.log(`  LanceDB:      ${DIM}${paths.lancedb ?? DEFAULT_PATHS.lancedb}${RESET}`);
    console.log(`  Kanban DB:    ${DIM}${paths.kanbanDb ?? DEFAULT_PATHS.kanbanDb}${RESET}`);
    console.log(`  Messages DB:  ${DIM}${paths.messagesDb ?? DEFAULT_PATHS.messagesDb}${RESET}`);
    console.log(`  Log file:     ${DIM}${paths.logFile ?? DEFAULT_PATHS.logFile}${RESET}`);
  }

  // Next steps
  console.log(`\n${subheading("Next Steps")}`);
  console.log(`  1. Review your config: ${BOLD}cat ${CONFIG_FILE}${RESET}`);
  console.log(`  2. Start Strategos:    ${BOLD}bun run src/index.ts${RESET}`);
  console.log(`  3. Configure env vars: ${BOLD}cp .env.example .env${RESET} (if needed)`);

  // Offer doctor
  const runDoctorChoice = await prompt("\nRun doctor check?", "yes");
  if (!runDoctorChoice.toLowerCase().startsWith("n")) {
    await runDoctor();
  }

  console.log(`\n${GREEN}${BOLD}Strategos is configured and ready.${RESET}\n`);
}

// ---------------------------------------------------------------------------
// Direct Execution (bun run src/cli/setup-wizard.ts)
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  runSetupWizard()
    .then((ok) => {
      process.exit(ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(error(`\nFatal error: ${err.message}`));
      closeRl();
      process.exit(1);
    });
}
