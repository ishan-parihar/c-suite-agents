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
  // ============================================================
  // Phase 1: Context Engineering (prompt-builder.ts)
  // ============================================================

  // ── 1. buildToolBlock removed — no toolList param ──
  await test("Phase 1.1: buildToolBlock removed, toolList param gone", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    assert(typeof (pb as any).buildToolBlock === "undefined", "buildToolBlock should be removed");
    assert(typeof (pb as any).ToolDefinition === "undefined", "ToolDefinition should be removed");

    const prompt = pb.buildSystemPrompt({
      agentId: "ceo-strategic",
      mode: "minimal",
      includeWorkspace: false,
    });
    assert(!prompt.includes("Available Tools"), "Prompt should NOT include redundant tool list");
    assert(!prompt.includes("Memory:"), "Prompt should NOT include tool categories");
  });

  // ── 2. SYSTEM_PROMPT_CACHE_BOUNDARY constant exists ──
  await test("Phase 1.2: SYSTEM_PROMPT_CACHE_BOUNDARY exported", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    assert(typeof pb.SYSTEM_PROMPT_CACHE_BOUNDARY === "string", "Boundary should be a string");
    assert(pb.SYSTEM_PROMPT_CACHE_BOUNDARY.includes("CACHE_BOUNDARY"), "Boundary should contain marker");
  });

  // ── 3. Cache boundary present in full prompt ──
  await test("Phase 1.3: Full prompt contains cache boundary", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "ceo-strategic",
      taskPrompt: "Test task",
      mode: "full",
    });
    assert(prompt.includes(pb.SYSTEM_PROMPT_CACHE_BOUNDARY), "Full prompt should contain boundary");
  });

  // ── 4. splitPromptCacheBoundary works correctly ──
  await test("Phase 1.4: splitPromptCacheBoundary splits correctly", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "ceo-strategic",
      taskPrompt: "Test task",
      mode: "full",
    });
    const split = pb.splitPromptCacheBoundary(prompt);
    assert(split !== undefined, "Split should succeed");
    assert(split.stablePrefix.includes("Strategos Agent"), "Stable prefix should have identity");
    assert(split.stablePrefix.includes("IMPORTANT: Content within XML"), "Stable prefix should have anti-injection");
    assert(!split.stablePrefix.includes("Test task"), "Stable prefix should NOT have task");
    assert(split.dynamicSuffix.includes("Test task"), "Dynamic suffix should have task");
  });

  // ── 5. splitPromptCacheBoundary returns undefined when no boundary ──
  await test("Phase 1.5: splitPromptCacheBoundary returns undefined without boundary", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const split = pb.splitPromptCacheBoundary("no boundary here");
    assert(split === undefined, "Should return undefined for text without boundary");
  });

  // ── 6. Heartbeat mode skips workspace context ──
  await test("Phase 1.6: Heartbeat mode skips workspace context", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "ceo-strategic",
      taskPrompt: "Heartbeat check",
      mode: "heartbeat",
      includeWorkspace: true,
    });
    assert(prompt.includes("heartbeat_ok") || prompt.includes("HEARTBEAT_OK"), "Should include heartbeat instructions");
    assert(!prompt.includes("Workspace Context"), "Heartbeat should skip workspace context");
    assert(!prompt.includes("Organization Context"), "Heartbeat should skip org block");
  });

  // ── 7. Minimal mode skips workspace and org ──
  await test("Phase 1.7: Minimal mode skips workspace and org", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "ceo-strategic",
      mode: "minimal",
      includeWorkspace: true,
    });
    assert(!prompt.includes("Workspace Context"), "Minimal mode should skip workspace");
    assert(!prompt.includes("Organization Context"), "Minimal mode should skip org");
  });

  // ── 8. Message mode loads minimal context ──
  await test("Phase 1.8: Message mode loads filtered context", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "ceo-strategic",
      mode: "message",
      includeWorkspace: true,
    });
    assert(!prompt.includes("Organization Context"), "Message mode should skip org block");
    assert(!prompt.includes("HEARTBEAT.md") || !prompt.includes("Keep this file small"), "Message mode should filter HEARTBEAT.md");
  });

  // ── 9. MINIMAL_BOOTSTRAP_ALLOWLIST exported ──
  await test("Phase 1.9: MINIMAL_BOOTSTRAP_ALLOWLIST exported with correct files", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    assert(Array.isArray(pb.MINIMAL_BOOTSTRAP_ALLOWLIST), "Allowlist should be an array");
    assert(pb.MINIMAL_BOOTSTRAP_ALLOWLIST.includes("AGENTS.md"), "Should include AGENTS.md");
    assert(pb.MINIMAL_BOOTSTRAP_ALLOWLIST.includes("SOUL.md"), "Should include SOUL.md");
    assert(pb.MINIMAL_BOOTSTRAP_ALLOWLIST.includes("IDENTITY.md"), "Should include IDENTITY.md");
    assert(pb.MINIMAL_BOOTSTRAP_ALLOWLIST.includes("TOOLS.md"), "Should include TOOLS.md");
    assert(pb.MINIMAL_BOOTSTRAP_ALLOWLIST.includes("USER.md"), "Should include USER.md");
    assert(pb.MINIMAL_BOOTSTRAP_ALLOWLIST.length === 5, "Should have exactly 5 files");
  });

  // ── 10. filterBootstrapFiles exported ──
  await test("Phase 1.10: filterBootstrapFiles exported and callable", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    assert(typeof pb.filterBootstrapFiles === "function", "Should be a function");
    const ctx = pb.filterBootstrapFiles("ceo-strategic", "main");
    assert(typeof ctx === "string", "Should return a string");
  });

  // ── 11. filterBootstrapFiles filters for subagent ──
  await test("Phase 1.11: filterBootstrapFiles filters correctly for subagent", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const ctx = pb.filterBootstrapFiles("ceo-strategic", "subagent");
    assert(typeof ctx === "string", "Should return string");
    if (ctx.length > 0) {
      assert(!ctx.includes("HEARTBEAT.md"), "Subagent should not have HEARTBEAT.md");
      assert(!ctx.includes("BOOTSTRAP.md"), "Subagent should not have BOOTSTRAP.md");
    }
  });

  // ── 12. Full mode still loads everything ──
  await test("Phase 1.12: Full mode loads workspace + org context", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "ceo-strategic",
      taskPrompt: "Test task",
      mode: "full",
    });
    assert(prompt.includes("Workspace Context"), "Full mode should have workspace");
    assert(prompt.includes("Organization Context"), "Full mode should have org");
  });

  // ── 13. Memory injection still works ──
  await test("Phase 1.13: Memory injection still formatted correctly", async () => {
    const pb = await import("./src/runtime/prompt-builder.js");
    const prompt = pb.buildSystemPrompt({
      agentId: "ceo-strategic",
      memoryInjection: "Important finding from yesterday",
      taskPrompt: "Do something",
      mode: "full",
    });
    assert(prompt.includes("<memory_context>"), "Should have memory context tags");
    assert(prompt.includes("Important finding from yesterday"), "Should include memory content");
    assert(prompt.includes("</memory_context>"), "Should close memory context");
  });

  // ============================================================
  // Phase 2: Memory Architecture
  // ============================================================

  // ── 14. MemoryInjector reRankMemories composite scoring ──
  await test("Phase 2.1: reRankMemories uses composite scoring", async () => {
    const { MemoryInjector } = await import("./src/memory/injection.js");

    const mockRetriever = {
      search: async () => [],
      searchByTag: async () => [],
      searchRecent: async () => [],
      searchCrossAgent: async () => [],
      stats: async () => ({}),
      agentStats: async () => ({ total: 0, perAgent: {} }),
    };

    const injector = new (MemoryInjector as any)(mockRetriever);

    const now = Date.now();
    const memories = [
      { id: "1", ts: now - 3600000, content: "important project decision", importance: 0.9, type: "decision", scope: "personal", kind: "semantic" as const, agent_id: "test", content_hash: "x", original_importance: 0.9, tags: [], ttl_ms: null, decay_rate: 0.5, source: "manual" as const, vector: [0.1, 0.2, 0.3] },
      { id: "2", ts: now - 86400000 * 5, content: "old minor note", importance: 0.2, type: "note", scope: "personal", kind: "episodic" as const, agent_id: "test", content_hash: "y", original_importance: 0.2, tags: [], ttl_ms: null, decay_rate: 0.5, source: "manual" as const, vector: [0.4, 0.5, 0.6] },
      { id: "3", ts: now - 7200000, content: "recent task update", importance: 0.5, type: "log", scope: "personal", kind: "episodic" as const, agent_id: "test", content_hash: "z", original_importance: 0.5, tags: [], ttl_ms: null, decay_rate: 0.5, source: "manual" as const, vector: [0.7, 0.8, 0.9] },
    ];

    const ranked = injector.reRankMemories(memories, "important project decision");

    assert(ranked.length <= 10, "Should limit to 10 results");
    assert(ranked.length > 0, "Should return ranked memories");
    // The high-importance, recent memory should rank higher than the old, low-importance one
    const highIdx = ranked.findIndex((m: any) => m.id === "1");
    const lowIdx = ranked.findIndex((m: any) => m.id === "2");
    assert(highIdx < lowIdx, "High importance recent memory should rank above old low-importance one");
  });

  // ── 15. reRankMemories respects recency ──
  await test("Phase 2.2: reRankMemories recency scoring decays over 1 week", async () => {
    const { MemoryInjector } = await import("./src/memory/injection.js");

    const mockRetriever = {
      search: async () => [],
      searchByTag: async () => [],
      searchRecent: async () => [],
      searchCrossAgent: async () => [],
      stats: async () => ({}),
      agentStats: async () => ({ total: 0, perAgent: {} }),
    };

    const injector = new (MemoryInjector as any)(mockRetriever);

    const now = Date.now();
    const oneWeekOld = { id: "old", ts: now - 168 * 3600000, content: "old", importance: 0.5, type: "note", scope: "personal", kind: "semantic" as const, agent_id: "test", content_hash: "a", original_importance: 0.5, tags: [], ttl_ms: null, decay_rate: 0.5, source: "manual" as const, vector: [] };
    const veryOld = { id: "very-old", ts: now - 336 * 3600000, content: "very old", importance: 0.5, type: "note", scope: "personal", kind: "semantic" as const, agent_id: "test", content_hash: "b", original_importance: 0.5, tags: [], ttl_ms: null, decay_rate: 0.5, source: "manual" as const, vector: [] };

    const ranked = injector.reRankMemories([oneWeekOld, veryOld], "query");

    // Both should have same importance, so recency should differentiate
    const oneWeekIdx = ranked.findIndex((m: any) => m.id === "old");
    const veryOldIdx = ranked.findIndex((m: any) => m.id === "very-old");
    assert(oneWeekIdx < veryOldIdx, "1-week-old memory should rank above 2-week-old");
  });

  // ── 16. Adaptive token budget ──
  await test("Phase 2.3: Adaptive token budget scales with context size", async () => {
    const { MemoryInjector } = await import("./src/memory/injection.js");

    const mockRetriever = {
      search: async () => [],
      searchByTag: async () => [],
      searchRecent: async () => [],
      searchCrossAgent: async () => [],
      stats: async () => ({}),
      agentStats: async () => ({ total: 0, perAgent: {} }),
    };

    const injector = new (MemoryInjector as any)(mockRetriever);

    // Small context — should use full budget
    const smallResult = await injector.injectForSession(
      "test", "small query",
      "x".repeat(1000), // ~250 tokens
      "x".repeat(1000), // ~250 tokens
    );
    assert(smallResult.token_budget_remaining > 6000, `Small context should leave >6000 budget, got ${smallResult.token_budget_remaining}`);

    // Large context — should reduce budget
    const largeResult = await injector.injectForSession(
      "test", "large query",
      "x".repeat(100000), // ~25000 tokens
      "x".repeat(20000),  // ~5000 tokens
    );
    assert(largeResult.token_budget_remaining <= 4000, `Large context should reduce budget to <=4000, got ${largeResult.token_budget_remaining}`);

    // Very large context — should reduce further
    const hugeResult = await injector.injectForSession(
      "test", "huge query",
      "x".repeat(120000), // ~30000 tokens
      "x".repeat(20000),  // ~5000 tokens
    );
    assert(hugeResult.token_budget_remaining <= 2000, `Huge context should reduce budget to <=2000, got ${hugeResult.token_budget_remaining}`);
  });

  // ── 17. injectForSession searches cross-scope ──
  await test("Phase 2.4: injectForSession searches personal+project scopes", async () => {
    const { MemoryInjector } = await import("./src/memory/injection.js");

    let lastQuery: any = null;
    const mockRetriever = {
      search: async (query: any) => { lastQuery = query; return []; },
      searchByTag: async () => [],
      searchRecent: async () => [],
      searchCrossAgent: async () => [],
      stats: async () => ({}),
      agentStats: async () => ({ total: 0, perAgent: {} }),
    };

    const injector = new (MemoryInjector as any)(mockRetriever);
    await injector.injectForSession("test-agent", "test query", "system", "wake");

    assert(lastQuery !== null, "Should have called search");
    assert(lastQuery.scopes.includes("personal"), "Should search personal scope");
    assert(lastQuery.scopes.includes("project"), "Should search project scope");
    assert(lastQuery.min_importance === 0.3, "Should filter by min_importance 0.3");
    assert(lastQuery.top_k === 15, "Should fetch top 15 for re-ranking");
  });

  // ── 18. injectForProactiveWork searches cross-scope ──
  await test("Phase 2.5: injectForProactiveWork searches personal+project scopes", async () => {
    const { MemoryInjector } = await import("./src/memory/injection.js");

    let lastQuery: any = null;
    const mockRetriever = {
      search: async (query: any) => { lastQuery = query; return []; },
      searchByTag: async () => [],
      searchRecent: async () => [],
      searchCrossAgent: async () => [],
      stats: async () => ({}),
      agentStats: async () => ({ total: 0, perAgent: {} }),
    };

    const injector = new (MemoryInjector as any)(mockRetriever);
    await injector.injectForProactiveWork("test-agent", "domain context");

    assert(lastQuery !== null, "Should have called search");
    assert(lastQuery.scopes.includes("personal"), "Should search personal scope");
    assert(lastQuery.scopes.includes("project"), "Should search project scope");
    assert(lastQuery.min_importance === 0.3, "Should filter by min_importance 0.3");
  });

  // ── 19. injectForSession filters passive memories ──
  await test("Phase 2.6: injectForSession filters passive memories", async () => {
    const { MemoryInjector } = await import("./src/memory/injection.js");

    const now = Date.now();
    const passiveMemories = [
      { id: "passive1", ts: now, content: "same as before", importance: 0.5, type: "note", scope: "personal", kind: "semantic" as const, agent_id: "test", content_hash: "a", original_importance: 0.5, tags: [], ttl_ms: null, decay_rate: 0.5, source: "manual" as const, vector: [0.1] },
      { id: "active1", ts: now, content: "Found 3 overdue tasks", importance: 0.9, type: "decision", scope: "personal", kind: "semantic" as const, agent_id: "test", content_hash: "b", original_importance: 0.9, tags: [], ttl_ms: null, decay_rate: 0.5, source: "manual" as const, vector: [0.2] },
      { id: "passive2", ts: now, content: "nothing new to flag", importance: 0.5, type: "note", scope: "personal", kind: "semantic" as const, agent_id: "test", content_hash: "c", original_importance: 0.5, tags: [], ttl_ms: null, decay_rate: 0.5, source: "manual" as const, vector: [0.3] },
    ];

    const mockRetriever = {
      search: async () => passiveMemories,
      searchByTag: async () => [],
      searchRecent: async () => [],
      searchCrossAgent: async () => [],
      stats: async () => ({}),
      agentStats: async () => ({ total: 0, perAgent: {} }),
    };

    const injector = new (MemoryInjector as any)(mockRetriever);
    const result = await injector.injectForSession("test", "query", "system", "wake");

    const hasPassive = result.relevant_memories.some((m: any) => m.content.includes("same as before") || m.content.includes("nothing new"));
    assert(!hasPassive, "Should filter out passive memories from injection result");
  });

  // ── 20. Retrieval stats() doesn't call count() redundantly ──
  await test("Phase 2.7: stats() uses efficient per-agent counting", async () => {
    const { MemoryRetriever } = await import("./src/memory/retrieval.js");

    let getAllCallCount = 0;
    let countCallCount = 0;

    const mockStore = {
      insert: async () => {},
      search: async () => [],
      count: async () => { countCallCount++; return 0; },
      getAll: async (scope: string) => {
        getAllCallCount++;
        if (scope === "personal") {
          return [
            { agent_id: "agent1" },
            { agent_id: "agent1" },
            { agent_id: "agent2" },
          ];
        }
        return [];
      },
      decay: async () => 0,
      deleteById: async () => 1,
      deleteExpired: async () => 0,
    };

    const mockEmbedder = { embed: async () => [0.1, 0.2, 0.3] };

    const retriever = new (MemoryRetriever as any)(mockStore, mockEmbedder);
    const stats = await retriever.stats();

    assert(countCallCount === 0, `stats() should not call count(), got ${countCallCount} calls`);
    assert(getAllCallCount === 3, `stats() should call getAll() once per scope (3), got ${getAllCallCount}`);
    assert(stats.personal.total === 3, `Personal total should be 3, got ${stats.personal.total}`);
    assert(stats.personal.perAgent.agent1 === 2, "Agent1 should have 2 memories");
    assert(stats.personal.perAgent.agent2 === 1, "Agent2 should have 1 memory");
  });

  // ============================================================
  // Phase 3: Workspace Caching + Security
  // ============================================================

  // ── 21. Workspace state tracking — getWorkspaceState ──
  await test("Phase 3.1: getWorkspaceState returns valid state", async () => {
    const wm = await import("./src/agents/workspace-manager.js");

    const state = wm.getWorkspaceState("ceo-strategic");
    assert(state !== null, "State should exist for ceo-strategic");
    assert(state?.version === 2, "State version should be 2");
    assert(typeof state?.bootstrapSeededAt === "string", "bootstrapSeededAt should be a string");
    assert(typeof state?.lastFileChange === "object", "lastFileChange should be an object");
  });

  // ── 22. markSetupComplete updates state ──
  await test("Phase 3.2: markSetupComplete sets setupCompletedAt", async () => {
    const wm = await import("./src/agents/workspace-manager.js");

    wm.markSetupComplete("coo-productivity");
    const state = wm.getWorkspaceState("coo-productivity");
    assert(state !== null, "State should exist");
    assert(typeof state?.setupCompletedAt === "string", "setupCompletedAt should be set");
  });

  // ── 23. loadBootstrapFiles uses cached reads ──
  await test("Phase 3.3: loadBootstrapFiles returns all 8 core files", async () => {
    const wm = await import("./src/agents/workspace-manager.js");

    const files = wm.loadBootstrapFiles("ceo-strategic");
    assert(files.length === 8, `Should load 8 files, got ${files.length}`);

    const missing = files.filter(f => f.missing);
    if (missing.length > 0) {
      // Some files might be missing — that's OK, just verify structure
      assert(missing.every(f => f.content === ""), "Missing files should have empty content");
    }

    const present = files.filter(f => !f.missing);
    assert(present.length > 0, "At least some files should be present");
    present.forEach(f => {
      assert(f.content.length > 0, `File ${f.name} should have content`);
      assert(typeof f.path === "string", `File ${f.name} should have a path`);
    });
  });

  // ── 24. getCoreFile respects security guards ──
  await test("Phase 3.4: getCoreFile validates path security", async () => {
    const wm = await import("./src/agents/workspace-manager.js");

    // Valid core file
    const agents = wm.getCoreFile("ceo-strategic", "AGENTS.md");
    assert(agents !== null, "Should return AGENTS.md content");

    // Invalid filename
    const invalid = wm.getCoreFile("strategos", "../../../../etc/passwd");
    assert(invalid === null, "Should reject path traversal attempts");
  });

  // ── 25. updateCoreFile tracks state changes ──
  await test("Phase 3.5: updateCoreFile updates lastFileChange", async () => {
    const wm = await import("./src/agents/workspace-manager.js");

    const beforeState = wm.getWorkspaceState("cio-intelligence");
    assert(beforeState !== null, "State should exist before update");

    wm.updateCoreFile("cio-intelligence", "TOOLS.md", "# Updated tools\nTest content");

    const afterState = wm.getWorkspaceState("cio-intelligence");
    assert(afterState !== null, "State should exist after update");
    assert(afterState?.lastFileChange["TOOLS.md"] !== undefined, "TOOLS.md should be tracked");

    const beforeTime = beforeState?.lastFileChange?.["TOOLS.md"] || "";
    const afterTime = afterState?.lastFileChange?.["TOOLS.md"] || "";
    assert(afterTime >= beforeTime, "Timestamp should be updated or equal");

    // Restore original
    const tools = wm.getCoreFile("cio-intelligence", "TOOLS.md");
    if (tools) {
      wm.updateCoreFile("cio-intelligence", "TOOLS.md", tools);
    }
  });

  // ── 26. Cache identity changes on file write ──
  await test("Phase 3.6: File cache identity changes after write", async () => {
    const wm = await import("./src/agents/workspace-manager.js");

    const content1 = wm.getCoreFile("physician-health", "MEMORY.md");
    assert(content1 !== null, "MEMORY.md should exist");

    const newContent = "# Updated memory\nDifferent content for cache test";
    wm.updateCoreFile("physician-health", "MEMORY.md", newContent);

    const content2 = wm.getCoreFile("physician-health", "MEMORY.md");
    assert(content2 === newContent, "Should return updated content (cache invalidated)");

    // Restore
    if (content1) {
      wm.updateCoreFile("physician-health", "MEMORY.md", content1);
    }
  });

  // ── 27. updateCoreFile rejects path traversal ──
  await test("Phase 3.7: updateCoreFile rejects path traversal", async () => {
    const wm = await import("./src/agents/workspace-manager.js");

    let threw = false;
    try {
      wm.updateCoreFile("ceo-strategic", "../../etc/passwd", "malicious");
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("Path traversal") || e.message.includes("Invalid"), `Should reject traversal, got: ${e.message}`);
    }
    assert(threw, "Should throw on path traversal");
  });

  // ============================================================
  // Report
  // ============================================================
  console.log("\n" + "=".repeat(70));
  console.log("VERIFICATION TEST RESULTS");
  console.log("=".repeat(70) + "\n");

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.pass) {
      console.log(`[PASS] ${r.name}`);
      passed++;
    } else {
      console.log(`[FAIL] ${r.name}`);
      console.log(`       → ${r.reason}`);
      failed++;
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log("=".repeat(70) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err: Error) => {
  console.error("Test runner error:", err.message);
  process.exit(1);
});
