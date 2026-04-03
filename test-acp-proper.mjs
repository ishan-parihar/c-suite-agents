import { spawn } from "child_process";
import { setTimeout } from "timers/promises";

console.log("🧪 Testing ACP with correct protocol\n");

const acp = spawn("opencode", ["acp", "--print-logs", "--log-level", "INFO"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const responses = [];

acp.stdout.on("data", d => {
  buffer += d.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  
  for (const line of lines) {
    const jsonMatch = line.match(/^\{.*\}$/);
    if (jsonMatch) {
      try {
        responses.push(JSON.parse(line));
        console.log("[ACP JSON]", JSON.parse(line));
      } catch {}
    }
  }
});

await setTimeout(3000);

// ACP uses different protocol - let's try session-based methods
const methods = [
  { id: 1, method: "initialize", params: { protocolVersion: 1, capabilities: {}, clientInfo: { name: "test" } } },
  { id: 2, method: "session/new", params: {} },
];

for (const msg of methods) {
  console.log("\n📤 Sending:", msg.method);
  acp.stdin.write(JSON.stringify(msg) + "\n");
  await setTimeout(2000);
}

console.log("\n📊 All responses:", responses.length);
acp.kill();
