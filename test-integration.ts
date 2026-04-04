import * as path from "path";

interface TestResult {
  name: string;
  pass: boolean;
  reason?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, pass: false, reason: msg });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run() {
  // ── 1. MCP server module loads ──
  await test("MCP server module loads without errors", async () => {
    const server = await import("./src/mcp/server.js");
    assert(typeof server.startStrategos === "function", "startStrategos should be a function");
  });

  // ── 2. Tool definitions generated for all Strategos tools ──
  await test("Tool definitions are generated for all Strategos tools", async () => {
    const tb = await import("./src/runtime/tool-bridge.js");
    const knownToolNames = [
      "memory.search", "memory.recall", "memory.upsert", "memory.forget",
      "memory.consolidate", "memory.stats",
      "board.get", "board.addCard", "board.moveCard", "board.viewReports",
      "board.reassign", "board.escalate",
      "message.send", "message.reply", "message.getThread", "message.getThreads",
      "message.search", "message.markRead", "message.escalate", "message.getUnread",
      "agent.inbox",
      "agent.call", "agent.handoff", "agent.meeting", "agent.wake",
      "lifeos.query", "lifeos.find", "lifeos.create", "lifeos.update",
      "org.chart", "staff.list", "staff.get",
      "meeting.propose", "meeting.vote", "meeting.get", "meeting.recordMinutes",
      "hire.create", "hire.fire", "hire.getTeam",
      "delegate.to", "delegate.accept", "delegate.reject", "delegate.update", "delegate.get",
      "reports.save", "reports.getLatest",
      "notify.telegram",
      "heartbeat.runNow",
      "task.get",
    ];
    const defs = tb.buildToolDefinitions(knownToolNames);
    assert(defs.length === knownToolNames.length, `Expected ${knownToolNames.length} definitions, got ${defs.length}`);
    for (const name of knownToolNames) {
      const def = defs.find(d => d.name === name);
      assert(def !== undefined, `Missing definition for ${name}`);
      assert(def.description.length > 0, `${name} should have a description`);
      assert(typeof def.parameters === "object", `${name} should have parameters`);
    }
  });

  // ── 3. Tool bridge creates functional tool handlers ──
  await test("Tool bridge creates functional tool handlers", async () => {
    const tb = await import("./src/runtime/tool-bridge.js");
    const bridge = tb.createToolBridge(async (name: string, _args: Record<string, unknown>) => {
      return { content: [{ type: "text" as const, text: `ok:${name}` }] };
    });
    assert(typeof bridge === "function", "createToolBridge should return a function");
    const result = await bridge("memory.search", { query: "test" });
    assert(result.success === true, "Bridge should return success=true");
    assert(result.content === "ok:memory.search", "Bridge should pass through executor text");
  });

  await test("Tool bridge handles executor errors", async () => {
    const tb = await import("./src/runtime/tool-bridge.js");
    const bridge = tb.createToolBridge(async () => { throw new Error("simulated failure"); });
    const result = await bridge("test.tool", {});
    assert(result.success === false, "Bridge should return success=false on error");
    assert(result.error === "simulated failure", "Bridge should pass through error message");
  });

  // ── 4. Prompt builder creates valid system prompts ──
  await test("Prompt builder creates valid system prompts", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "strategos",
      taskPrompt: "Do something",
      mode: "minimal",
      includeWorkspace: false,
    });
    assert(prompt.length > 0, "Prompt should not be empty");
    assert(prompt.includes("Strategos Agent"), "Prompt should include agent identity");
    assert(prompt.includes("Do something"), "Prompt should include task prompt");
  });

  // ── 5. Prompt builder includes tool definitions in prompt ──
  await test("Prompt builder includes tool definitions in prompt", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "strategos",
      toolList: [
        { name: "memory.search", description: "Search memory" },
        { name: "board.get", description: "Get Kanban board" },
      ],
      mode: "minimal",
      includeWorkspace: false,
    });
    assert(prompt.includes("Available Tools"), "Prompt should include tools section");
    assert(prompt.includes("memory.search"), "Prompt should include memory.search");
    assert(prompt.includes("Search memory"), "Prompt should include tool description");
  });

  // ── 6. Prompt builder handles empty tool list ──
  await test("Prompt builder handles empty tool list", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "strategos",
      toolList: [],
      mode: "minimal",
      includeWorkspace: false,
    });
    assert(!prompt.includes("Available Tools"), "Prompt should not include tools section when list is empty");
    assert(prompt.includes("Strategos Agent"), "Prompt should still include identity");
  });

  // ── 7. Prompt builder handles missing agent role ──
  await test("Prompt builder handles missing agent role", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "nonexistent-agent-xyz",
      mode: "minimal",
      includeWorkspace: false,
    });
    assert(prompt.length > 0, "Prompt should still be generated");
    assert(prompt.includes("nonexistent-agent-xyz"), "Prompt should include the agent ID as fallback");
  });

  // ── 8. Heartbeat module exports expected functions ──
  await test("Heartbeat module exports expected functions", async () => {
    const hb = await import("./src/scheduler/heartbeat.js");
    assert(typeof hb.startHeartbeat === "function", "startHeartbeat should be a function");
  });

  // ── 9. Message processor module exports expected functions ──
  await test("Message processor module exports expected functions", async () => {
    const mp = await import("./src/scheduler/message-processor.js");
    assert(typeof mp.MessageProcessor === "function", "MessageProcessor should be a class");
    assert(typeof mp.startMessageProcessor === "function", "startMessageProcessor should be a function");
    assert(typeof mp.getMessageProcessor === "function", "getMessageProcessor should be a function");
  });

  // ── 10. Agent executor module exports expected functions ──
  await test("Agent executor module exports expected functions", async () => {
    const ae = await import("./src/scheduler/agent-executor.js");
    assert(typeof ae.AgentExecutor === "function", "AgentExecutor should be a class");
    assert(typeof ae.startAgentExecutor === "function", "startAgentExecutor should be a function");
    assert(typeof ae.getAgentExecutor === "function", "getAgentExecutor should be a function");
    assert(typeof ae.setExecutorTools === "function", "setExecutorTools should be a function");
  });

  // ── 11. Meeting scheduler module exports expected functions ──
  await test("Meeting scheduler module exports expected functions", async () => {
    const ms = await import("./src/scheduler/meeting-scheduler.js");
    assert(typeof ms.MeetingScheduler === "function", "MeetingScheduler should be a class");
    assert(typeof ms.startMeetingScheduler === "function", "startMeetingScheduler should be a function");
    assert(typeof ms.getMeetingScheduler === "function", "getMeetingScheduler should be a function");
  });

  // ── 12. Agent scheduler module exports expected functions ──
  await test("Agent scheduler module exports expected functions", async () => {
    const as_ = await import("./src/scheduler/agent-scheduler.js");
    assert(typeof as_.AgentScheduler === "function", "AgentScheduler should be a class");
    assert(typeof as_.getAgentScheduler === "function", "getAgentScheduler should be a function");
    assert(typeof as_.startAgentScheduler === "function", "startAgentScheduler should be a function");
  });

  // ── 13. buildToolBlock includes tool descriptions ──
  await test("buildToolBlock includes tool descriptions", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "strategos",
      toolList: [
        { name: "memory.search", description: "Search memory with vector similarity" },
        { name: "board.addCard", description: "Add a Kanban task" },
        { name: "message.send", description: "Send message to another agent" },
      ],
      mode: "minimal",
      includeWorkspace: false,
    });
    assert(prompt.includes("Search memory with vector similarity"), "Should include memory.search description");
    assert(prompt.includes("Add a Kanban task"), "Should include board.addCard description");
    assert(prompt.includes("Send message to another agent"), "Should include message.send description");
    assert(prompt.includes("Memory:"), "Should categorize memory tools");
    assert(prompt.includes("Kanban:"), "Should categorize board tools");
    assert(prompt.includes("Messaging:"), "Should categorize message tools");
  });

  // ── 14. isSilentAck correctly identifies silent acknowledgments ──
  await test("isSilentAck correctly identifies silent acknowledgments", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    assert(pb.isSilentAck("HEARTBEAT_OK") === true, "Should match HEARTBEAT_OK");
    assert(pb.isSilentAck("heartbeat_ok") === true, "Should match heartbeat_ok");
    assert(pb.isSilentAck("heartbeat ok") === true, "Should match heartbeat ok");
    assert(pb.isSilentAck("heartbeatok") === true, "Should match heartbeatok");
    assert(pb.isSilentAck("some text heartbeat_ok more text") === true, "Should match contains heartbeat_ok");
    assert(pb.isSilentAck("all clear") === true, "Should match 'all clear'");
    assert(pb.isSilentAck("All clear!") === true, "Should match 'All clear!'");
    assert(pb.isSilentAck("nothing new") === true, "Should match 'nothing new'");
    assert(pb.isSilentAck("nothing to report") === true, "Should match 'nothing to report'");
    assert(pb.isSilentAck("nothing here") === true, "Should match 'nothing here'");
    assert(pb.isSilentAck("nothing changed") === true, "Should match 'nothing changed'");
    assert(pb.isSilentAck("same as before") === true, "Should match 'same as before'");
    assert(pb.isSilentAck("same picture") === true, "Should match 'same picture'");
    assert(pb.isSilentAck("same pattern") === true, "Should match 'same pattern'");
    assert(pb.isSilentAck("I found 3 overdue tasks") === false, "Should NOT match substantive finding");
    assert(pb.isSilentAck("There are 5 blocked cards") === false, "Should NOT match blocked cards");
    assert(pb.isSilentAck("Revenue dropped by 20%") === false, "Should NOT match revenue drop");
  });

  // ── 15. stripHeartbeatToken strips HEARTBEAT_OK tokens ──
  await test("stripHeartbeatToken strips HEARTBEAT_OK tokens", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    assert(pb.stripHeartbeatToken("HEARTBEAT_OK") === "", "Should strip standalone HEARTBEAT_OK");
    assert(pb.stripHeartbeatToken("heartbeat_ok text") === "text", "Should strip heartbeat_ok prefix");
    assert(pb.stripHeartbeatToken("text HEARTBEAT_OK") === "text", "Should strip HEARTBEAT_OK suffix");
    assert(pb.stripHeartbeatToken("heartbeat_ok") === "", "Should strip lowercase");
    assert(pb.stripHeartbeatToken("  HEARTBEAT_OK  ") === "", "Should strip with whitespace");
    assert(pb.stripHeartbeatToken("some content") === "some content", "Should leave non-matching text");
  });

  // ── 16. hasSubstantiveFinding correctly identifies substantive content ──
  await test("hasSubstantiveFinding correctly identifies substantive content", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    assert(pb.hasSubstantiveFinding("Found 3 overdue tasks") === true, "Should detect overdue tasks");
    assert(pb.hasSubstantiveFinding("2 blocked cards in review") === true, "Should detect blocked cards");
    assert(pb.hasSubstantiveFinding("Action needed on project alpha") === true, "Should detect action needed");
    assert(pb.hasSubstantiveFinding("Revenue spike detected") === true, "Should detect revenue spike");
    assert(pb.hasSubstantiveFinding("Recommend updating the database") === true, "Should detect recommendations");
    assert(pb.hasSubstantiveFinding("Critical: system down") === true, "Should detect critical issues");
    assert(pb.hasSubstantiveFinding("Sleep hours dropped to 5h") === true, "Should detect health findings");
    assert(pb.hasSubstantiveFinding("Follow up with John needed") === true, "Should detect relationship items");
    assert(pb.hasSubstantiveFinding("Content pipeline has 3 stale drafts") === true, "Should detect content issues");
    assert(pb.hasSubstantiveFinding("Budget exceeded by 15%") === true, "Should detect budget issues");
    assert(pb.hasSubstantiveFinding("same as before") === false, "Should not flag 'same as before'");
    assert(pb.hasSubstantiveFinding("nothing new to flag") === false, "Should not flag 'nothing new'");
    assert(pb.hasSubstantiveFinding("just checking") === false, "Should not flag 'just checking'");
    assert(pb.hasSubstantiveFinding("no new items") === false, "Should not flag 'no new items'");
    assert(pb.hasSubstantiveFinding("all clear") === false, "Should not flag 'all clear'");
    assert(pb.hasSubstantiveFinding("this is repetitive") === false, "Should not flag 'repetitive'");
    assert(pb.hasSubstantiveFinding("no escalation needed") === false, "Should not flag 'no escalation needed'");
  });

  // ── 17. currentTimeLine returns current timestamp ──
  await test("currentTimeLine returns current timestamp", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const timeLine = pb.currentTimeLine();
    assert(timeLine.startsWith("Current time: "), "Should start with 'Current time: '");
    const timestampStr = timeLine.replace("Current time: ", "");
    const parsed = new Date(timestampStr);
    assert(!isNaN(parsed.getTime()), "Should be a valid date string");
    const now = new Date();
    const diffMs = Math.abs(parsed.getTime() - now.getTime());
    assert(diffMs < 60000, `Timestamp should be within 1 minute of now (diff: ${diffMs}ms)`);
  });

  // ── Additional: mcpResponseToToolResult ──
  await test("mcpResponseToToolResult converts MCP responses", async () => {
    const tb = await import("./src/runtime/tool-bridge.js");
    const result = tb.mcpResponseToToolResult({
      content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }],
    });
    assert(result.success === true, "Should be successful");
    assert(result.content === "hello\nworld", "Should join content with newlines");
  });

  // ── Additional: buildToolDefinitions filters unknown tools ──
  await test("buildToolDefinitions filters unknown tool names", async () => {
    const tb = await import("./src/runtime/tool-bridge.js");
    const defs = tb.buildToolDefinitions(["memory.search", "nonexistent.tool.xyz", "board.get"]);
    assert(defs.length === 2, `Should filter unknown tools, got ${defs.length}`);
    assert(defs[0].name === "memory.search", "First should be memory.search");
    assert(defs[1].name === "board.get", "Second should be board.get");
  });

  // ── Report ──
  console.log("\n" + "=".repeat(60));
  console.log("INTEGRATION TEST RESULTS");
  console.log("=".repeat(60) + "\n");

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.pass) {
      console.log(`[PASS] ${r.name}`);
      passed++;
    } else {
      console.log(`[FAIL] ${r.name} - ${r.reason}`);
      failed++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log("=".repeat(60) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err: Error) => {
  console.error("Test runner error:", err.message);
  process.exit(1);
});
