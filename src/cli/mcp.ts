import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

// ── ANSI Color Helpers ───────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

function heading(text: string): string {
  return `${BOLD}${CYAN}${text}${RESET}`;
}

function success(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

function error(text: string): string {
  return `${RED}${text}${RESET}`;
}

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

// ── Config Path ──────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), ".strategos");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function loadRawConfig(): Record<string, unknown> {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const stat = fs.statSync(CONFIG_FILE);
    if (stat.size > 100 * 1024) {
      console.warn(`[strategos] WARN: Config file too large (${stat.size} bytes), skipping`);
      return {};
    }
  } catch {
    return {};
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function saveRawConfig(config: Record<string, unknown>): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── Validation Helpers ───────────────────────────────────────────────────

function isValidServerName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name);
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isValidMcpServer(server: unknown): boolean {
  if (typeof server !== "object" || server === null) return false;
  const s = server as Record<string, unknown>;
  if (s.type === "local") {
    if (!Array.isArray(s.command) || s.command.length === 0) return false;
    if (!s.command.every((c) => typeof c === "string")) return false;
    if (s.env !== undefined) {
      if (typeof s.env !== "object" || s.env === null) return false;
      for (const [k, v] of Object.entries(s.env as Record<string, unknown>)) {
        if (typeof k !== "string" || typeof v !== "string") return false;
      }
    }
    if (s.enabled !== undefined && typeof s.enabled !== "boolean") return false;
    return true;
  }
  if (s.type === "remote") {
    if (typeof s.url !== "string") return false;
    if (!isValidUrl(s.url)) return false;
    if (s.headers !== undefined) {
      if (typeof s.headers !== "object" || s.headers === null) return false;
      for (const [k, v] of Object.entries(s.headers as Record<string, unknown>)) {
        if (typeof k !== "string" || typeof v !== "string") return false;
      }
    }
    if (s.enabled !== undefined && typeof s.enabled !== "boolean") return false;
    return true;
  }
  return false;
}

// ── Readline Helper (only for add wizard) ────────────────────────────────

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

async function rlPrompt(question: string, defaultValue?: string): Promise<string> {
  const rl = getRl();
  const defaultHint = defaultValue !== undefined && defaultValue !== ""
    ? ` (${defaultValue})`
    : "";
  return new Promise<string>((resolve) => {
    rl.question(`${BOLD}${YELLOW}?${RESET} ${BOLD}${question}${RESET}${defaultHint}: `, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed === "" && defaultValue !== undefined ? defaultValue : trimmed);
    });
  });
}

// ── 1. mcpList ───────────────────────────────────────────────────────────

export function mcpList(config: Record<string, unknown>): void {
  const mcp = config.mcp as Record<string, unknown> | undefined;

  console.log("");
  console.log(heading("MCP Servers:"));

  if (!mcp || Object.keys(mcp).length === 0) {
    console.log(`  ${dim("(none configured)")}`);
    console.log("");
    return;
  }

  for (const [name, server] of Object.entries(mcp)) {
    const s = server as Record<string, unknown>;
    const enabled = s.enabled !== false;
    const statusIcon = enabled ? success("✓") : error("✗");
    const type = dim(String(s.type ?? "unknown"));
    const enabledLabel = enabled ? success("enabled") : error("disabled");

    let detail: string;
    if (s.type === "local" && Array.isArray(s.command)) {
      detail = (s.command as string[]).join(" ");
    } else if (s.type === "remote" && typeof s.url === "string") {
      detail = s.url;
    } else {
      detail = dim("(invalid)");
    }

    console.log(`  ${statusIcon} ${bold(name.padEnd(16))} ${type.padEnd(8)} ${dim(detail)}  ${enabledLabel}`);
  }
  console.log("");
}

// ── 2. mcpAdd ────────────────────────────────────────────────────────────

export async function mcpAdd(
  config: Record<string, unknown>,
  args: string[],
): Promise<Record<string, unknown> | { ok: false; error: string }> {
  let name: string | undefined;
  let type: "local" | "remote" | undefined;
  let commandStr: string | undefined;
  let url: string | undefined;
  let envPairs: string[] = [];
  let headerPairs: string[] = [];

  // Parse CLI args if provided: mcp add <name> <type> [--command "cmd arg1 arg2"] [--url <url>] [--env KEY=value] [--header Key=value]
  if (args.length >= 2) {
    name = args[0];
    const typeArg = args[1];
    if (typeArg !== "local" && typeArg !== "remote") {
      return { ok: false, error: `Invalid type "${typeArg}". Must be "local" or "remote".` };
    }
    type = typeArg;

    let i = 2;
    while (i < args.length) {
      switch (args[i]) {
        case "--command":
          commandStr = args[++i];
          break;
        case "--url":
          url = args[++i];
          break;
        case "--env":
          envPairs.push(args[++i]);
          break;
        case "--header":
          headerPairs.push(args[++i]);
          break;
        default:
          return { ok: false, error: `Unknown flag "${args[i]}".` };
      }
      i++;
    }
  }

  // Interactive wizard if not enough args
  if (!name) {
    name = await rlPrompt("Server name (alphanumeric + hyphens)");
    if (!name) return { ok: false, error: "Server name is required." };
  }

  if (!isValidServerName(name)) {
    return { ok: false, error: `Invalid server name "${name}". Use alphanumeric characters and hyphens only.` };
  }

  if (!type) {
    const typeAnswer = await rlPrompt("Type", "local");
    if (typeAnswer !== "local" && typeAnswer !== "remote") {
      return { ok: false, error: `Invalid type "${typeAnswer}". Must be "local" or "remote".` };
    }
    type = typeAnswer as "local" | "remote";
  }

  const server: Record<string, unknown> = { type };

  if (type === "local") {
    if (!commandStr) {
      commandStr = await rlPrompt("Command (space-separated, e.g. 'npx -y @mcp/server')");
      if (!commandStr) return { ok: false, error: "Command is required for local servers." };
    }
    server.command = commandStr.split(/\s+/).filter(Boolean);
  } else {
    if (!url) {
      url = await rlPrompt("URL (e.g. https://api.example.com/mcp)");
      if (!url) return { ok: false, error: "URL is required for remote servers." };
    }
    if (!isValidUrl(url)) {
      return { ok: false, error: `Invalid URL: ${url}` };
    }
    server.url = url;
  }

  // Environment variables
  if (envPairs.length === 0) {
    const envAnswer = await rlPrompt("Environment variables (KEY=value, comma-separated, or empty)");
    if (envAnswer.trim()) {
      envPairs = envAnswer.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (envPairs.length > 0) {
    const env: Record<string, string> = {};
    for (const pair of envPairs) {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) {
        return { ok: false, error: `Invalid env pair "${pair}". Expected KEY=value.` };
      }
      env[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
    }
    server.env = env;
  }

  // Headers (remote only)
  if (type === "remote") {
    if (headerPairs.length === 0) {
      const headerAnswer = await rlPrompt("Headers (Key:value, comma-separated, or empty)");
      if (headerAnswer.trim()) {
        headerPairs = headerAnswer.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    if (headerPairs.length > 0) {
      const headers: Record<string, string> = {};
      for (const pair of headerPairs) {
        const colonIndex = pair.indexOf(":");
        if (colonIndex === -1) {
          return { ok: false, error: `Invalid header pair "${pair}". Expected Key:value.` };
        }
        headers[pair.slice(0, colonIndex).trim()] = pair.slice(colonIndex + 1).trim();
      }
      server.headers = headers;
    }
  }

  // Validate against schema rules
  if (!isValidMcpServer(server)) {
    return { ok: false, error: "Server configuration failed schema validation." };
  }

  // Merge into config
  const mcp = (config.mcp as Record<string, unknown> | undefined) ?? {};
  mcp[name] = server;
  config.mcp = mcp;

  console.log(success(`\n✓ MCP server "${name}" added successfully.`));
  return config;
}

// ── 3. mcpRemove ─────────────────────────────────────────────────────────

export function mcpRemove(
  config: Record<string, unknown>,
  name: string,
): Record<string, unknown> | { ok: false; error: string } {
  const mcp = config.mcp as Record<string, unknown> | undefined;
  if (!mcp || !(name in mcp)) {
    return { ok: false, error: `MCP server "${name}" not found.` };
  }

  delete mcp[name];

  if (Object.keys(mcp).length === 0) {
    delete config.mcp;
  }

  console.log(success(`\n✓ MCP server "${name}" removed.`));
  return config;
}

// ── 4. mcpToggle ─────────────────────────────────────────────────────────

export function mcpToggle(
  config: Record<string, unknown>,
  name: string,
  enabled: boolean,
): Record<string, unknown> | { ok: false; error: string } {
  const mcp = config.mcp as Record<string, unknown> | undefined;
  if (!mcp || !(name in mcp)) {
    return { ok: false, error: `MCP server "${name}" not found.` };
  }

  const server = mcp[name] as Record<string, unknown>;
  server.enabled = enabled;

  console.log(success(`\n✓ MCP server "${name}" ${enabled ? "enabled" : "disabled"}.`));
  return config;
}

// ── 5. mcpStatus ─────────────────────────────────────────────────────────

export function mcpStatus(config: Record<string, unknown>): void {
  const mcp = config.mcp as Record<string, unknown> | undefined;

  console.log("");
  console.log(heading("MCP Server Status:"));

  if (!mcp || Object.keys(mcp).length === 0) {
    console.log(`  ${dim("(none configured)")}`);
    console.log("");
    return;
  }

  const entries = Object.entries(mcp);
  for (let idx = 0; idx < entries.length; idx++) {
    const [name, server] = entries[idx];
    const s = server as Record<string, unknown>;
    const enabled = s.enabled !== false;
    const statusLabel = enabled ? success("enabled") : error("disabled");

    console.log(`  ${bold(name)}:`);
    console.log(`    ${dim("Type:")}        ${s.type ?? "unknown"}`);

    if (s.type === "local" && Array.isArray(s.command)) {
      console.log(`    ${dim("Command:")}     ${(s.command as string[]).join(" ")}`);
    } else if (s.type === "remote" && typeof s.url === "string") {
      console.log(`    ${dim("URL:")}         ${s.url}`);
    }

    console.log(`    ${dim("Status:")}      ${statusLabel}`);

    if (s.env && typeof s.env === "object") {
      for (const [k, v] of Object.entries(s.env as Record<string, string>)) {
        console.log(`    ${dim("Environment:")} ${k}=${v}`);
      }
    }

    if (s.headers && typeof s.headers === "object") {
      for (const [k, v] of Object.entries(s.headers as Record<string, string>)) {
        const masked = k.toLowerCase().includes("auth") || k.toLowerCase().includes("token") || k.toLowerCase().includes("key")
          ? v.slice(0, 6) + "***"
          : v;
        console.log(`    ${dim("Headers:")}     ${k}: ${masked}`);
      }
    }

    if (idx < entries.length - 1) {
      console.log("");
    }
  }
  console.log("");
}

// ── Main Dispatcher ──────────────────────────────────────────────────────

export async function runMcpCommand(command: string, args: string[]): Promise<boolean> {
  let config: Record<string, unknown>;

  try {
    config = loadRawConfig();
  } catch (err: unknown) {
    console.error(error(`Failed to load config: ${(err as Error).message}`));
    return false;
  }

  switch (command) {
    case "list": {
      mcpList(config);
      return true;
    }

    case "status": {
      mcpStatus(config);
      return true;
    }

    case "add": {
      const result = await mcpAdd(config, args);
      if ("ok" in result && !result.ok) {
        console.error(error(`Error: ${result.error}`));
        return false;
      }
      try {
        saveRawConfig(result as Record<string, unknown>);
        return true;
      } catch (err: unknown) {
        console.error(error(`Failed to save config: ${(err as Error).message}`));
        return false;
      }
    }

    case "remove": {
      const name = args[0];
      if (!name) {
        console.error(error("Usage: mcp remove <server-name>"));
        return false;
      }
      const result = mcpRemove(config, name);
      if ("ok" in result && !result.ok) {
        console.error(error(`Error: ${result.error}`));
        return false;
      }
      try {
        saveRawConfig(result as Record<string, unknown>);
        return true;
      } catch (err: unknown) {
        console.error(error(`Failed to save config: ${(err as Error).message}`));
        return false;
      }
    }

    case "enable":
    case "disable": {
      const name = args[0];
      if (!name) {
        console.error(error(`Usage: mcp ${command} <server-name>`));
        return false;
      }
      const result = mcpToggle(config, name, command === "enable");
      if ("ok" in result && !result.ok) {
        console.error(error(`Error: ${result.error}`));
        return false;
      }
      try {
        saveRawConfig(result as Record<string, unknown>);
        return true;
      } catch (err: unknown) {
        console.error(error(`Failed to save config: ${(err as Error).message}`));
        return false;
      }
    }

    default: {
      console.error(error(`Unknown MCP command: "${command}"`));
      console.error("");
      console.error(heading("Usage:"));
      console.error(`  mcp list                  List all MCP servers`);
      console.error(`  mcp status                Show detailed status`);
      console.error(`  mcp add [args]            Add a new server (interactive or CLI args)`);
      console.error(`  mcp remove <name>         Remove a server`);
      console.error(`  mcp enable <name>         Enable a server`);
      console.error(`  mcp disable <name>        Disable a server`);
      console.error("");
      return false;
    }
  }
}

// ── Direct Execution ─────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] || "list";
  const args = process.argv.slice(3);
  const ok = await runMcpCommand(command, args);
  closeRl();
  process.exit(ok ? 0 : 1);
}
