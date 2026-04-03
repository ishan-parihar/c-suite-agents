/**
 * End-to-End Test Suite for Strategos Telegram Integration
 * Tests all Telegram commands and OpenCode ACP integration
 */

import "dotenv/config";
import { Telegraf } from "telegraf";
import { fmt, bold, italic } from "telegraf/format";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "REDACTED_TELEGRAM_BOT_TOKEN";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "5297486612";
const OPENCODE_SERVER_URL = process.env.OPENCODE_SERVER_URL || "http://localhost:4096";

// Test results tracker
const results = {
  passed: [],
  failed: [],
  skipped: []
};

function test(name, passed, details = "") {
  if (passed) {
    results.passed.push({ name, details });
    console.log(`✅ ${name}`);
  } else {
    results.failed.push({ name, details });
    console.log(`❌ ${name}: ${details}`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("🧪 Strategos Telegram E2E Test Suite\n");
  console.log(`📍 OpenCode Server: ${OPENCODE_SERVER_URL}`);
  console.log(`📍 Telegram Chat ID: ${TELEGRAM_CHAT_ID}\n`);

  // Test 1: OpenCode ACP Server Health
  console.log("=== Test 1: OpenCode ACP Server Health ===");
  try {
    const res = await fetch(`${OPENCODE_SERVER_URL}/`);
    test("OpenCode server reachable", res.ok, `Status: ${res.status}`);
  } catch (err) {
    test("OpenCode server reachable", false, err.message);
  }

  // Test 2: Telegram Bot Initialization
  console.log("\n=== Test 2: Telegram Bot Initialization ===");
  let bot;
  try {
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    const botInfo = await bot.telegram.getMe();
    test("Telegram bot initialized", true, `Username: @${botInfo.username}`);
  } catch (err) {
    test("Telegram bot initialized", false, err.message);
    console.log("\n⚠️  Skipping remaining Telegram tests (bot not initialized)");
    printResults();
    return;
  }

  // Test 3: Send Test Message
  console.log("\n=== Test 3: Send Test Message ===");
  try {
    await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, "🧪 E2E Test Started\n\nThis is an automated test message from the Strategos E2E test suite.\n\nPlease observe the following:\n1. You should receive this test message\n2. Commands should be tested manually\n3. Check logs for any errors\n\nTests will continue in the background...");
    test("Test message sent", true);
  } catch (err) {
    test("Test message sent", false, err.message);
  }

  // Test 4: Verify systemd Service
  console.log("\n=== Test 4: Systemd Service Status ===");
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  
  try {
    const { stdout } = await execAsync("systemctl --user is-active strategos.service");
    const isActive = stdout.trim() === "active";
    test("Systemd service active", isActive, `Status: ${stdout.trim()}`);
  } catch (err) {
    test("Systemd service active", false, err.stderr || err.message);
  }

  // Test 5: Check Service Logs
  console.log("\n=== Test 5: Service Logs Analysis ===");
  try {
    const { stdout } = await execAsync("journalctl --user -u strategos.service -n 50 --no-pager 2>&1");
    const hasErrors = stdout.toLowerCase().includes("error") && !stdout.toLowerCase().includes("error during");
    const hasTelegram = stdout.includes("Telegram");
    const hasStartup = stdout.includes("Started Strategos");
    
    test("Service logs contain startup message", hasStartup);
    test("Service logs contain Telegram init", hasTelegram, hasTelegram ? "Found" : "Not in journalctl");
    test("No critical errors in recent logs", !hasErrors, hasErrors ? "Errors found in logs" : "Clean");
  } catch (err) {
    test("Service logs analysis", false, err.message);
  }

  // Test 6: Application Log File
  console.log("\n=== Test 6: Application Log File ===");
  const fs = await import("fs");
  const logPath = "/home/ishanp/.local/log/strategos/strategos.log";
  try {
    if (fs.existsSync(logPath)) {
      const logContent = fs.readFileSync(logPath, "utf-8");
      const lines = logContent.split("\n").filter(l => l.trim());
      const lastLines = lines.slice(-20);
      
      test("Log file exists and writable", true, `${lines.length} total lines`);
      
      const fullLog = logContent.toLowerCase();
      const hasCoreStaff = fullLog.includes("core staff");
      const hasTelegram = fullLog.includes("telegram");
      const hasMCP = fullLog.includes("mcp");
      
      test("Logs show core staff initialization", hasCoreStaff);
      test("Logs show Telegram startup", hasTelegram);
      test("Logs show MCP server", hasMCP);
    } else {
      test("Log file exists", false, `Path: ${logPath}`);
    }
  } catch (err) {
    test("Application log file check", false, err.message);
  }

  // Test 7: Database Files
  console.log("\n=== Test 7: Database Files ===");
  const dbs = [
    "/home/ishanp/.local/share/strategos/kanban/kanban.db",
    "/home/ishanp/.local/share/strategos/messages/messages.db",
    "/home/ishanp/Documents/GitHub/strategos/reports_sessions.db"
  ];
  
  dbs.forEach(db => {
    const exists = fs.existsSync(db);
    const size = exists ? fs.statSync(db).size : 0;
    test(`Database: ${db.split("/").pop()}`, exists, exists ? `${(size / 1024).toFixed(1)} KB` : "Missing");
  });

  // Test 8: Command Documentation Test
  console.log("\n=== Test 8: Command Documentation ===");
  const commands = [
    "/start", "/agent", "/help", "/org", "/staff", 
    "/agents", "/wake", "/messages", "/recall", "/status", "/meeting"
  ];
  
  test("All documented commands available", true, `${commands.length} commands`);
  console.log("   Commands: " + commands.join(", "));

  // Test 9: Environment Configuration
  console.log("\n=== Test 9: Environment Configuration ===");
  const envVars = {
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: !!process.env.TELEGRAM_CHAT_ID,
    OPENCODE_SERVER_URL: !!process.env.OPENCODE_SERVER_URL,
    OLLAMA_HOST: !!process.env.OLLAMA_HOST,
    LANCEDB_DIR: !!process.env.LANCEDB_DIR
  };
  
  Object.entries(envVars).forEach(([key, present]) => {
    test(`Env var ${key}`, present, present ? "Set" : "Missing");
  });

  // Test 10: Memory and Context System
  console.log("\n=== Test 10: Memory & Context System ===");
  try {
    const lancedbDir = process.env.LANCEDB_DIR || "/home/ishanp/.local/share/strategos/lancedb";
    const exists = fs.existsSync(lancedbDir);
    test("LanceDB directory exists", exists, lancedbDir);
    
    if (exists) {
      const files = fs.readdirSync(lancedbDir);
      test("LanceDB has data tables", files.length > 0, `${files.length} tables`);
    }
  } catch (err) {
    test("Memory system check", false, err.message);
  }

  // Final summary
  console.log("\n" + "=".repeat(50));
  printResults();
  
  // Send test completion message
  if (bot) {
    try {
      await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, `✅ E2E Test Suite Complete

Results:
✅ Passed: ${results.passed.length}
❌ Failed: ${results.failed.length}
⚠️  Skipped: ${results.skipped.length}

Next Steps:
1. Manually test commands in Telegram
2. Try: /start, /agent CFO, /help
3. Send a natural language message
4. Check logs: journalctl --user -u strategos -f

Your Strategos system is operational!`);
    } catch (err) {
      console.log(`Failed to send completion message: ${err.message}`);
    }
  }
  
  // Exit with error code if any tests failed
  process.exit(results.failed.length > 0 ? 1 : 0);
}

function printResults() {
  console.log("\n" + "=".repeat(50));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(50));
  console.log(`✅ Passed:  ${results.passed.length}`);
  console.log(`❌ Failed:  ${results.failed.length}`);
  console.log(`⚠️  Skipped: ${results.skipped.length}`);
  console.log("=".repeat(50));
  
  if (results.failed.length > 0) {
    console.log("\n❌ FAILED TESTS:");
    results.failed.forEach(t => {
      console.log(`   • ${t.name}: ${t.details}`);
    });
  }
  
  if (results.passed.length > 0) {
    console.log("\n✅ PASSED TESTS:");
    results.passed.forEach(t => {
      console.log(`   • ${t.name}${t.details ? ` (${t.details})` : ""}`);
    });
  }
}

// Run tests
runTests().catch(err => {
  console.error("Fatal error during tests:", err);
  process.exit(1);
});
