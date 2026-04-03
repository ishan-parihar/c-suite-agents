import { spawn } from "child_process";
import { setTimeout } from "timers/promises";

console.log("🧪 Testing OpenCode ACP as Conversational Layer\n");

// Start ACP server
const acp = spawn("opencode", ["acp", "--print-logs"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
acp.stdout.on("data", d => {
  buffer += d.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  
  for (const line of lines) {
    if (line.trim() && !line.startsWith("INFO") && !line.startsWith("DEBUG")) {
      console.log("[ACP]", line);
    }
  }
});

acp.stderr.on("data", d => {
  const msg = d.toString().trim();
  if (msg.includes("ERROR")) console.log("[ACP ERROR]", msg);
});

await setTimeout(3000);

// Send JSON-RPC initialize
const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {
      roots: { listChanges: true },
      sampling: {}
    },
    clientInfo: { name: "strategos-test", version: "0.1.0" }
  }
};

console.log("\n📤 Sending initialize...");
acp.stdin.write(JSON.stringify(init) + "\n");

await setTimeout(2000);

// Send a simple message/prompt
const prompt = {
  jsonrpc: "2.0",
  id: 2,
  method: "message/user",
  params: {
    content: [{ type: "text", text: "Hello, are you there? Respond briefly." }]
  }
};

console.log("\n📤 Sending user message...");
acp.stdin.write(JSON.stringify(prompt) + "\n");

await setTimeout(5000);

console.log("\n✅ Test completed\n");
acp.kill();
