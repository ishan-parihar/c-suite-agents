import fs, { accessSync, constants } from "node:fs";
import path, { join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, getConfigPath } from "../config/loader.js";

// ── Safe executable resolution (no shell injection) ─────────────────────
function findInPath(cmd: string): boolean {
  if (process.platform === "win32" && !cmd.endsWith(".exe")) cmd = `${cmd}.exe`;
  const paths = (process.env.PATH || "").split(delimiter);
  for (const p of paths) {
    try { accessSync(join(p, cmd), constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}

// ── ANSI color codes ────────────────────────────────────────────────────
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ── Check result types ──────────────────────────────────────────────────
type CheckSeverity = "PASS" | "WARN" | "FAIL";

interface CheckResult {
  severity: CheckSeverity;
  description: string;
  detail?: string;
}

// ── Utility helpers ─────────────────────────────────────────────────────
const severityColor = (s: CheckSeverity): string => {
  switch (s) {
    case "PASS":
      return GREEN;
    case "WARN":
      return YELLOW;
    case "FAIL":
      return RED;
  }
};

const badge = (s: CheckSeverity): string =>
  `${severityColor(s)}[${s}]${RESET}`;

const results: CheckResult[] = [];

function check(severity: CheckSeverity, description: string, detail?: string) {
  results.push({ severity, description, detail });
}

// ── Individual checks ───────────────────────────────────────────────────

/**
 * Check 1: Node.js version >= 20
 */
function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) {
    check("PASS", `Node.js version ${process.versions.node} (>= 20 required)`);
  } else {
    check(
      "FAIL",
      `Node.js version ${process.versions.node} (< 20 — upgrade required)`,
    );
  }
}

/**
 * Check 2: Config file exists at ~/.strategos/config.json
 */
function checkConfigFileExists() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    check("PASS", `Config file exists (${configPath})`);
  } else {
    check(
      "FAIL",
      `Config file missing (${configPath})`,
      `Run setup or create with: mkdir -p ${path.dirname(configPath)} && touch ${configPath}`,
    );
  }
}

/**
 * Check 3: Config parses without Zod errors
 */
function checkConfigParses() {
  try {
    const config = loadConfig();
    check("PASS", "Config parses successfully (Zod validation passed)");
    return config;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    check("FAIL", "Config fails Zod validation", message);
    return null;
  }
}

/**
 * Check 4: LLM baseUrl is reachable (HEAD request with 5s timeout)
 */
async function checkLlmBaseUrlReachable(baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    // Try HEAD first, fall back to GET for servers that reject HEAD
    const resp = await fetch(baseUrl, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok || resp.status === 404 || resp.status === 405) {
      // 404/405 still means the server is alive (path not found / method not allowed)
      check("PASS", `LLM baseUrl reachable (${baseUrl}) [HTTP ${resp.status}]`);
    } else {
      check(
        "WARN",
        `LLM baseUrl responded with HTTP ${resp.status} (${baseUrl})`,
      );
    }
  } catch (err: unknown) {
    clearTimeout(timeout);
    // Retry with GET — some servers reject HEAD
    try {
      const getController = new AbortController();
      const getTimeout = setTimeout(() => getController.abort(), 5000);
      const resp = await fetch(baseUrl, {
        method: "GET",
        signal: getController.signal,
      });
      clearTimeout(getTimeout);
      if (resp.ok || resp.status === 404 || resp.status === 405) {
        check(
          "PASS",
          `LLM baseUrl reachable (${baseUrl}) [HTTP ${resp.status}]`,
        );
        return;
      }
    } catch {
      // Fall through to FAIL
    }

    const message = err instanceof Error ? err.message : String(err);
    check(
      "FAIL",
      `LLM baseUrl unreachable (${baseUrl})`,
      [
        message,
        "",
        "Suggested fixes:",
        "  1. Verify baseUrl is correct in ~/.strategos/config.json",
        "  2. Check proxy service is running (e.g., qwen-proxy on port 3000)",
        "  3. Test manually: curl -v " + baseUrl,
        "  4. Check for proxy/firewall blocking the connection",
      ].join("\n"),
    );
  }
}

/**
 * Check 5: LLM responds to minimal chat completion
 */
async function checkLlmMinimalCompletion(baseUrl: string, model: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user" as const, content: "hi" }],
        max_tokens: 1,
      }),
    });
    clearTimeout(timeout);

    if (resp.ok) {
      check("PASS", `LLM chat completion works (model="${model}")`);
    } else {
      const body = await resp.text().catch(() => "");
      // model_not_found is a warning, not a failure — the endpoint works
      if (body.includes("model_not_found") || resp.status === 404) {
        check(
          "WARN",
          `LLM model "${model}" not found — endpoint responds but model may need loading`,
          "Check model name is correct. For qwen-proxy, verify the proxy has the model loaded.",
        );
      } else {
        check(
          "WARN",
          `LLM chat completion returned HTTP ${resp.status}`,
          body.slice(0, 200),
        );
      }
    }
  } catch (err: unknown) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    // Don't double-fail if baseUrl already failed
    check(
      "WARN",
      `LLM chat completion request failed`,
      [
        message,
        "",
        "Suggested fixes:",
        "  1. Ensure model name is valid for your provider",
        "  2. For qwen-proxy: check proxy logs (journalctl -u qwen-proxy)",
        "  3. Test manually: curl -X POST " + baseUrl.replace(/\/+$/, "") + "/chat/completions -d '{\"model\":\"" + model + "\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":1}'",
      ].join("\n"),
    );
  }
}

/**
 * Check 6: All configured paths — directories exist or are creatable
 */
function checkPaths(configPaths: Record<string, string>) {
  const pathEntries = Object.entries(configPaths);
  if (pathEntries.length === 0) {
    check("WARN", "No paths configured in config.paths");
    return;
  }

  for (const [name, dirPath] of pathEntries) {
    const parentDir = path.dirname(dirPath);

    // Check if it's a file path (has extension) or directory
    const isFileLike = path.extname(dirPath).length > 0;
    const targetDir = isFileLike ? parentDir : dirPath;

    if (fs.existsSync(targetDir)) {
      check("PASS", `Path exists: ${name} = ${dirPath}`);
    } else if (fs.existsSync(parentDir)) {
      // Parent exists, so it's creatable
      check(
        "WARN",
        `Path missing but creatable: ${name} = ${dirPath}`,
        `Run: mkdir -p "${dirPath}"`,
      );
    } else if (fs.existsSync(path.dirname(parentDir))) {
      // Grandparent exists
      check(
        "WARN",
        `Path missing but parent creatable: ${name} = ${dirPath}`,
        `Run: mkdir -p "${targetDir}"`,
      );
    } else {
      check(
        "FAIL",
        `Path missing and parent not found: ${name} = ${dirPath}`,
        `Run: mkdir -p "${targetDir}" (may require sudo)`,
      );
    }
  }
}

/**
 * Check 7: Telegram botToken format validation
 */
function checkTelegramToken(botToken?: string) {
  if (!botToken) {
    check("WARN", "Telegram botToken not configured (optional)");
    return;
  }

  // Format: numeric:alphanumeric (e.g., 123456:ABC-DEF...)
  const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
  if (tokenPattern.test(botToken)) {
    const masked =
      botToken.slice(0, 6) + "***" + botToken.slice(-4);
    check("PASS", `Telegram botToken format valid (${masked})`);
  } else {
    check(
      "FAIL",
      "Telegram botToken format invalid (expected: digits:alphanumeric)",
      "Token should look like: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    );
  }
}

/**
 * Check 8: Telegram chatId (if configured)
 */
function checkTelegramChatId(chatId?: string) {
  if (!chatId) {
    check("WARN", "Telegram chatId not configured (optional)");
    return;
  }

  // chatId should be numeric (can be negative for groups)
  const chatIdPattern = /^-?\d+$/;
  if (chatIdPattern.test(chatId)) {
    check("PASS", `Telegram chatId format valid (${chatId})`);
  } else {
    check(
      "WARN",
      `Telegram chatId format unusual (${chatId})`,
      "chatId is typically a numeric value (positive for users, negative for groups/channels)",
    );
  }
}

/**
 * Check 9: Log file parent directory exists
 */
function checkLogFileParent(logFile?: string) {
  if (!logFile) {
    check("WARN", "No log file configured (logging to stdout only)");
    return;
  }

  const parentDir = path.dirname(logFile);
  if (fs.existsSync(parentDir)) {
    check("PASS", `Log directory exists (${parentDir})`);
  } else {
    check(
      "WARN",
      `Log directory missing (${parentDir})`,
      `Run: mkdir -p "${parentDir}"`,
    );
  }
}

/**
 * Check 10: Config file permissions (should be 0600 or stricter)
 */
function checkConfigPermissions() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return;
  try {
    const stats = fs.statSync(configPath);
    const mode = stats.mode & 0o777;
    if (mode <= 0o600) {
      check("PASS", `Config file permissions secure (0${mode.toString(8)})`);
    } else {
      check(
        "WARN",
        `Config file permissions too permissive (0${mode.toString(8)})`,
        `Run: chmod 600 ${configPath}`,
      );
    }
  } catch { /* ignore */ }
}

/**
 * Check 11: Systemd service status
 */
function checkSystemdService() {
  try {
    const result = spawnSync(
      "systemctl",
      ["is-active", "strategos"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const status = result.status === 0 && result.stdout?.trim() === "active" ? "active" : "inactive";
    if (status === "active") {
      check("PASS", "Systemd service 'strategos' is active");
    } else {
      check(
        "WARN",
        "Systemd service 'strategos' is not running",
        "Start with: sudo systemctl start strategos",
      );
    }
  } catch {
    check("WARN", "systemd not available or not accessible (not a systemd system)");
  }
}

/**
 * Check 12: Agent offices directory exists
 */
function checkAgentOffices(agentOfficesPath?: string) {
  if (!agentOfficesPath) {
    check("WARN", "Agent offices path not configured");
    return;
  }
  if (fs.existsSync(agentOfficesPath)) {
    const offices = fs
      .readdirSync(agentOfficesPath)
      .filter((d) => fs.statSync(path.join(agentOfficesPath, d)).isDirectory());
    if (offices.length > 0) {
      check(
        "PASS",
        `Agent offices directory exists (${offices.length} offices: ${offices.join(", ")})`,
      );
    } else {
      check(
        "WARN",
        "Agent offices directory exists but is empty",
        "Offices will be created on first agent boot",
      );
    }
  } else {
    check(
      "WARN",
      "Agent offices directory missing",
      `Run: mkdir -p ${agentOfficesPath}`,
    );
  }
}

/**
 * Check 13: Database files (Kanban + Messages)
 */
function checkDatabaseFiles(kanbanDb?: string, messagesDb?: string) {
  if (kanbanDb) {
    const exists = fs.existsSync(kanbanDb);
    if (exists) {
      const size = fs.statSync(kanbanDb).size;
      check("PASS", `Kanban database exists (${(size / 1024).toFixed(1)} KB)`);
    } else {
      check(
        "WARN",
        "Kanban database not yet created",
        "Will be created on first kanban operation",
      );
    }
  }
  if (messagesDb) {
    const exists = fs.existsSync(messagesDb);
    if (exists) {
      const size = fs.statSync(messagesDb).size;
      check("PASS", `Messages database exists (${(size / 1024).toFixed(1)} KB)`);
    } else {
      check(
        "WARN",
        "Messages database not yet created",
        "Will be created on first message operation",
      );
    }
  }
}

/**
 * Check 14: Wizard metadata (first-run detection)
 */
function checkWizardMetadata(config: any) {
  const wizard = config.wizard;
  if (!wizard || !wizard.lastRunAt) {
    check(
      "WARN",
      "Setup wizard has not been run yet",
      "Run: strategos onboard  (or node build/index.js onboard)",
    );
  } else {
    check(
      "PASS",
      `Setup wizard last run: ${wizard.lastRunAt} (${wizard.lastRunMode} mode)`,
    );
  }
}

/**
 * Check 15: Memory system (LanceDB)
 */
function checkMemorySystem(lancedbPath?: string) {
  if (!lancedbPath) return;
  if (fs.existsSync(lancedbPath)) {
    check("PASS", `Memory system directory exists (${lancedbPath})`);
  } else {
    check(
      "WARN",
      "Memory system directory missing",
      `Run: mkdir -p ${lancedbPath}`,
    );
  }
}

/**
 * Check 16: MCP server connectivity (config validation)
 */
function checkMcpServers(mcpConfig?: Record<string, unknown>) {
  if (!mcpConfig || Object.keys(mcpConfig).length === 0) {
    check("WARN", "No MCP servers configured",
      "Add servers with: strategos mcp add");
    return;
  }

  let connectedCount = 0;
  let disabledCount = 0;
  const totalCount = Object.keys(mcpConfig).length;

  for (const [name, server] of Object.entries(mcpConfig)) {
    const srv = server as Record<string, unknown>;
    const enabled = srv.enabled !== false; // default true
    const type = srv.type as string;

    if (!enabled) {
      disabledCount++;
      continue;
    }

    // For local servers, check if command exists
    if (type === "local") {
      const command = (srv.command as string[]) || [];
      if (command.length > 0) {
        const cmd = command[0];
        if (findInPath(cmd)) {
          connectedCount++;
        } else {
          check("WARN", `MCP server "${name}" command not found: ${cmd}`,
            `Install the command or fix the path`);
        }
      }
    } else if (type === "remote") {
      const url = srv.url as string;
      if (url) {
        check("PASS", `MCP server "${name}" configured (remote: ${url})`);
        connectedCount++;
      }
    } else {
      check("WARN", `MCP server "${name}" has unknown type: ${type}`);
    }
  }

  const enabledCount = totalCount - disabledCount;
  if (connectedCount === enabledCount && enabledCount > 0) {
    check("PASS", `MCP servers: ${connectedCount}/${enabledCount} enabled, ${disabledCount} disabled`);
  }
}

// ── Output formatting ───────────────────────────────────────────────────

function printResults() {
  console.log("");
  console.log(`${BOLD}${CYAN}═══ Strategos Doctor ═══${RESET}`);
  console.log(`${CYAN}Diagnostic report${RESET}`);
  console.log("");

  for (const r of results) {
    const symbol = badge(r.severity);
    console.log(`  ${symbol} ${r.description}`);
    if (r.detail) {
      for (const line of r.detail.split("\n")) {
        console.log(`       ${YELLOW}${line}${RESET}`);
      }
    }
  }

  // Summary
  const passCount = results.filter((r) => r.severity === "PASS").length;
  const warnCount = results.filter((r) => r.severity === "WARN").length;
  const failCount = results.filter((r) => r.severity === "FAIL").length;

  console.log("");
  console.log(`${BOLD}─── Summary ───${RESET}`);
  console.log(
    `  ${GREEN}${passCount} passed${RESET}, ${YELLOW}${warnCount} warnings${RESET}, ${RED}${failCount} failed${RESET}`,
  );
  console.log("");

  // Fix suggestions
  const fixable = results.filter((r) => r.severity === "FAIL" && r.detail);
  if (fixable.length > 0) {
    console.log(`${BOLD}${RED}─── Fix Suggestions ───${RESET}`);
    for (const r of fixable) {
      console.log(`  ${BOLD}${r.description}${RESET}`);
      if (r.detail) {
        for (const line of r.detail.split("\n")) {
          console.log(`    ${line}`);
        }
      }
      console.log("");
    }
  }
}

// ── Main entry point ────────────────────────────────────────────────────

export async function runDoctor(): Promise<boolean> {
  try {
    checkNodeVersion();
    checkConfigFileExists();
    const config = checkConfigParses();

    if (config) {
      const baseUrl = config.llm?.baseUrl;
      if (baseUrl) {
        await checkLlmBaseUrlReachable(baseUrl);
        const model = config.llm?.model ?? "qwen3-coder-plus";
        await checkLlmMinimalCompletion(baseUrl, model);
      } else {
        check("WARN", "LLM baseUrl not configured (using provider default)");
      }

      const configPaths = config.paths as
        | Record<string, string>
        | undefined;
      if (configPaths) {
        checkPaths(configPaths);
      }

      checkTelegramToken(config.telegram?.botToken);
      checkTelegramChatId(config.telegram?.chatId);
      checkLogFileParent(config.logging?.file);

      // Extended health checks
      checkConfigPermissions();
      checkSystemdService();
      checkAgentOffices(config.paths?.agentOffices);
      checkDatabaseFiles(config.paths?.kanbanDb, config.paths?.messagesDb);
      checkMemorySystem(config.paths?.lancedb);
      checkWizardMetadata(config);
      checkMcpServers(config.mcp as Record<string, unknown> | undefined);
    }

    printResults();

    const hasFailures = results.some((r) => r.severity === "FAIL");
    return !hasFailures;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n${RED}[ERROR] Doctor encountered an unexpected error:${RESET}`);
    console.error(`  ${message}`);
    console.error(`\n${YELLOW}This is a bug — please report it.${RESET}\n`);
    return false;
  }
}

// ── CLI entry point (when run directly) ─────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = await runDoctor();
  process.exit(ok ? 0 : 1);
}
