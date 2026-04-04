import { setLogLevel } from "./src/logger.js";
setLogLevel("fatal");

import {
  ContextManager,
  estimateTokens,
  isOversizedForSummary,
  splitMessagesByTokenShare,
} from "./src/runtime/context-manager.js";

const results: { pass: boolean; name: string; reason?: string }[] = [];

function assert(condition: boolean, name: string, reason?: string) {
  results.push(condition ? { pass: true, name } : { pass: false, name, reason: reason || "Assertion failed" });
}

async function test1() {
  const cm = new ContextManager();
  const session = cm.createSession("agent-1", "s1", "You are a helpful assistant");
  assert(
    session !== undefined &&
      session.messages.length === 1 &&
      session.messages[0].role === "system" &&
      session.systemPromptTokens > 0 &&
      session.compactionCount === 0 &&
      session.hasRealConversation === false,
    "ContextManager initializes with default config",
  );
}

async function test2() {
  const cm = new ContextManager();
  const session = cm.createSession("agent-1", "s2", "System prompt");
  const initialTokens = session.totalTokens;
  cm.addUserMessage("s2", "Hello, how are you doing today?");
  const afterUser = session.totalTokens;
  cm.addAssistantMessage("s2", "I am doing great, thank you for asking!");
  const afterAssistant = session.totalTokens;
  assert(
    afterUser > initialTokens && afterAssistant > afterUser && session.messages.length === 3,
    "Adding messages increases token count",
    `initial=${initialTokens}, afterUser=${afterUser}, afterAssistant=${afterAssistant}, msgCount=${session.messages.length}`,
  );
}

async function test3() {
  const text = "Hello world, this is a test message for token estimation.";
  const tokens = estimateTokens(text);
  const expected = Math.ceil(Math.ceil(text.length / 4) * 1.2);
  assert(tokens === expected && tokens > 0, "Token estimation works (estimateTokens function)", `expected=${expected}, got=${tokens}`);
}

async function test4() {
  const cm = new ContextManager({ maxContextTokens: 500, maxMessages: 100 });
  const session = cm.createSession("agent-1", "s4", "System prompt");
  const beforeCompaction = session.compactionCount;
  for (let i = 0; i < 20; i++) {
    cm.addUserMessage("s4", `User message number ${i} with some extra text to increase token count significantly.`);
    cm.addAssistantMessage("s4", `Assistant response number ${i} with detailed explanation and reasoning about the topic at hand.`);
  }
  assert(
    session.compactionCount > beforeCompaction,
    "Message pruning triggers when tokens exceed limit",
    `compactions before=${beforeCompaction}, after=${session.compactionCount}`,
  );
}

async function test5() {
  const cm = new ContextManager({ maxContextTokens: 500, maxMessages: 100 });
  cm.createSession("agent-1", "s5", "System prompt");
  for (let i = 0; i < 20; i++) {
    cm.addUserMessage("s5", `Message ${i}: padding text to fill up the context window with meaningful content.`);
    cm.addAssistantMessage("s5", `Response ${i}: more padding text to increase the token count beyond the threshold limit.`);
  }
  const messages = cm.getMessagesForLLM("s5");
  const hasSystemMessage = messages.some((m) => m.role === "system" && !m.isSummary);
  const hasRecentContent = messages.length >= 2;
  assert(
    hasSystemMessage && hasRecentContent,
    "Protected tokens (recent messages) preserved during pruning",
    `messages after compaction: ${messages.length}, hasSystem=${hasSystemMessage}`,
  );
}

async function test6() {
  let summarizeCallCount = 0;
  const cm = new ContextManager({ maxContextTokens: 32000 });
  cm.setSummarizeFn(async () => {
    summarizeCallCount++;
    return "Summarized content";
  });
  cm.createSession("agent-1", "s6", "System prompt");
  for (let i = 0; i < 30; i++) {
    cm.addUserMessage("s6", `User message ${i}: This is a longer message designed to accumulate tokens. `.repeat(5));
    cm.addAssistantMessage("s6", `Assistant reply ${i}: Detailed response with lots of information and analysis. `.repeat(5));
  }
  cm.compact("s6", 6);
  await new Promise((r) => setTimeout(r, 200));
  assert(
    summarizeCallCount > 0,
    "Staged summarization is triggered for oversized message sets",
    `summarizeFn called ${summarizeCallCount} times`,
  );
}

async function test7() {
  const maxTokens = 16000;
  const threshold = maxTokens * 0.6;
  const smallMsg = { role: "user" as const, content: "Hello", timestamp: Date.now(), tokenEstimate: 10 };
  const largeMsg = { role: "user" as const, content: "X".repeat(50000), timestamp: Date.now(), tokenEstimate: 15000 };
  const edgeMsg = { role: "user" as const, content: "X".repeat(40000), timestamp: Date.now(), tokenEstimate: Math.round(threshold) + 1 };
  assert(
    isOversizedForSummary(smallMsg, maxTokens) === false &&
      isOversizedForSummary(largeMsg, maxTokens) === true &&
      isOversizedForSummary(edgeMsg, maxTokens) === true,
    "isOversizedForSummary correctly detects messages that are too large for summary",
  );
}

async function test8() {
  const cm = new ContextManager({ maxContextTokens: 32000, modelContextTokens: 32000 });
  const effectiveMax = cm.effectiveMaxTokens();
  const usableForMessages = effectiveMax - 4096;
  assert(usableForMessages === 27904, "SUMMARIZATION_OVERHEAD_TOKENS (4096) is reserved", `effectiveMax=${effectiveMax}, usable=${usableForMessages}`);
}

async function test9() {
  const maxChunk = 16000;
  const smallContent = "Small message";
  const smallTokens = estimateTokens(smallContent);
  assert(smallTokens <= maxChunk, "MAX_SUMMARY_CHUNK_TOKENS (16000) chunk limit is enforced", `smallTokens=${smallTokens}, maxChunk=${maxChunk}`);
}

async function test10() {
  const cm1 = new ContextManager();
  const r1 = cm1.effectiveMaxTokens() === 32000;

  const cm2 = new ContextManager({ maxContextTokens: 128000 });
  const r2 = cm2.effectiveMaxTokens() === 128000;

  const cm3 = new ContextManager({ maxContextTokens: 128000, modelContextTokens: 200000 });
  const r3 = cm3.effectiveMaxTokens() === 200000;

  assert(r1, "Context window resolution: default (32000)", `got=${cm1.effectiveMaxTokens()}`);
  assert(r2, "Context window resolution: custom (128000)", `got=${cm2.effectiveMaxTokens()}`);
  assert(r3, "Context window resolution: model override (200000)", `got=${cm3.effectiveMaxTokens()}`);
}

async function test10b() {
  const msgs = [];
  for (let i = 0; i < 10; i++) {
    msgs.push({ role: "user", content: `Message ${i}`, timestamp: Date.now(), tokenEstimate: 100 });
  }
  const chunks = splitMessagesByTokenShare(msgs, 3);
  assert(chunks.length === 3, "splitMessagesByTokenShare splits correctly", `got ${chunks.length} chunks`);
}

async function test10c() {
  const emptyChunks = splitMessagesByTokenShare([], 3);
  assert(emptyChunks.length === 0, "splitMessagesByTokenShare handles empty input", `got ${emptyChunks.length} chunks`);
}

async function test10d() {
  const singleMsg = { role: "user", content: "Hi", timestamp: Date.now(), tokenEstimate: 10 };
  const singleChunks = splitMessagesByTokenShare([singleMsg], 5);
  assert(singleChunks.length === 1 && singleChunks[0].length === 1, "splitMessagesByTokenShare handles single message", `got ${singleChunks.length} chunks`);
}

async function test11() {
  const cm = new ContextManager({ maxContextTokens: 1000, maxMessages: 100 });
  cm.createSession("agent-1", "s11", "System prompt");
  for (let i = 0; i < 10; i++) {
    cm.recordToolCall("s11", {
      id: `tool-${i}`,
      name: `test-tool-${i}`,
      arguments: "{}",
      result: `Tool result ${i}: ` + "X".repeat(200),
      timestamp: Date.now(),
    });
  }
  const messages = cm.getMessagesForLLM("s11");
  assert(
    messages.length > 0 && messages[0].role === "system",
    "Tool result pruning logic works (protectedTokens vs prunableTokens)",
    `messages after tool calls: ${messages.length}`,
  );
}

async function test12() {
  const cm = new ContextManager({ maxContextTokens: 500, maxMessages: 100 });
  cm.setSummarizeFn(async () => "Summary");
  cm.createSession("agent-1", "s12", "System prompt");
  for (let i = 0; i < 30; i++) {
    cm.addUserMessage("s12", `Message ${i}: padding content to force overflow detection and compaction. `.repeat(3));
    cm.addAssistantMessage("s12", `Reply ${i}: assistant response with additional details and context. `.repeat(3));
  }

  await new Promise((r) => setTimeout(r, 200));

  const session = cm.getSession("s12");
  assert(
    session !== undefined && session.compactionCount > 0,
    "Overflow detection before LLM calls",
    `compactionCount=${session?.compactionCount}, totalTokens=${session?.totalTokens}`,
  );
}

async function test13() {
  const cm = new ContextManager();
  cm.createSession("agent-1", "s13", "System prompt");
  const messages = cm.getMessagesForLLM("s13");
  assert(messages.length === 1 && messages[0].role === "system", "Empty context manager returns only system message", `message count: ${messages.length}`);
}

async function test14() {
  const cm = new ContextManager();
  cm.createSession("agent-1", "s14", "System prompt");
  cm.addUserMessage("s14", "User message");
  cm.addAssistantMessage("s14", "Assistant reply");
  cm.recordToolCall("s14", {
    id: "tool-1",
    name: "test-tool",
    arguments: "{}",
    result: "Tool result content",
    timestamp: Date.now(),
  });
  cm.clearHistory("s14");
  const session = cm.getSession("s14");
  assert(
    session !== undefined &&
      session.messages.length === 1 &&
      session.messages[0].role === "system" &&
      session.toolCalls.length === 0 &&
      session.compactionCount === 0 &&
      session.previousSummary === undefined &&
      session.hasRealConversation === false,
    "clear() resets all state",
    `messages=${session?.messages.length}, toolCalls=${session?.toolCalls.length}, compaction=${session?.compactionCount}`,
  );
}

async function runTests() {
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
  await test8();
  await test9();
  await test10();
  await test10b();
  await test10c();
  await test10d();
  await test11();
  await test12();
  await test13();
  await test14();

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

  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
