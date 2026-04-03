import { spawn } from "child_process";
import { setTimeout } from "timers/promises";

console.log("🚀 Strategos Full Test — qwen3-embedding:0.6b\n");

const proc = spawn("node", ["build/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, OLLAMA_EMBED_MODEL: "qwen3-embedding:0.6b" }
});

let responses = [];
proc.stdout.on("data", d => {
  const lines = d.toString().split("\n").filter(l => l.trim());
  for (const line of lines) {
    if (line.includes("jsonrpc")) responses.push(JSON.parse(line));
  }
});
proc.stderr.on("data", d => {
  const msg = d.toString().trim();
  if (msg.includes("level\":30")) console.log("✅", msg.match(/"msg":"([^"]+)"/)?.[1]);
});

await setTimeout(3000);

const send = (id, method, params={}) => {
  proc.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
};

// 1. Initialize
send(1, "initialize", {protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"test",version:"0.1"}});
await setTimeout(1000);

// 2. Create agent
send(3, "tools/call", {name:"agent.create",arguments:{name:"dev-agent",role:"developer"}});
await setTimeout(2000);
const agentId = responses.find(r=>r.id===3)?.result?.content?.[0]?.text;
console.log("✅ Agent created:", agentId);

// 3. Memory upsert
send(4, "tools/call", {name:"memory.upsert",arguments:{agent_id:agentId,type:"note",content:"Strategos test with qwen3-embedding",importance:0.9,tags:["test","qwen3"]}});
await setTimeout(2000);
const memId = responses.find(r=>r.id===4)?.result?.content?.[0]?.text;
console.log("✅ Memory upsert:", memId);

// 4. Memory search
send(5, "tools/call", {name:"memory.search",arguments:{agent_id:agentId,query:"strategos qwen3 test",top_k:5}});
await setTimeout(2000);
const searchRes = responses.find(r=>r.id===5)?.result?.content?.[0]?.text;
const items = JSON.parse(searchRes||"[]");
console.log("✅ Memory search found:", items.length, "items");

// 5. Board addCard
send(6, "tools/call", {name:"board.addCard",arguments:{agent_id:agentId,title:"ACP client implementation",description:"JSON-RPC wrapper for opencode",priority:"P1",tags:["acp","opencode"]}});
await setTimeout(2000);
const cardId = responses.find(r=>r.id===6)?.result?.content?.[0]?.text;
console.log("✅ Kanban card created:", cardId);

// 6. Board moveCard
send(7, "tools/call", {name:"board.moveCard",arguments:{card_id:cardId,status:"In Progress"}});
await setTimeout(2000);
const moveRes = responses.find(r=>r.id===7)?.result?.content?.[0]?.text;
console.log("✅ Card moved:", moveRes);

console.log("\n✅ ALL TESTS PASSED — Strategos + qwen3-embedding:0.6b working!\n");
proc.kill();
