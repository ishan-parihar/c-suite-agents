#!/usr/bin/env node
//
// Operant CLI — Unified command dispatcher
// Usage: operant <command> [options]
//
// Commands:
//   onboard   Run the setup wizard (first-time configuration)
//   doctor    Run diagnostic checks and repairs
//   status    Show system status and health
//   reset     Reset configuration (with scope control)
//   migrate   Apply config migrations for version upgrades
//   help      Show help information
//   version   Show version
//
// The CLI dispatches to the appropriate module without booting
// the full agent system. This keeps commands fast and lightweight.
//

import { runSetupWizard } from "./setup-wizard";
import { runDoctor } from "./doctor";
import { runFinalize } from "./setup.finalize";
import { handleReset, detectExistingConfig, randomToken } from "./onboard-helpers";
import { runMigrations, hasLegacyKeys, checkVersionUpgrade, stampConfigVersion, LEGACY_KEYS } from "./migrations";
import { runConfigureWizard } from "./configure.wizard";
import { runMcpCommand } from "./mcp";
import { runDaemon } from "./daemon";
import { loadConfig, getConfigPath } from "../config/loader";
import { readFileSync, existsSync, chmodSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, "../../package.json");
    if (existsSync(pkgPath)) {
      const stat = statSync(pkgPath);
      if (stat.size > 100 * 1024) {
        console.warn(`[operant] WARN: package.json too large (${stat.size} bytes), skipping`);
      } else {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return pkg.version;
      }
    }
  } catch { /* ignore */ }
  try {
    const pkgPath = join(process.cwd(), "package.json");
    if (existsSync(pkgPath)) {
      const stat = statSync(pkgPath);
      if (stat.size > 100 * 1024) {
        console.warn(`[operant] WARN: package.json too large (${stat.size} bytes), skipping`);
      } else {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return pkg.version;
      }
    }
  } catch { /* ignore */ }
  return "0.0.0";
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
const MAGENTA = "\x1b[35m";

function heading(text: string): string {
  return `${BOLD}${CYAN}═${"═".repeat(60)}═${RESET}\n${BOLD}${CYAN}  ${text}${RESET}\n${BOLD}${CYAN}═${"═".repeat(60)}═${RESET}`;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function showHelp(): void {
  console.log(`
${heading("  Operant CLI")}

${BOLD}USAGE:${RESET}
  operant <command> [options]

${BOLD}COMMANDS:${RESET}
  ${BOLD}onboard${RESET}       Run the interactive setup wizard
                  ${DIM}Configure LLM, Telegram, agent offices, and paths${RESET}

  ${BOLD}doctor${RESET}         Run diagnostic checks and optional repairs
                  ${DIM}15 health checks: config, LLM, paths, services, databases${RESET}

  ${BOLD}status${RESET}         Show system status and health
                  ${DIM}Config summary, service state, agent offices, database sizes${RESET}

  ${BOLD}reset${RESET}          Reset configuration with scope control
                  ${DIM}Scopes: config, config+creds, full${RESET}

  ${BOLD}migrate${RESET}        Apply config migrations for version upgrades
                  ${DIM}Migrates legacy keys, stamps version metadata${RESET}

  ${BOLD}configure${RESET}     Interactive configuration editor
                  ${DIM}Section-based: LLM, context, agents, Telegram, paths, MCP, embedding, logging${RESET}

  ${BOLD}mcp${RESET}           Manage MCP servers
                  ${DIM}Subcommands: list, add, remove, enable, disable, status${RESET}

  ${BOLD}daemon${RESET}         Manage systemd service
                  ${DIM}Subcommands: install, start, stop, restart, status, uninstall${RESET}

  ${BOLD}help${RESET}           Show this help message

  ${BOLD}version${RESET}        Show Operant version

${BOLD}ONBOARD OPTIONS:${RESET}
  --mode, -m        Setup mode: quickstart | advanced (default: quickstart)
  --non-interactive Non-interactive mode (uses defaults)

${BOLD}DOCTOR OPTIONS:${RESET}
  --yes, -y         Auto-accept all suggested fixes
  --repair          Apply repairs without prompts

${BOLD}STATUS OPTIONS:${RESET}
  --json            Output as JSON (for scripting)
  --deep            Include deep health checks

${BOLD}RESET OPTIONS:${RESET}
  --scope, -s       Reset scope: config | config+creds | full (default: config)
  --yes, -y         Skip confirmation prompt

${BOLD}GLOBAL OPTIONS:${RESET}
  --config, -c      Path to config file (default: ~/.operant/config.json)
  --verbose, -v     Enable verbose output
  --help, -h        Show this help message
  --version, -V     Show version

${BOLD}EXAMPLES:${RESET}
  ${DIM}# First-time setup${RESET}
  operant onboard

  ${DIM}# Advanced setup with custom mode${RESET}
  operant onboard --mode advanced

  ${DIM}# Run diagnostic checks${RESET}
  operant doctor

  ${DIM}# Run diagnostics with auto-repair${RESET}
  operant doctor --yes --repair

  ${DIM}# Check system status${RESET}
  operant status

  ${DIM}# Status as JSON (for monitoring)${RESET}
  operant status --json

  ${DIM}# Reset config only${RESET}
  operant reset --scope config

  ${DIM}# Full reset (config + credentials + workspace)${RESET}
  operant reset --scope full

  ${DIM}# Apply config migrations${RESET}
  operant migrate

  ${DIM}# Configure LLM settings interactively${RESET}
  operant configure

  ${DIM}# Configure a specific section${RESET}
  operant configure --section mcp

  ${DIM}# List MCP servers${RESET}
  operant mcp list

  ${DIM}# Add an MCP server${RESET}
  operant mcp add

${BOLD}CONFIGURATION:${RESET}
  Config file:  ${DIM}~/.operant/config.json${RESET}
  Agent offices: ${DIM}~/.operant/agents/${RESET}
  Data:         ${DIM}~/.local/share/operant/${RESET}
  Logs:         ${DIM}~/.local/log/operant/${RESET}

${BOLD}TELEGRAM COMMANDS:${RESET}
  /start          Welcome message
  /org            Organization chart
  /staff          Core staff list
  /agents         All agents
  /wake [agent]   Agent wake context
  /messages       Browse messages
  /recall [query] Search memory
  /status         System status
  /help           Help

`);
}

// ---------------------------------------------------------------------------
// Status command
// ---------------------------------------------------------------------------

async function showStatus(options: { json?: boolean; deep?: boolean }): Promise<void> {
  const status: Record<string, unknown> = {
    version: getVersion(),
    configPath: getConfigPath(),
    configLoaded: false,
    config: null as Record<string, unknown> | null,
    service: { active: false, error: null as string | null },
    agentOffices: { exists: false, count: 0, offices: [] as string[] },
    databases: {} as Record<string, { exists: boolean; sizeKB?: number }>,
  };

  try {
    const config = loadConfig();
    status.configLoaded = true;
    status.config = {
      provider: config.llm?.provider,
      model: config.llm?.model,
      contextTokens: config.llm?.contextTokens,
      telegramConfigured: !!config.telegram?.botToken,
      agentOfficesPath: config.paths?.agentOffices,
    };

    const officesPath = config.paths?.agentOffices;
    if (officesPath && existsSync(officesPath)) {
      const { readdirSync, statSync } = await import("node:fs");
      const offices = readdirSync(officesPath).filter(d => statSync(join(officesPath, d)).isDirectory());
      status.agentOffices = { exists: true, count: offices.length, offices };
    }

    if (config.paths) {
      const { statSync } = await import("node:fs");
      const dbPaths: Record<string, string> = {
        kanbanDb: config.paths.kanbanDb,
        messagesDb: config.paths.messagesDb,
        lancedb: config.paths.lancedb,
      };
      for (const [name, dbPath] of Object.entries(dbPaths)) {
        if (dbPath && existsSync(dbPath)) {
          const size = statSync(dbPath).size;
          (status.databases as Record<string, { exists: boolean; sizeKB?: number }>)[name] = { exists: true, sizeKB: Math.round(size / 1024) };
        } else {
          (status.databases as Record<string, { exists: boolean; sizeKB?: number }>)[name] = { exists: false };
        }
      }
    }
  } catch (err: unknown) {
    status.config = { error: (err as Error).message };
  }

  try {
    const { spawnSync } = await import("node:child_process");
    const systemResult = spawnSync("systemctl", ["is-active", "operant"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const userResult = spawnSync("systemctl", ["--user", "is-active", "operant"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const systemActive = systemResult.status === 0 && systemResult.stdout?.trim() === "active";
    const userActive = userResult.status === 0 && userResult.stdout?.trim() === "active";
    (status.service as { active: boolean; error: string | null }).active = systemActive || userActive;
  } catch {
    // not systemd
  }

  if (options.deep) {
    try {
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("systemctl", ["show", "operant", "-p", "ActiveEnterTimestamp", "--value"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      const uptime = (result.status === 0 && result.stdout?.trim()) || "unknown";
      (status.service as { active: boolean; error: string | null; uptime?: string }).uptime = uptime;
    } catch { /* ignore */ }
  }

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(``);
  console.log(heading("  Operant Status"));
  console.log(``);
  console.log(`  ${BOLD}Version:${RESET}       ${getVersion()}`);
  console.log(`  ${BOLD}Config:${RESET}        ${getConfigPath()}`);
  console.log(`  ${BOLD}Config loaded:${RESET}  ${status.configLoaded ? GREEN + "yes" + RESET : RED + "no" + RESET}`);

  if (status.configLoaded && status.config && typeof status.config === "object" && !("error" in status.config)) {
    const cfg = status.config as Record<string, unknown>;
    console.log(`\n  ${BOLD}${CYAN}── LLM ──${RESET}`);
    console.log(`    Provider:     ${cfg.provider || "not set"}`);
    console.log(`    Model:        ${cfg.model || "not set"}`);
    console.log(`    Context:      ${cfg.contextTokens ? Number(cfg.contextTokens).toLocaleString() + " tokens" : "not set"}`);
    console.log(`    Telegram:     ${(cfg.telegramConfigured as boolean) ? GREEN + "configured" + RESET : YELLOW + "not configured" + RESET}`);

    console.log(`\n  ${BOLD}${CYAN}── Service ──${RESET}`);
    const svc = status.service as { active: boolean };
    console.log(`    Status:       ${svc.active ? GREEN + "active" + RESET : YELLOW + "inactive" + RESET}`);

    const ao = status.agentOffices as { exists: boolean; count: number; offices: string[] };
    console.log(`\n  ${BOLD}${CYAN}── Agent Offices ──${RESET}`);
    console.log(`    Path:         ${ao.exists ? GREEN + ao.count + " offices" + RESET : RED + "missing" + RESET}`);
    if (ao.offices.length > 0) {
      console.log(`    Offices:      ${ao.offices.join(", ")}`);
    }

    const dbs = status.databases as Record<string, { exists: boolean; sizeKB?: number }>;
    console.log(`\n  ${BOLD}${CYAN}── Databases ──${RESET}`);
    for (const [name, db] of Object.entries(dbs)) {
      console.log(`    ${name}:  ${db.exists ? GREEN + "exists" + (db.sizeKB ? ` (${db.sizeKB} KB)` : "") : YELLOW + "missing" + RESET}`);
    }
  }

  console.log(``);
}

// ---------------------------------------------------------------------------
// Reset command
// ---------------------------------------------------------------------------

async function runReset(args: string[]): Promise<boolean> {
  let scope: "config" | "config+creds" | "full" = "config";
  let skipConfirm = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scope" || args[i] === "-s") {
      const s = args[++i];
      if (s === "config" || s === "config+creds" || s === "full") {
        scope = s;
      } else {
        console.log(`${RED}Invalid scope: ${s}. Use: config, config+creds, full${RESET}`);
        return false;
      }
    }
    if (args[i] === "--yes" || args[i] === "-y") {
      skipConfirm = true;
    }
  }

  const configPath = getConfigPath();
  const result = detectExistingConfig(configPath);

  if (!result.exists) {
    console.log(`${YELLOW}No configuration found at ${configPath}${RESET}`);
    return true;
  }

  console.log(`${RED}${BOLD}⚠ Reset Scope: ${scope}${RESET}`);

  if (scope === "config") {
    console.log(`  Will remove: config.json`);
  } else if (scope === "config+creds") {
    console.log(`  Will remove: config.json, .env files, credential files`);
  } else {
    console.log(`  Will remove: config.json, .env files, credentials, workspace, agent offices, data directories`);
  }

  if (!skipConfirm) {
    console.log(`\n${RED}This action cannot be undone.${RESET}`);
    const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(resolve => rl.question(`${BOLD}${YELLOW}?${RESET} ${BOLD}Type "reset" to confirm:${RESET} `, resolve));
    rl.close();
    if (answer.trim() !== "reset") {
      console.log(`${YELLOW}Reset cancelled.${RESET}`);
      return true;
    }
  }

  const ok = await handleReset(scope, dirname(configPath));
  if (ok) {
    console.log(`\n${GREEN}${BOLD}✓ Reset complete.${RESET}`);
    console.log(`${YELLOW}Run 'operant onboard' to reconfigure.${RESET}`);
  } else {
    console.log(`${YELLOW}Reset cancelled or partially completed.${RESET}`);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Migrate command
// ---------------------------------------------------------------------------

async function runMigrate(): Promise<boolean> {
  const configPath = getConfigPath();
  const result = detectExistingConfig(configPath);

  if (!result.exists) {
    console.log(`${YELLOW}No configuration found. Nothing to migrate.${RESET}`);
    return true;
  }

  if (result.config === null && "error" in result) {
    console.log(`${RED}Config file is invalid JSON:${RESET} ${(result as { error: string }).error}`);
    console.log(`${YELLOW}Run 'operant onboard' to regenerate.${RESET}`);
    return false;
  }

  const raw = result.config!;
  const version = getVersion();

  // Check version
  const upgradeCheck = checkVersionUpgrade(version, raw._version as string | undefined);
  if (!upgradeCheck.needsUpgrade && !hasLegacyKeys(raw).found) {
    console.log(`${GREEN}✓ Config is up to date (v${version}). No migrations needed.${RESET}`);
    return true;
  }

  console.log(``);
  console.log(heading("  Config Migration"));
  console.log(`\n  Current version:  v${version}`);
  console.log(`  Config version:   ${raw._version || "none"}`);
  console.log(``);

  // Check legacy keys
  const legacyCheck = hasLegacyKeys(raw);
  if (legacyCheck.found) {
    console.log(`${YELLOW}Legacy keys found: ${legacyCheck.keys.join(", ")}${RESET}`);
  }

  if (upgradeCheck.needsUpgrade) {
    console.log(`${YELLOW}Upgrade needed: ${upgradeCheck.message}${RESET}`);
  }

  // Run migrations
  const migrated = runMigrations(raw);
  stampConfigVersion(migrated.config, version);

  if (migrated.warnings.length > 0) {
    console.log(`\n${YELLOW}Migration warnings:${RESET}`);
    for (const w of migrated.warnings) {
      console.log(`  - ${w}`);
    }
  }

  // Write back
  const { writeFileSync, renameSync } = await import("node:fs");
  const crypto = await import("node:crypto");
  const tmpConfigPath = `${configPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  writeFileSync(tmpConfigPath, JSON.stringify(migrated.config, null, 2), "utf-8");
  renameSync(tmpConfigPath, configPath);
  chmodSync(configPath, 0o600);

  console.log(`\n${GREEN}✓ Migration complete. Config written to ${configPath}${RESET}`);
  return true;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CLIOptions {
  command: string;
  args: string[];
  mode?: string;
  nonInteractive?: boolean;
  yes?: boolean;
  repair?: boolean;
  json?: boolean;
  deep?: boolean;
  scope?: string;
  section?: string;
  config?: string;
  verbose?: boolean;
}

function parseArgs(argv: string[]): CLIOptions {
  const opts: CLIOptions = {
    command: "help",
    args: [],
  };

  let i = 0;
  // First non-flag argument is the command
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--") || arg.startsWith("-")) {
      switch (arg) {
        case "--mode":
        case "-m":
          opts.mode = argv[++i];
          break;
        case "--non-interactive":
          opts.nonInteractive = true;
          break;
        case "--yes":
        case "-y":
          opts.yes = true;
          break;
        case "--repair":
          opts.repair = true;
          break;
        case "--json":
          opts.json = true;
          break;
        case "--deep":
          opts.deep = true;
          break;
        case "--scope":
        case "-s":
          opts.scope = argv[++i];
          break;
        case "--section":
          opts.section = argv[++i];
          break;
        case "--config":
        case "-c":
          opts.config = argv[++i];
          break;
        case "--verbose":
        case "-v":
          opts.verbose = true;
          break;
        case "--help":
        case "-h":
          opts.command = "help";
          return opts;
        case "--version":
        case "-V":
          opts.command = "version";
          return opts;
      }
    } else if (!opts.command || opts.command === "help") {
      opts.command = arg;
    } else {
      opts.args.push(arg);
    }
    i++;
  }

  if (!opts.command || opts.command === "help") {
    opts.command = "help";
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  switch (opts.command) {
    case "onboard":
    case "setup":
    case "wizard": {
      console.log(`${BOLD}${CYAN}Operant Setup Wizard${RESET}\n`);
      const ok = await runSetupWizard();

      // After wizard completes, offer finalize
      if (ok) {
        console.log(`\n${BOLD}${CYAN}── Finalizing Setup ──${RESET}\n`);
        try {
          const config = loadConfig();
          await runFinalize(config, { runDoctor: true });
        } catch (err: unknown) {
          console.log(`${YELLOW}Finalize step skipped: ${(err as Error).message}${RESET}`);
        }
      }

      process.exit(ok ? 0 : 1);
      break;
    }

    case "doctor":
    case "check":
    case "health": {
      const ok = await runDoctor();
      process.exit(ok ? 0 : 1);
      break;
    }

    case "status":
    case "show": {
      await showStatus({ json: opts.json, deep: opts.deep });
      process.exit(0);
      break;
    }

    case "reset": {
      const args: string[] = [];
      if (opts.scope) args.push("--scope", opts.scope);
      if (opts.yes) args.push("--yes");
      const ok = await runReset(args);
      process.exit(ok ? 0 : 1);
      break;
    }

    case "migrate": {
      const ok = await runMigrate();
      process.exit(ok ? 0 : 1);
      break;
    }

    case "configure":
    case "config":
    case "cfg": {
      console.log(`${BOLD}${CYAN}Operant Configuration${RESET}\n`);
      const section = opts.section;
      const ok = await runConfigureWizard({ section: section as string | undefined });
      process.exit(ok ? 0 : 1);
      break;
    }

    case "mcp": {
      const mcpCommand = opts.args[0] || "list";
      const mcpArgs = opts.args.slice(1);
      const ok = await runMcpCommand(mcpCommand, mcpArgs);
      process.exit(ok ? 0 : 1);
      break;
    }

    case "daemon": {
      const ok = await runDaemon(opts.args);
      process.exit(ok ? 0 : 1);
      break;
    }

    case "version":
    case "-V":
    case "--version":
      console.log(`operant v${getVersion()}`);
      process.exit(0);
      break;

    case "help":
    case "-h":
    case "--help":
    default:
      showHelp();
      process.exit(0);
      break;
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
