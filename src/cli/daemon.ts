#!/usr/bin/env node
//
// Operant Daemon Management — runtime systemd service lifecycle
// Usage: operant daemon {install|start|stop|restart|status|uninstall} [options]
//

import { homedir, userInfo } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync, copyFileSync, renameSync } from "node:fs";
import * as crypto from "node:crypto";
import { loadConfig, getConfigPath } from "../config/loader.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE_NAME = "operant";
const UNIT_NAME = `${SERVICE_NAME}.service`;

function resolveUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", UNIT_NAME);
}

function resolveDataDir(): string {
  return join(homedir(), ".local", "share", "operant");
}

function resolveLogDir(): string {
  return join(homedir(), ".local", "log", "operant");
}

function resolveAppDir(): string {
  return join(__dirname, "..", "..");
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

function ok(text: string): string { return `${GREEN}✓${RESET} ${text}`; }
function warn(text: string): string { return `${YELLOW}!${RESET} ${text}`; }
function err(text: string): string { return `${RED}✗${RESET} ${text}`; }
function info(text: string): string { return `${DIM}·${RESET} ${text}`; }
function label(key: string, value: string): string { return `${DIM}${key}:${RESET} ${BOLD}${value}${RESET}`; }

// ---------------------------------------------------------------------------
// systemd helpers
// ---------------------------------------------------------------------------

function systemctl(args: string[], userScope = true): { stdout: string; stderr: string; code: number } {
  const scope = userScope ? ["--user"] : [];
  const result = spawnSync("systemctl", [...scope, ...args], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const code = result.status ?? 1;
  if (code !== 0) throw Object.assign(new Error(stderr), { stdout, stderr, status: code });
  return { stdout, stderr, code };
}

function isSystemdAvailable(userScope = true): boolean {
  const res = systemctl(["status"], userScope);
  return res.code === 0;
}

function systemctlDirectUserScope(args: string[]): { stdout: string; stderr: string; code: number } {
  return systemctl(args, true);
}

function systemctlMachineScope(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const sudoUser = process.env.SUDO_USER?.trim();
    const user = sudoUser && sudoUser !== "root" ? sudoUser : process.env.USER || process.env.LOGNAME || userInfo().username;
    if (!user) return systemctl(args, true);
    return systemctl(["--machine", `${user}@`, "--user", ...args], false);
  } catch {
    return systemctl(args, true);
  }
}

function systemctlSafe(args: string[]): { stdout: string; stderr: string; code: number } {
  const res = systemctlDirectUserScope(args);
  if (res.code === 0) return res;
  const detail = `${res.stderr} ${res.stdout}`.toLowerCase();
  if (detail.includes("failed to connect") || detail.includes("no bus") || detail.includes("user bus")) {
    return systemctlMachineScope(args);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Unit file generation
// ---------------------------------------------------------------------------

function systemdEscape(value: string): string {
  if (/[\s"\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function buildUnitFile(params: {
  description?: string;
  nodePath: string;
  scriptPath: string;
  workingDirectory: string;
  environmentFile?: string;
  nonSecretEnv?: Record<string, string>;
  port?: number;
}): string {
  const execParts = [params.nodePath, params.scriptPath];
  const execStart = execParts.map(systemdEscape).join(" ");

  const lines = [
    "[Unit]",
    `Description=${params.description || "Operant Multi-Agent Orchestrator"}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    `ExecStart=${execStart}`,
    `WorkingDirectory=${systemdEscape(params.workingDirectory)}`,
    "Restart=always",
    "RestartSec=5",
    "TimeoutStopSec=30",
    "TimeoutStartSec=30",
    "SuccessExitStatus=0 143",
    "KillMode=control-group",
    "StandardOutput=journal",
    "StandardError=journal",
    "KillSignal=SIGINT",
    "NoNewPrivileges=true",
    "ProtectHome=no",
    `ReadWritePaths=${systemdEscape(params.workingDirectory)} ${systemdEscape(resolveLogDir())} ${systemdEscape(resolveDataDir())} ${systemdEscape(join(homedir(), ".local", "run"))} ${systemdEscape(join(homedir(), ".operant"))}`,
  ];

  if (params.environmentFile) {
    lines.push(`EnvironmentFile=${params.environmentFile}`);
  }

  for (const [key, value] of Object.entries(params.nonSecretEnv || {})) {
    if (value.trim()) {
      lines.push(`Environment=${systemdEscape(`${key}=${value.trim()}`)}`);
    }
  }

  if (params.port) {
    lines.push(`Environment=HEALTH_CHECK_PORT=${params.port}`);
  }

  lines.push("", "[Install]", "WantedBy=default.target", "");

  return lines.join("\n");
}

const SECRET_KEYS = new Set(["LLM_API_KEY", "TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY"]);

function splitSecrets(env: Record<string, string>): { secrets: Record<string, string>; nonSecrets: Record<string, string> } {
  const secrets: Record<string, string> = {};
  const nonSecrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_KEYS.has(key)) secrets[key] = value;
    else nonSecrets[key] = value;
  }
  return { secrets, nonSecrets };
}

function resolveEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  const config = loadConfig();

  // LLM config
  if (config.llm) {
    if (config.llm.provider) env.LLM_PROVIDER = config.llm.provider;
    if (config.llm.model) env.LLM_MODEL = config.llm.model;
    if (config.llm.baseUrl) env.LLM_BASE_URL = config.llm.baseUrl;
    if (config.llm.apiKey) env.LLM_API_KEY = config.llm.apiKey;
    if (config.llm.maxTokens) env.LLM_MAX_TOKENS = String(config.llm.maxTokens);
    if (config.llm.temperature !== undefined) env.LLM_TEMPERATURE = String(config.llm.temperature);
    if (config.llm.contextTokens) env.LLM_CONTEXT_TOKENS = String(config.llm.contextTokens);
    if (config.llm.timeoutMs) env.LLM_TIMEOUT_MS = String(config.llm.timeoutMs);
  }

  // Telegram
  if (config.telegram) {
    if (config.telegram.botToken) env.TELEGRAM_BOT_TOKEN = config.telegram.botToken;
    if (config.telegram.chatId) env.TELEGRAM_CHAT_ID = config.telegram.chatId;
  }

  // Paths
  if (config.paths) {
    if (config.paths.lancedb) env.LANCEDB_DIR = config.paths.lancedb;
    if (config.paths.kanbanDb) env.KANBAN_DB = config.paths.kanbanDb;
    if (config.paths.messagesDb) env.MESSAGES_DB = config.paths.messagesDb;
    if (config.paths.agentOffices) env.AGENT_OFFICES = config.paths.agentOffices;
    if (config.paths.logFile) env.LOG_FILE = config.paths.logFile;
  }

  // Logging
  if (config.logging?.level) env.LOG_LEVEL = config.logging.level;
  if (config.logging?.file) env.LOG_FILE = config.logging.file;

  // Node TLS (for self-hosted proxies)
  if (process.env.NODE_EXTRA_CA_CERTS) env.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS;

  // OpenAI API key (for image/TTS tools)
  if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_BASE_URL) env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;

  return env;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function runDaemonInstall(args: string[]): Promise<boolean> {
  let force = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--force") force = true;
    if (args[i] === "--json") json = true;
  }

  const unitPath = resolveUnitPath();

  // Check if already installed
  if (existsSync(unitPath) && !force) {
    const res = systemctlSafe(["is-enabled", UNIT_NAME]);
    if (res.code === 0) {
      if (json) {
        console.log(JSON.stringify({ ok: true, result: "already-installed", unitPath }));
      } else {
        console.log(ok(`Service already installed at ${unitPath}`));
        console.log(info(`Reinstall with: operant daemon install --force`));
      }
      return true;
    }
  }

  // Ensure directories exist
  mkdirSync(dirname(unitPath), { recursive: true });
  mkdirSync(resolveLogDir(), { recursive: true });
  mkdirSync(resolveDataDir(), { recursive: true });

  // Resolve paths
  const appDir = resolveAppDir();
  const scriptPath = join(appDir, "build", "index.js");
  if (!existsSync(scriptPath)) {
    console.log(err(`Application not built: ${scriptPath}`));
    console.log(info(`Run: npm run build`));
    return false;
  }

  const nodePath = "/usr/bin/node";
  if (!existsSync(nodePath)) {
    console.log(err(`Node.js not found at ${nodePath}`));
    return false;
  }

  // Split secrets from non-secret environment variables
  const allEnv = resolveEnvironment();
  const { secrets, nonSecrets } = splitSecrets(allEnv);

  // Write secrets to protected EnvironmentFile
  let envFilePath: string | undefined;
  if (Object.keys(secrets).length > 0) {
    envFilePath = join(resolveDataDir(), ".service.env");
    const envContent = Object.entries(secrets)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const tmpEnvPath = `${envFilePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
    writeFileSync(tmpEnvPath, envContent, { mode: 0o600 });
    renameSync(tmpEnvPath, envFilePath);
    console.log(info(`Secrets written to ${envFilePath} (0o600)`));
  }

  // Build unit file
  const unitContent = buildUnitFile({
    description: "Operant Multi-Agent Orchestrator",
    nodePath,
    scriptPath,
    workingDirectory: appDir,
    environmentFile: envFilePath,
    nonSecretEnv: nonSecrets,
  });

  // Backup existing unit
  if (existsSync(unitPath)) {
    try {
      copyFileSync(unitPath, `${unitPath}.bak`);
      console.log(info(`Previous unit backed up to ${unitPath}.bak`));
    } catch { /* ignore */ }
  }

  // Write unit file
  const tmpUnitPath = `${unitPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  writeFileSync(tmpUnitPath, unitContent, "utf-8");
  renameSync(tmpUnitPath, unitPath);
  chmodSync(unitPath, 0o644);

  // Activate: daemon-reload + enable + start
  const reload = systemctlSafe(["daemon-reload"]);
  if (reload.code !== 0) {
    console.log(err(`systemctl daemon-reload failed: ${reload.stderr || reload.stdout}`.trim()));
    return false;
  }

  const enable = systemctlSafe(["enable", UNIT_NAME]);
  if (enable.code !== 0) {
    console.log(err(`systemctl enable failed: ${enable.stderr || enable.stdout}`.trim()));
    return false;
  }

  const start = systemctlSafe(["start", UNIT_NAME]);
  if (start.code !== 0) {
    console.log(err(`systemctl start failed: ${start.stderr || start.stdout}`.trim()));
    return false;
  }

  try {
    const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;
    const username = process.env.SUDO_USER || process.env.USER || userInfo().username;
    if (!USERNAME_REGEX.test(username)) { throw new Error("Invalid username"); }
    const lingerCheck = spawnSync("loginctl", ["show-user", username, "-p", "Linger"], { encoding: "utf-8" });
    const lingerOutput = (lingerCheck.stdout || "").trim();
    if (!lingerOutput.includes("yes")) {
      spawnSync("loginctl", ["enable-linger", username], { encoding: "utf-8" });
      console.log(info(`Systemd linger enabled for ${username}`));
    }
  } catch { /* ignore — non-critical */ }

  if (json) {
    console.log(JSON.stringify({ ok: true, result: "installed", unitPath }));
  } else {
    console.log(ok(`Service installed at ${unitPath}`));
    console.log(ok("Service enabled and started"));

    // Quick health check
    const healthCheckTimer = setTimeout(() => {
      const status = systemctlSafe(["is-active", UNIT_NAME]);
      if (status.code === 0) {
        console.log(ok("Service is running"));
      } else {
        console.log(warn("Service started but may still be initializing"));
        console.log(info(`Check: systemctl --user status ${UNIT_NAME}`));
      }
    }, 2000);
    if (healthCheckTimer && typeof healthCheckTimer.unref === "function") healthCheckTimer.unref();
  }

  return true;
}

export async function runDaemonUninstall(args: string[]): Promise<boolean> {
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true;
  }

  const unitPath = resolveUnitPath();

  // Disable + stop
  systemctlSafe(["disable", "--now", UNIT_NAME]);

  // Remove unit file
  if (existsSync(unitPath)) {
    unlinkSync(unitPath);
    if (!json) console.log(ok(`Removed systemd unit: ${unitPath}`));
  } else {
    if (!json) console.log(info(`Unit file not found: ${unitPath}`));
  }

  systemctlSafe(["daemon-reload"]);

  if (json) {
    console.log(JSON.stringify({ ok: true, result: "uninstalled" }));
  } else {
    console.log(ok("Service uninstalled"));
  }

  return true;
}

export async function runDaemonStart(): Promise<boolean> {
  const res = systemctlSafe(["start", UNIT_NAME]);
  if (res.code === 0) {
    console.log(ok("Service started"));
    return true;
  }
  console.log(err(`Failed to start: ${res.stderr || res.stdout}`.trim()));
  return false;
}

export async function runDaemonStop(): Promise<boolean> {
  const res = systemctlSafe(["stop", UNIT_NAME]);
  if (res.code === 0) {
    console.log(ok("Service stopped"));
    return true;
  }
  console.log(err(`Failed to stop: ${res.stderr || res.stdout}`.trim()));
  return false;
}

export async function runDaemonRestart(): Promise<boolean> {
  const res = systemctlSafe(["restart", UNIT_NAME]);
  if (res.code === 0) {
    console.log(ok("Service restarted"));
    return true;
  }
  console.log(err(`Failed to restart: ${res.stderr || res.stdout}`.trim()));
  return false;
}

export async function runDaemonStatus(args: string[]): Promise<boolean> {
  let json = false;
  let deep = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true;
    if (args[i] === "--deep") deep = true;
  }

  const unitPath = resolveUnitPath();
  const unitExists = existsSync(unitPath);

  const isActive = systemctlSafe(["is-active", UNIT_NAME]).code === 0;
  const isEnabled = systemctlSafe(["is-enabled", UNIT_NAME]).code === 0;

  const status: Record<string, unknown> = {
    unitPath,
    unitExists,
    active: isActive,
    enabled: isEnabled,
  };

  if (deep || json) {
    try {
      const show = systemctlSafe(["show", UNIT_NAME, "--property", "ActiveState,SubState,MainPID,ExecMainStatus,ActiveEnterTimestamp"]);
      const props: Record<string, string> = {};
      for (const line of show.stdout.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) props[line.slice(0, eq)] = line.slice(eq + 1);
      }
      status.activeState = props.ActiveState;
      status.subState = props.SubState;
      status.mainPid = props.MainPID !== "" ? parseInt(props.MainPID) : undefined;
      status.exitStatus = props.ExecMainStatus !== "" ? parseInt(props.ExecMainStatus) : undefined;
      status.activeEnterTimestamp = props.ActiveEnterTimestamp;
    } catch { /* ignore */ }
  }

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return true;
  }

  console.log(``);
  console.log(`${BOLD}${CYAN}── Operant Service ──${RESET}`);
  console.log(`  ${label("Unit file", unitExists ? unitPath : "not installed")}`);
  console.log(`  ${label("Status", isActive ? GREEN + "active" + RESET : YELLOW + "inactive" + RESET)}`);
  console.log(`  ${label("Enabled", isEnabled ? GREEN + "yes" + RESET : YELLOW + "no" + RESET)}`);

  if (deep) {
    if (status.activeState) console.log(`  ${label("Active state", String(status.activeState))}`);
    if (status.subState) console.log(`  ${label("Sub-state", String(status.subState))}`);
    if (status.mainPid) console.log(`  ${label("PID", String(status.mainPid))}`);
    if (status.activeEnterTimestamp) console.log(`  ${label("Started at", String(status.activeEnterTimestamp))}`);

    // Quick log tail
    if (isActive) {
      try {
        const result = spawnSync("systemctl", ["--user", "status", UNIT_NAME, "--no-pager", "-n", "5"], { encoding: "utf-8" });
        const log = (result.stdout || "");
        if (log.trim()) {
          console.log(`\n${DIM}── Recent activity ──${RESET}`);
          console.log(log.trim().split("\n").map(l => `  ${DIM}${l}${RESET}`).join("\n"));
        }
      } catch { /* ignore */ }
    }
  }

  if (!unitExists && !isActive) {
    console.log(`\n${YELLOW}Service not installed. Run: operant daemon install${RESET}`);
  }

  console.log(``);
  return true;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function runDaemon(args: string[]): Promise<boolean> {
  const subcommand = args[0] || "status";
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "install":
      return runDaemonInstall(subArgs);
    case "uninstall":
      return runDaemonUninstall(subArgs);
    case "start":
      return runDaemonStart();
    case "stop":
      return runDaemonStop();
    case "restart":
      return runDaemonRestart();
    case "status":
      return runDaemonStatus(subArgs);
    default:
      console.log(`${RED}Unknown daemon command: ${subcommand}${RESET}`);
      console.log(`\n${BOLD}Usage:${RESET} operant daemon {install|start|stop|restart|status|uninstall} [options]`);
      console.log(`\n${BOLD}Options:${RESET}`);
      console.log(`  --force    Force reinstall (for install)`);
      console.log(`  --json     Output as JSON`);
      console.log(`  --deep     Include detailed status info (for status)`);
      return false;
  }
}
