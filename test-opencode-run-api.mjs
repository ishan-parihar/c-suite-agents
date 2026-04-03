import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

console.log("🧪 Testing opencode run as conversational API\n");

// Test 1: Simple conversation
console.log("\n1️⃣ Simple greeting...");
const r1 = await execAsync('opencode run "Introduce yourself in 1 sentence" 2>&1');
console.log(r1.stdout?.substring(0, 300));

// Test 2: Tool use
console.log("\n2️⃣ Tool use (list files)...");
const r2 = await execAsync('opencode run "What files are in src/ directory?" 2>&1');
console.log(r2.stdout?.substring(0, 400));

// Test 3: Complex reasoning
console.log("\n3️⃣ Complex task (analyze project)...");
const r3 = await execAsync('opencode run "What is this project about? Look at package.json and summarize" 2>&1');
console.log(r3.stdout?.substring(0, 500));

console.log("\n✅ All opencode run tests completed\n");
