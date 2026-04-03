import { spawn } from "child_process";
import { setTimeout } from "timers/promises";
import http from "http";

console.log("🧪 Discovering opencode serve API endpoints\n");

const serve = spawn("opencode", ["serve", "--port", "8766", "--print-logs"], {
  stdio: ["pipe", "pipe", "pipe"],
});

serve.stderr.on("data", d => {
  const msg = d.toString();
  if (msg.includes("listening")) console.log("[serve]", msg.trim());
});

await setTimeout(4000);

const endpoints = [
  ["/api/chat", { message: "hi" }],
  ["/api/message", { message: "hi" }],
  ["/message", { message: "hi" }],
  ["/v1/chat/completions", { model: "default", messages: [{role:"user",content:"hi"}] }],
];

for (const [path, body] of endpoints) {
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1", port: 8766, path, method: "POST",
        headers: { "Content-Type": "application/json" }
      }, r => {
        let data = "";
        r.on("data", c => data += c);
        r.on("end", () => resolve({ status: r.statusCode, data: data.substring(0, 200) }));
      });
      req.on("error", e => resolve({ status: 0, data: e.message }));
      req.write(JSON.stringify(body));
      req.end();
    });
    console.log(`${path}: ${res.status} - ${res.data}`);
  } catch (err) {
    console.log(`${path}: ERROR - ${err.message}`);
  }
  await setTimeout(500);
}

serve.kill();
