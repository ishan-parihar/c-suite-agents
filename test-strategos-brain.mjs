import { exec } from "child_process";
import { promisify } from "util";
import { setTimeout } from "timers/promises";
const execAsync = promisify(exec);

console.log("🧪 Testing opencode run as Strategos Brain\n");

// Simulate Strategos receiving a user message and deciding what to do
const userMessage = "I want to create a new developer agent for the TypeScript project and assign them to implement the ACP client";

console.log("\n📥 User message:", userMessage);
console.log("\n🤖 Strategos thinking via opencode run...\n");

const prompt = `You are STRATEGOS, the CEO agent managing a team of AI employees.

CURRENT STATE:
- You have MCP tools: agent.create, memory.upsert, memory.search, board.addCard, board.moveCard, heartbeat.runNow
- You manage sub-agents (employees) who each have their own memory and Kanban board

USER REQUEST:
"${userMessage}"

TASK:
1. Analyze what the user wants
2. Decide which MCP tools to call and in what order
3. Return a JSON response with:
   {
     "analysis": "brief analysis",
     "actions": [
       {"tool": "tool.name", "arguments": {...}},
       ...
     ],
     "response": "natural language response to user"
   }

Return ONLY the JSON, no other text.`;

const result = await execAsync(`timeout 45 opencode run ${JSON.stringify(prompt)} 2>&1`);
console.log("📤 Strategos response:\n");
console.log(result.stdout);

// Extract JSON from response
const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
if (jsonMatch) {
  try {
    const actions = JSON.parse(jsonMatch[0]);
    console.log("\n✅ Parsed actions:", JSON.stringify(actions, null, 2));
  } catch (err) {
    console.log("\n⚠️ Could not parse JSON:", err.message);
  }
}

console.log("\n✅ Test completed\n");
