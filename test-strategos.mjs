import { spawn } from "child_process";
import { setTimeout } from "timers/promises";

console.log("🚀 Starting Strategos E2E Test with qwen3-embedding:0.6b...\n");

// Spawn Strategos MCP server with correct env
const proc = spawn("node", ["build/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, OLLAMA_EMBED_MODEL: "qwen3-embedding:0.6b" }
});

let stdout = "";
proc.stdout.on("data", d => { stdout += d.toString(); });
proc.stderr.on("data", d => {
  const msg = d.toString().trim();
  if (!msg.includes('"level":30')) console.log("[Strategos]", msg);
});

await setTimeout(3000);

// Check if server started successfully
if (stdout.includes("Fatal")) {
  console.error("❌ Server failed to start");
  proc.kill();
  process.exit(1);
}

// Send MCP initialize request
const initReq = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.1.0" }
  }
}) + "\n";

proc.stdin.write(initReq);
await setTimeout(1000);

// List tools
const toolsReq = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {}
}) + "\n";

proc.stdin.write(toolsReq);
await setTimeout(1000);

// Create agent
const agentReq = JSON.stringify({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "agent.create",
    arguments: { name: "test-agent", role: "developer" }
  }
}) + "\n";

proc.stdin.write(agentReq);
await setTimeout(2000);

console.log("\n📊 Results so far:\n");
console.log(stdout);

proc.kill();
console.log("\n✅ Test completed!\n");
