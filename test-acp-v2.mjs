import { spawn } from "child_process";
import { setTimeout } from "timers/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = process.cwd();

console.log("🧪 Testing ACP with proper parameters\n");

const acp = spawn("opencode", ["acp", "--print-logs"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: __dir,
});

const responses = [];
acp.stdout.on("data", d => {
  for (const line of d.toString().split("\n")) {
    if (line.startsWith("{")) {
      try { responses.push(JSON.parse(line)); console.log("[ACP]", JSON.parse(line)); } catch {}
    }
  }
});

await setTimeout(3000);

// Try with version as number and cwd
const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    version: 1,
    cwd: __dir,
    mcpServers: []
  }
};

console.log("📤 Sending initialize with version:1, cwd, mcpServers:[]");
acp.stdin.write(JSON.stringify(init) + "\n");
await setTimeout(3000);

// Try session/new with proper params
const session = {
  jsonrpc: "2.0",
  id: 2,
  method: "session/new",
  params: {
    cwd: __dir,
    message: "Hello, introduce yourself"
  }
};

console.log("\n📤 Sending session/new with message");
acp.stdin.write(JSON.stringify(session) + "\n");
await setTimeout(5000);

console.log("\n📊 Responses:", responses.map(r => r.id + ": " + (r.result ? "OK" : r.error?.message)));
acp.kill();
