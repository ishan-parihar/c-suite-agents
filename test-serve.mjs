import { spawn } from "child_process";
import { setTimeout } from "timers/promises";
import http from "http";

console.log("🧪 Testing opencode serve for persistent conversational server\n");

// Start opencode serve
const serve = spawn("opencode", ["serve", "--port", "8765", "--print-logs"], {
  stdio: ["pipe", "pipe", "pipe"],
});

serve.stderr.on("data", d => {
  const msg = d.toString();
  if (msg.includes("listening") || msg.includes("http")) {
    console.log("[serve]", msg.trim());
  }
});

await setTimeout(4000);

// Try to hit the HTTP endpoint
const makeRequest = (path, body) => {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: 8765,
      path: path,
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
};

try {
  console.log("\n📤 Testing /chat endpoint...");
  const res = await makeRequest("/chat", {
    message: "Hello, are you there? Respond in one sentence."
  });
  console.log("📥 Response:", res.status);
  console.log(res.data?.substring(0, 500));
} catch (err) {
  console.log("❌ Request failed:", err.message);
}

await setTimeout(2000);
serve.kill();
console.log("\n✅ Test completed\n");
