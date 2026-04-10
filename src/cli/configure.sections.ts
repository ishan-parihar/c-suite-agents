import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type WizardSection, type SectionHandler } from "./configure.shared.js";
import { maskValue } from "./config-snapshot.js";
import { runMcpCommand } from "./mcp.js";
import { runDoctor } from "./doctor.js";

// ---------------------------------------------------------------------------
// ANSI Color Helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

// ---------------------------------------------------------------------------
// Readline Helpers
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

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = getRl();
  const defaultHint = defaultValue !== undefined && defaultValue !== ""
    ? ` ${DIM}(${defaultValue})${RESET}`
    : "";
  return new Promise<string>((resolve) => {
    rl.question(`${BOLD}${YELLOW}?${RESET} ${question}${defaultHint}: `, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed === "" && defaultValue !== undefined ? defaultValue : trimmed);
    });
  });
}

// ---------------------------------------------------------------------------
// Config path helper (matches mcp.ts approach)
// ---------------------------------------------------------------------------

const CONFIG_FILE = path.join(os.homedir(), ".operant", "config.json");

function reloadConfig(): Record<string, unknown> {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const stat = fs.statSync(CONFIG_FILE);
    if (stat.size > 100 * 1024) {
      console.warn(`[operant] WARN: Config file too large (${stat.size} bytes), skipping reload`);
      return {};
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function heading(text: string): string {
  return `\n${BOLD}${CYAN}═══ ${text} ═══${RESET}`;
}

function showCurrent(label: string, value: string | number | undefined, fallback = "(not set)"): void {
  const display = value !== undefined && value !== "" && value !== 0
    ? String(value)
    : DIM + fallback + RESET;
  console.log(`  ${DIM}${label.padEnd(20)}${RESET} ${display}`);
}

function parseNumber(input: string, fallback: number | undefined): number | undefined {
  if (input === "") return fallback;
  const n = Number(input);
  return isNaN(n) ? fallback : n;
}

function confirmYesNo(input: string, currentDefault: boolean): boolean {
  if (input === "") return currentDefault;
  return input.toLowerCase().startsWith("y");
}

// ---------------------------------------------------------------------------
// 1. LLM Handler
// ---------------------------------------------------------------------------

async function handleLlm(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(heading("LLM Configuration"));

  const llm = (config.llm || {}) as Record<string, unknown>;
  const provider = (llm.provider as string) || "";
  const baseUrl = (llm.baseUrl as string) || "";
  const model = (llm.model as string) || "";
  const maxTokens = llm.maxTokens as number | undefined;
  const contextTokens = llm.contextTokens as number | undefined;
  const temperature = llm.temperature as number | undefined;
  const timeoutMs = llm.timeoutMs as number | undefined;

  console.log("\n  Current values:");
  showCurrent("Provider", provider || "(not set)");
  showCurrent("Base URL", baseUrl || "(not set)");
  showCurrent("Model", model || "(not set)");
  showCurrent("Max Tokens", maxTokens);
  showCurrent("Context Tokens", contextTokens);
  showCurrent("Temperature", temperature);
  showCurrent("Timeout (ms)", timeoutMs);

  const providers = ["openai", "ollama", "anthropic", "openrouter", "qwen-proxy", "qwen-code"];
  console.log(`\n  Available providers: ${providers.join(", ")}`);

  const newProvider = await prompt("Provider", provider);
  const newBaseUrl = await prompt("Base URL", baseUrl);
  const newModel = await prompt("Model", model);
  const newMaxTokens = parseNumber(await prompt("Max tokens", maxTokens !== undefined ? String(maxTokens) : ""), maxTokens);
  const newContextTokens = parseNumber(await prompt("Context tokens", contextTokens !== undefined ? String(contextTokens) : ""), contextTokens);
  const newTemperature = parseNumber(await prompt("Temperature", temperature !== undefined ? String(temperature) : ""), temperature);
  const newTimeoutMs = parseNumber(await prompt("Timeout ms", timeoutMs !== undefined ? String(timeoutMs) : ""), timeoutMs);

  const changes: Record<string, unknown> = {};

  if (newProvider !== provider) changes.provider = newProvider;
  if (newBaseUrl !== baseUrl) changes.baseUrl = newBaseUrl;
  if (newModel !== model) changes.model = newModel;
  if (newMaxTokens !== maxTokens) changes.maxTokens = newMaxTokens;
  if (newContextTokens !== contextTokens) changes.contextTokens = newContextTokens;
  if (newTemperature !== temperature) changes.temperature = newTemperature;
  if (newTimeoutMs !== timeoutMs) changes.timeoutMs = newTimeoutMs;

  if (Object.keys(changes).length === 0) {
    console.log(`\n  ${DIM}(no changes)${RESET}`);
    return config;
  }

  const updatedLlm = { ...llm, ...changes };
  return { ...config, llm: updatedLlm };
}

// ---------------------------------------------------------------------------
// 2. Context Handler
// ---------------------------------------------------------------------------

async function handleContext(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(heading("Context Management"));

  const ctx = (config.context || {}) as Record<string, unknown>;
  const maxMessages = ctx.maxMessages as number | undefined;
  const maxContextTokens = ctx.maxContextTokens as number | undefined;
  const compaction = (ctx.compaction || {}) as Record<string, unknown>;
  const autoCompaction = compaction.auto !== false;
  const pruneEnabled = compaction.prune !== false;
  const reservedTokens = compaction.reserved as number | undefined;

  console.log("\n  Current values:");
  showCurrent("Max Messages", maxMessages);
  showCurrent("Max Context Tokens", maxContextTokens);
  showCurrent("Auto Compaction", autoCompaction ? "yes" : "no");
  showCurrent("Pruning Enabled", pruneEnabled ? "yes" : "no");
  showCurrent("Reserved Tokens", reservedTokens);

  const newMaxMessages = parseNumber(await prompt("Max messages", maxMessages !== undefined ? String(maxMessages) : ""), maxMessages);
  const newMaxContextTokens = parseNumber(await prompt("Max context tokens", maxContextTokens !== undefined ? String(maxContextTokens) : ""), maxContextTokens);
  const newAuto = confirmYesNo(await prompt("Auto compaction (yes/no)", autoCompaction ? "yes" : "no"), autoCompaction);
  const newPrune = confirmYesNo(await prompt("Pruning enabled (yes/no)", pruneEnabled ? "yes" : "no"), pruneEnabled);
  const newReserved = parseNumber(await prompt("Reserved tokens", reservedTokens !== undefined ? String(reservedTokens) : ""), reservedTokens);

  const updatedContext: Record<string, unknown> = {};

  if (newMaxMessages !== maxMessages) updatedContext.maxMessages = newMaxMessages;
  if (newMaxContextTokens !== maxContextTokens) updatedContext.maxContextTokens = newMaxContextTokens;

  const compactionChanged = newAuto !== autoCompaction || newPrune !== pruneEnabled || newReserved !== reservedTokens;
  if (compactionChanged) {
    updatedContext.compaction = {
      ...compaction,
      auto: newAuto,
      prune: newPrune,
    };
    if (newReserved !== undefined && newReserved !== reservedTokens) {
      (updatedContext.compaction as Record<string, unknown>).reserved = newReserved;
    } else if (compaction.reserved !== undefined) {
      (updatedContext.compaction as Record<string, unknown>).reserved = compaction.reserved;
    }
  }

  if (Object.keys(updatedContext).length === 0) {
    console.log(`\n  ${DIM}(no changes)${RESET}`);
    return config;
  }

  return { ...config, context: { ...ctx, ...updatedContext } };
}

// ---------------------------------------------------------------------------
// 3. Agents Handler
// ---------------------------------------------------------------------------

async function handleAgents(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(heading("Agent Defaults"));

  const agents = (config.agents || {}) as Record<string, unknown>;
  const defaultAutonomy = agents.defaultAutonomy as number | undefined;
  const maxConcurrent = agents.maxConcurrent as number | undefined;
  const maxToolRounds = agents.maxToolRounds as number | undefined;
  const heartbeatInterval = agents.heartbeatInterval as number | undefined;
  const directToUser = agents.directToUser as boolean | undefined;

  console.log("\n  Current values:");
  showCurrent("Default Autonomy", defaultAutonomy, "(1=fully-auto, 4=manual)");
  showCurrent("Max Concurrent", maxConcurrent);
  showCurrent("Max Tool Rounds", maxToolRounds);
  showCurrent("Heartbeat (ms)", heartbeatInterval);
  showCurrent("Direct to User", directToUser !== undefined ? (directToUser ? "yes" : "no") : undefined);

  const autonomyStr = await prompt("Default autonomy (1-4)", defaultAutonomy !== undefined ? String(defaultAutonomy) : "");
  const newAutonomy = parseNumber(autonomyStr, defaultAutonomy);

  const newMaxConcurrent = parseNumber(await prompt("Max concurrent agents", maxConcurrent !== undefined ? String(maxConcurrent) : ""), maxConcurrent);
  const newMaxToolRounds = parseNumber(await prompt("Max tool rounds", maxToolRounds !== undefined ? String(maxToolRounds) : ""), maxToolRounds);

  const heartbeatAnswer = await prompt("Heartbeat interval (ms, or 'none')", heartbeatInterval !== undefined ? String(heartbeatInterval) : "none");
  const newHeartbeat = heartbeatAnswer.toLowerCase() === "none"
    ? undefined
    : parseNumber(heartbeatAnswer, heartbeatInterval);

  const directAnswer = await prompt("Direct to user (yes/no)", directToUser !== undefined ? (directToUser ? "yes" : "no") : "");
  const newDirectToUser = directAnswer !== ""
    ? confirmYesNo(directAnswer, directToUser ?? false)
    : directToUser;

  const changes: Record<string, unknown> = {};
  let deleteHeartbeat = false;

  if (newAutonomy !== defaultAutonomy && newAutonomy !== undefined) changes.defaultAutonomy = newAutonomy;
  if (newMaxConcurrent !== maxConcurrent) changes.maxConcurrent = newMaxConcurrent;
  if (newMaxToolRounds !== maxToolRounds) changes.maxToolRounds = newMaxToolRounds;
  if (newHeartbeat !== heartbeatInterval) {
    if (newHeartbeat === undefined) {
      deleteHeartbeat = true;
    } else {
      changes.heartbeatInterval = newHeartbeat;
    }
  }
  if (directAnswer !== "" && newDirectToUser !== directToUser) changes.directToUser = newDirectToUser;

  if (Object.keys(changes).length === 0 && !deleteHeartbeat) {
    console.log(`\n  ${DIM}(no changes)${RESET}`);
    return config;
  }

  const updatedAgents = { ...agents, ...changes };
  if (deleteHeartbeat) {
    delete updatedAgents.heartbeatInterval;
  }

  return { ...config, agents: updatedAgents };
}

// ---------------------------------------------------------------------------
// 4. Telegram Handler
// ---------------------------------------------------------------------------

async function handleTelegram(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(heading("Telegram Bot"));

  const telegram = (config.telegram || {}) as Record<string, unknown>;
  const botToken = (telegram.botToken as string) || "";
  const chatId = (telegram.chatId as string) || "";

  console.log("\n  Current values:");
  showCurrent("Bot Token", botToken ? maskValue(botToken) : "(not set)");
  showCurrent("Chat ID", chatId ? maskValue(chatId, 4) : "(not set)");

  console.log(`\n  ${DIM}Enter "remove" to unset a value${RESET}`);

  const tokenAnswer = await prompt("Bot token", botToken || "(not set)");
  const chatAnswer = await prompt("Chat ID", chatId || "(not set)");

  const removeToken = tokenAnswer.toLowerCase() === "remove";
  const removeChat = chatAnswer.toLowerCase() === "remove";
  const tokenChanged = removeToken || (tokenAnswer !== "" && tokenAnswer !== botToken && tokenAnswer !== "(not set)");
  const chatChanged = removeChat || (chatAnswer !== "" && chatAnswer !== chatId && chatAnswer !== "(not set)");

  if (!tokenChanged && !chatChanged) {
    console.log(`\n  ${DIM}(no changes)${RESET}`);
    return config;
  }

  const updatedTelegram: Record<string, unknown> = { ...telegram };

  if (removeToken) {
    delete updatedTelegram.botToken;
  } else if (tokenAnswer !== "" && tokenAnswer !== "(not set)") {
    updatedTelegram.botToken = tokenAnswer;
  }

  if (removeChat) {
    delete updatedTelegram.chatId;
  } else if (chatAnswer !== "" && chatAnswer !== "(not set)") {
    updatedTelegram.chatId = chatAnswer;
  }

  // If both removed, delete telegram section entirely
  if (!updatedTelegram.botToken && !updatedTelegram.chatId) {
    const cleaned = { ...config };
    delete cleaned.telegram;
    console.log(`\n  ${GREEN}Telegram section removed${RESET}`);
    return cleaned;
  }

  console.log(`\n  ${GREEN}Telegram updated${RESET}`);
  return { ...config, telegram: updatedTelegram };
}

// ---------------------------------------------------------------------------
// 5. Paths Handler
// ---------------------------------------------------------------------------

async function handlePaths(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(heading("Data Paths"));

  const paths = (config.paths || {}) as Record<string, unknown>;
  const pathKeys = ["lancedb", "kanbanDb", "messagesDb", "agentOffices", "logFile"];
  const pathLabels: Record<string, string> = {
    lancedb: "LanceDB path",
    kanbanDb: "Kanban DB path",
    messagesDb: "Messages DB path",
    agentOffices: "Agent Offices path",
    logFile: "Log file path",
  };

  console.log("\n  Current values:");
  for (const key of pathKeys) {
    const value = (paths[key] as string) || "";
    showCurrent(pathLabels[key], value || "(not set)");
  }

  const changes: Record<string, unknown> = {};

  for (const key of pathKeys) {
    const currentValue = (paths[key] as string) || "";
    const answer = await prompt(pathLabels[key], currentValue || "(not set)");
    if (answer !== "" && answer !== "(not set)" && answer !== currentValue) {
      changes[key] = answer;
    }
  }

  if (Object.keys(changes).length === 0) {
    console.log(`\n  ${DIM}(no changes)${RESET}`);
    return config;
  }

  console.log(`\n  ${GREEN}${Object.keys(changes).length} path(s) updated${RESET}`);
  return { ...config, paths: { ...paths, ...changes } };
}

// ---------------------------------------------------------------------------
// 6. MCP Handler
// ---------------------------------------------------------------------------

async function handleMcp(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(heading("MCP Servers"));

  const mcp = (config.mcp || {}) as Record<string, unknown>;
  const serverCount = Object.keys(mcp).length;
  console.log(`\n  ${DIM}${serverCount} server(s) configured${RESET}`);

  const answer = await prompt("What would you like to do? (list/add/remove/enable/disable/back)", "list");
  const cmd = answer.toLowerCase().trim();

  if (cmd === "back" || cmd === "" || cmd === "b") {
    console.log(`\n  ${DIM}(returning to menu)${RESET}`);
    return config;
  }

  if (!["list", "add", "remove", "enable", "disable"].includes(cmd)) {
    console.log(`\n  ${RED}Unknown command: ${cmd}${RESET}`);
    return config;
  }

  let args: string[] = [];
  if (["remove", "enable", "disable"].includes(cmd)) {
    const name = await prompt("Server name");
    if (!name) {
      console.log(`\n  ${RED}Server name required${RESET}`);
      return config;
    }
    args = [name];
  }

  // runMcpCommand does its own disk I/O — reload config after
  const success = await runMcpCommand(cmd, args);

  if (success) {
    console.log(`\n  ${GREEN}MCP operation completed${RESET}`);
    return reloadConfig();
  } else {
    console.log(`\n  ${RED}MCP operation failed${RESET}`);
    return config;
  }
}

// ---------------------------------------------------------------------------
// 7. Embedding Handler
// ---------------------------------------------------------------------------

async function handleEmbedding(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(heading("Embedding Model"));

  const embedding = (config.embedding || {}) as Record<string, unknown>;
  const provider = (embedding.provider as string) || "";
  const model = (embedding.model as string) || "";
  const dimensions = embedding.dimensions as number | undefined;
  const baseUrl = (embedding.baseUrl as string) || "";
  const fallbackModel = (embedding.fallbackModel as string) || "";

  console.log("\n  Current values:");
  showCurrent("Provider", provider || "(not set)");
  showCurrent("Model", model || "(not set)");
  showCurrent("Dimensions", dimensions);
  showCurrent("Base URL", baseUrl || "(not set)");
  showCurrent("Fallback Model", fallbackModel || "(none)");

  const providers = ["ollama", "openai", "qwen-proxy"];
  console.log(`\n  Available providers: ${providers.join(", ")}`);

  const newProvider = await prompt("Provider", provider);
  const newModel = await prompt("Model", model);
  const newDimensions = parseNumber(await prompt("Dimensions", dimensions !== undefined ? String(dimensions) : ""), dimensions);
  const newBaseUrl = await prompt("Base URL (or 'none')", baseUrl || "none");
  const newFallback = await prompt("Fallback model (or 'none')", fallbackModel || "none");

  const changes: Record<string, unknown> = {};

  if (newProvider !== provider) changes.provider = newProvider;
  if (newModel !== model) changes.model = newModel;
  if (newDimensions !== dimensions) changes.dimensions = newDimensions;

  if (newBaseUrl.toLowerCase() === "none") {
    if (baseUrl) changes.baseUrl = undefined;
  } else if (newBaseUrl !== baseUrl && newBaseUrl !== "none") {
    changes.baseUrl = newBaseUrl;
  }

  if (newFallback.toLowerCase() === "none") {
    if (fallbackModel) changes.fallbackModel = undefined;
  } else if (newFallback !== fallbackModel && newFallback !== "none") {
    changes.fallbackModel = newFallback;
  }

  if (Object.keys(changes).length === 0) {
    console.log(`\n  ${DIM}(no changes)${RESET}`);
    return config;
  }

  const updatedEmbedding = { ...embedding };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete updatedEmbedding[key];
    } else {
      updatedEmbedding[key] = value;
    }
  }

  console.log(`\n  ${GREEN}Embedding updated${RESET}`);
  return { ...config, embedding: updatedEmbedding };
}

// ---------------------------------------------------------------------------
// 8. Logging Handler
// ---------------------------------------------------------------------------

async function handleLogging(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(heading("Logging"));

  const logging = (config.logging || {}) as Record<string, unknown>;
  const level = (logging.level as string) || "info";
  const file = (logging.file as string) || "";
  const maxFileBytes = logging.maxFileBytes as number | undefined;

  console.log("\n  Current values:");
  showCurrent("Level", level);
  showCurrent("File", file || "(stdout only)");
  showCurrent("Max File Size", maxFileBytes !== undefined ? `${(maxFileBytes / (1024 * 1024)).toFixed(1)} MB` : "(default)");

  const levels = ["fatal", "error", "warn", "info", "debug", "trace"];
  console.log(`\n  Available levels: ${levels.join(", ")}`);

  const newLevel = await prompt("Log level", level);
  const newFile = await prompt("Log file path (or 'none')", file || "none");

  const maxFileMb = maxFileBytes !== undefined ? (maxFileBytes / (1024 * 1024)).toFixed(1) : "";
  const newMaxFileStr = await prompt("Max file size (MB)", maxFileMb || "");
  const newMaxFileBytes = newMaxFileStr !== ""
    ? Math.round(parseFloat(newMaxFileStr) * 1024 * 1024)
    : maxFileBytes;

  const changes: Record<string, unknown> = {};

  if (newLevel !== level && levels.includes(newLevel.toLowerCase())) {
    changes.level = newLevel.toLowerCase();
  }

  if (newFile.toLowerCase() === "none") {
    if (file) changes.file = undefined;
  } else if (newFile !== file && newFile !== "none") {
    changes.file = newFile;
  }

  if (newMaxFileBytes !== maxFileBytes && newMaxFileBytes !== undefined) {
    changes.maxFileBytes = newMaxFileBytes;
  }

  if (Object.keys(changes).length === 0) {
    console.log(`\n  ${DIM}(no changes)${RESET}`);
    return config;
  }

  const updatedLogging = { ...logging };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete updatedLogging[key];
    } else {
      updatedLogging[key] = value;
    }
  }

  console.log(`\n  ${GREEN}Logging updated${RESET}`);
  return { ...config, logging: updatedLogging };
}

// ---------------------------------------------------------------------------
// 9. Health Handler
// ---------------------------------------------------------------------------

async function handleHealth(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log(heading("Health Check"));
  console.log(`\n  ${DIM}Running doctor diagnostics...${RESET}\n`);

  const ok = await runDoctor();

  if (ok) {
    console.log(`\n  ${GREEN}All checks passed${RESET}`);
  } else {
    console.log(`\n  ${YELLOW}Some checks need attention — see details above${RESET}`);
  }

  // Health check is read-only — return config unchanged
  return config;
}

// ---------------------------------------------------------------------------
// Section Handlers Registry
// ---------------------------------------------------------------------------

export const SECTION_HANDLERS: Record<WizardSection, SectionHandler> = {
  llm: handleLlm,
  context: handleContext,
  agents: handleAgents,
  telegram: handleTelegram,
  paths: handlePaths,
  mcp: handleMcp,
  embedding: handleEmbedding,
  logging: handleLogging,
  health: handleHealth,
};

// ---------------------------------------------------------------------------
// Cleanup on process exit
// ---------------------------------------------------------------------------

process.on("exit", () => {
  closeRl();
});
