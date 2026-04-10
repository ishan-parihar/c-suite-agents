import { homedir, userInfo } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { ensureWorkspaceDirs } from "./onboard-helpers.js";

// ---------------------------------------------------------------------------
// ANSI Color Helpers (matching doctor.ts / setup-wizard.ts patterns)
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

function heading(text: string): string {
  return `${BOLD}${CYAN}\u2550${"\u2550".repeat(52)}\u2550${RESET}\n${BOLD}${CYAN}  ${text}${RESET}\n${BOLD}${CYAN}\u2550${"\u2550".repeat(52)}\u2550${RESET}`;
}

function success(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

function warn(text: string): string {
  return `${YELLOW}${text}${RESET}`;
}

function error(text: string): string {
  return `${RED}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEMD_USER_DIR = join(homedir(), ".config", "systemd", "user");
const SYSTEMD_SERVICE_NAME = "operant.service";
const SYSTEMD_SERVICE_PATH = join(SYSTEMD_USER_DIR, SYSTEMD_SERVICE_NAME);

const SYSTEMD_SERVICE_CONTENT = `[Unit]
Description=Operant Multi-Agent System
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/operant/build/index.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/operant/.env
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
`;

// ---------------------------------------------------------------------------
// 1. Systemd Service Installation
// ---------------------------------------------------------------------------

/**
 * Creates and installs the systemd user service file.
 * Returns true on success, false on any failure.
 */
export async function installSystemdService(config: Record<string, unknown>): Promise<boolean> {
  console.log(`\n${BOLD}${CYAN}── Installing Systemd User Service ──${RESET}`);

  try {
    const checkResult = spawnSync("systemctl", ["--user", "is-system-running"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    if (checkResult.error || checkResult.status === null) {
      throw new Error("systemd not available");
    }
  } catch {
    console.log(`  ${warn("⚠ systemd user session not available — skipping service installation")}`);
    console.log(`  ${DIM}You can still run Operant manually: node /opt/operant/build/index.js${RESET}`);
    return false;
  }

  try {
    if (!existsSync(SYSTEMD_USER_DIR)) {
      mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
      console.log(`  ${success(`Created directory: ${SYSTEMD_USER_DIR}`)}`);
    }

    writeFileSync(SYSTEMD_SERVICE_PATH, SYSTEMD_SERVICE_CONTENT, "utf-8");
    console.log(`  ${success(`Service file written: ${SYSTEMD_SERVICE_PATH}`)}`);

    spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    console.log(`  ${success("Systemd daemon reloaded")}`);

    spawnSync("systemctl", ["--user", "enable", "operant"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    console.log(`  ${success("Service enabled (will start on login)")}`);

    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${error(`Failed to install systemd service: ${message}`)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Systemd Linger
// ---------------------------------------------------------------------------

/**
 * Enables systemd user session lingering so services survive logout.
 * Returns true on success, false if not possible (with warning).
 */
export async function enableLinger(): Promise<boolean> {
  console.log(`\n${BOLD}${CYAN}── Configuring Systemd Linger ──${RESET}`);

  try {
    const lingerResult = spawnSync(
      "loginctl",
      ["show-user", userInfo().username, "-p", "Linger"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const lingerStatus = lingerResult.stdout?.trim() || "Linger=no";

    if (lingerStatus === "Linger=yes") {
      console.log(`  ${success("Systemd linger already enabled")}`);
      return true;
    }

    try {
      spawnSync("sudo", ["loginctl", "enable-linger", userInfo().username], {
        encoding: "utf-8",
        stdio: "inherit",
      });
      console.log(`  ${success("Systemd linger enabled (services survive logout)")}`);
      return true;
    } catch {
      spawnSync("loginctl", ["enable-linger", userInfo().username], {
        encoding: "utf-8",
        stdio: "inherit",
      });
      console.log(`  ${success("Systemd linger enabled")}`);
      return true;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${warn("⚠ Could not enable systemd linger")}`);
    console.log(`  ${DIM}Services will stop when you log out.${RESET}`);
    console.log(`  ${DIM}Fix manually: sudo loginctl enable-linger ${userInfo().username}${RESET}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 3. Service Start/Restart
// ---------------------------------------------------------------------------

/**
 * Starts or restarts the systemd user service.
 * Checks if already running first to avoid unnecessary restarts.
 */
async function startService(): Promise<boolean> {
  try {
    const statusResult = spawnSync(
      "systemctl",
      ["--user", "is-active", "operant"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const status = statusResult.status === 0 && statusResult.stdout?.trim() === "active" ? "active" : "inactive";

    if (status === "active") {
      console.log(`  ${success("Service already running — restarting to apply changes")}`);
      spawnSync("systemctl", ["--user", "restart", "operant"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    } else {
      console.log(`  ${success("Starting service...")}`);
      spawnSync("systemctl", ["--user", "start", "operant"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    }

    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${warn(`Could not start service: ${message}`)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. Health Check
// ---------------------------------------------------------------------------

interface HealthResult {
  running: boolean;
  bootMessage: boolean;
  errors: string[];
}

/**
 * Checks if the service is healthy.
 * Checks both system-wide and user-level systemd services.
 * Checks log file for boot message.
 */
export async function healthCheck(
  logFile?: string,
  timeoutMs: number = 15_000,
): Promise<HealthResult> {
  const errors: string[] = [];
  let running = false;
  let bootMessage = false;

  console.log(`\n${BOLD}${CYAN}── Health Check ──${RESET}`);

  let systemActive = false;
  let userActive = false;

  try {
    const systemResult = spawnSync(
      "systemctl",
      ["is-active", "operant"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    systemActive = systemResult.status === 0 && systemResult.stdout?.trim() === "active";
  } catch {
    // systemctl not available
  }

  try {
    const userResult = spawnSync(
      "systemctl",
      ["--user", "is-active", "operant"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    userActive = userResult.status === 0 && userResult.stdout?.trim() === "active";
  } catch {
    // systemctl not available
  }

  running = systemActive || userActive;

  if (running) {
    const sources: string[] = [];
    if (systemActive) sources.push("system");
    if (userActive) sources.push("user");
    console.log(`  ${success(`Service running (${sources.join(", ")})`)}`);
  } else {
    errors.push("Service is not running");
    console.log(`  ${error("Service is not running")}`);
  }

  if (logFile && existsSync(logFile)) {
    try {
      const logStat = statSync(logFile);
      if (logStat.size > 100 * 1024) {
        console.log(`${YELLOW}⚠ Setup log file too large (${(logStat.size / 1024).toFixed(1)}KB), skipping${RESET}`);
      } else {
        const content = readFileSync(logFile, "utf-8");
        const lines = content.split("\n").filter(Boolean);
        const lastLines = lines.slice(-20);
        bootMessage = lastLines.some(
          (line) =>
            line.toLowerCase().includes("boot") ||
            line.toLowerCase().includes("started") ||
            line.toLowerCase().includes("initialized") ||
            line.toLowerCase().includes("operant"),
        );

        if (bootMessage) {
          console.log(`  ${success("Boot message found in log")}`);
        } else {
          errors.push("No boot message in log (service may not have fully started)");
          console.log(`  ${warn("No boot message found in recent log entries")}`);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Could not read log file: ${message}`);
      console.log(`  ${warn(`Could not read log: ${message}`)}`);
    }
  } else if (logFile) {
    errors.push(`Log file not found: ${logFile}`);
    console.log(`  ${warn(`Log file not yet created: ${logFile}`)}`);
  } else {
    console.log(`  ${DIM}No log file configured — skipping log check${RESET}`);
  }

  if (!running && timeoutMs > 0) {
    console.log(`  ${DIM}Waiting up to ${timeoutMs}ms for service to start...${RESET}`);
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollInterval));

      try {
        const userResult = spawnSync(
          "systemctl",
          ["--user", "is-active", "operant"],
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        );
        if (userResult.status === 0 && userResult.stdout?.trim() === "active") {
          running = true;
          console.log(`  ${success("Service started after waiting")}`);
          break;
        }
      } catch {
      }
    }

    if (!running) {
      errors.push(`Service did not start within ${timeoutMs}ms`);
      console.log(`  ${error(`Service did not start within timeout`)}`);
    }
  }

  return { running, bootMessage, errors };
}

// ---------------------------------------------------------------------------
// 5. Summary Display
// ---------------------------------------------------------------------------

/**
 * Displays the final configuration summary.
 */
export function printSummary(config: Record<string, unknown>): void {
  console.log("");
  console.log(heading("  Operant Setup Complete!"));
  console.log("");

  const llm = config.llm as Record<string, unknown> | undefined;
  if (llm) {
    const provider = (llm.provider as string) ?? "unknown";
    const model = (llm.model as string) ?? "unknown";
    const context = llm.contextTokens
      ? Number(llm.contextTokens).toLocaleString()
      : "unknown";
    const maxTokens = llm.maxTokens
      ? Number(llm.maxTokens).toLocaleString()
      : "unknown";

    console.log(`  ${BOLD}Configuration:${RESET}`);
    console.log(`    LLM Provider:  ${success(`${provider}/${model}`)}`);
    console.log(`    Context:       ${context} tokens`);
    console.log(`    Max Output:    ${maxTokens} tokens`);
  }

  const telegram = config.telegram as Record<string, unknown> | undefined;
  if (telegram?.botToken && typeof telegram.botToken === "string") {
    const masked = telegram.botToken.slice(0, 6) + "***";
    console.log(`\n  ${BOLD}Telegram:${RESET}        ${success(`Configured (${masked})`)}`);
  } else {
    console.log(`\n  ${BOLD}Telegram:${RESET}        ${warn("Not configured")}`);
  }

  const paths = config.paths as Record<string, string> | undefined;
  if (paths?.agentOffices && existsSync(paths.agentOffices)) {
    try {
      const offices = readdirSync(paths.agentOffices).filter((d: string) =>
        statSync(join(paths.agentOffices, d)).isDirectory(),
      );
      console.log(`  ${BOLD}Agent Offices:${RESET}   ${success(`${offices.length} offices created`)}`);
    } catch {
      console.log(`  ${BOLD}Agent Offices:${RESET}   ${DIM}path configured${RESET}`);
    }
  }

  if (paths) {
    console.log(`\n  ${BOLD}Data Paths:${RESET}`);
    if (paths.lancedb) {
      console.log(`    LanceDB:       ${DIM}${paths.lancedb}${RESET}`);
    }
    if (paths.kanbanDb) {
      console.log(`    Kanban DB:     ${DIM}${paths.kanbanDb}${RESET}`);
    }
    if (paths.messagesDb) {
      console.log(`    Messages DB:   ${DIM}${paths.messagesDb}${RESET}`);
    }
  }

  console.log("");
  console.log(`  ${BOLD}Next Steps:${RESET}`);
  console.log(`    1. Start service:  ${BOLD}systemctl --user start operant${RESET}`);
  console.log(`    2. Check status:   ${BOLD}systemctl --user status operant${RESET}`);
  console.log(`    3. View logs:      ${BOLD}journalctl --user -u operant -f${RESET}`);
  if (telegram?.botToken) {
    console.log(`    4. Send /start to your bot on Telegram`);
  }
  console.log(`    5. Run ${BOLD}'operant doctor'${RESET} for health checks`);

  console.log("");
  console.log(heading(""));
  console.log("");
}

// ---------------------------------------------------------------------------
// 6. Main Entry Point
// ---------------------------------------------------------------------------

interface FinalizeOptions {
  installService?: boolean;
  runDoctor?: boolean;
  openTui?: boolean;
}

/**
 * Main entry point for post-wizard finalization.
 * Orchestrates: workspace dirs → service install → linger → start → health → doctor → summary.
 * Returns true on success, false on critical failure.
 */
export async function runFinalize(
  config: Record<string, unknown>,
  options?: FinalizeOptions,
): Promise<boolean> {
  const {
    installService = false,
    runDoctor = false,
    openTui = false,
  } = options ?? {};

  let hadCriticalFailure = false;

  console.log(`\n${BOLD}${CYAN}── Setting Up Workspace ──${RESET}`);
  const configPaths = config.paths as
    | { lancedb?: string; kanbanDb?: string; messagesDb?: string; agentOffices?: string; logFile?: string }
    | undefined;
  if (configPaths) {
    ensureWorkspaceDirs(configPaths);
  } else {
    console.log(`  ${warn("No paths configured in config — skipping directory creation")}`);
  }

  if (installService) {
    const serviceOk = await installSystemdService(config);
    if (!serviceOk) {
      console.log(`  ${warn("Service installation failed — continuing without it")}`);
    }

    await enableLinger();
    await startService();
  }

  const logFile = configPaths?.logFile;
  const health = await healthCheck(logFile);

  if (!health.running) {
    hadCriticalFailure = true;
    console.log(`\n  ${error("Service health check failed")}`);
    if (health.errors.length > 0) {
      for (const err of health.errors) {
        console.log(`    ${error("•")} ${err}`);
      }
    }
  } else {
    console.log(`  ${success("Service is healthy")}`);
  }

  if (runDoctor) {
    try {
      const { runDoctor: runDoctorCheck } = await import("./doctor.js");
      console.log(`\n${BOLD}${CYAN}── Running Doctor Check ──${RESET}`);
      const doctorOk = await runDoctorCheck();
      if (!doctorOk) {
        console.log(`\n  ${warn("Doctor found issues — review the report above")}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${warn(`Could not run doctor: ${message}`)}`);
    }
  }

  printSummary(config);

  return !hadCriticalFailure;
}

// ---------------------------------------------------------------------------
// Direct execution support
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadConfig } = await import("../config/loader.js");
  const config = loadConfig();
  const ok = await runFinalize(config, { installService: true, runDoctor: true });
  process.exit(ok ? 0 : 1);
}
