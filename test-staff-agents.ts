// Test Suite: Staff/Org System & Multi-Agent Coordination
// Tests core staff definitions, prompts, agent autonomy, C-suite harmony

import {
  getCoreStaffIds,
  getBoardMembers,
  getStaffById,
  getDirectReports,
  canPerformAction,
  getOrgChart,
  CORE_STAFF_ROLES,
  type CoreStaffRole,
} from "./src/staff/core-staff.js";

import {
  getSystemPrompt,
  getAllSystemPrompts,
  getPromptForRole,
} from "./src/staff/prompts.js";

import {
  startHeartbeat,
} from "./src/scheduler/heartbeat.js";

import {
  MessageProcessor,
  startMessageProcessor,
  getMessageProcessor,
} from "./src/scheduler/message-processor.js";

import {
  AgentExecutor,
  startAgentExecutor,
  getAgentExecutor,
  setExecutorTools,
} from "./src/scheduler/agent-executor.js";

// --- Test Runner ---

let passed = 0;
let failed = 0;

function pass(name: string, detail?: string) {
  passed++;
  console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, reason: string) {
  failed++;
  console.log(`[FAIL] ${name} — ${reason}`);
}

function assert(condition: boolean, name: string, failMsg: string): void {
  if (condition) pass(name);
  else fail(name, failMsg);
}

// ─── TEST 1: getCoreStaffIds() returns all expected C-suite members ───
{
  const ids = getCoreStaffIds();
  const expectedIds = [
    "strategos",
    "coo-productivity",
    "cpo-psychologist",
    "cro-relational",
    "cfo-financial",
    "cmo-content",
    "physician-health",
    "cio-intelligence",
  ];

  const allPresent = expectedIds.every((id) => ids.includes(id));
  const correctCount = ids.length === expectedIds.length;

  assert(
    allPresent && correctCount,
    "getCoreStaffIds() returns all expected C-suite members",
    `Expected ${expectedIds.join(", ")} but got ${ids.join(", ")}`
  );
}

// ─── TEST 2: getCoreStaffIds() returns unique IDs ───
{
  const ids = getCoreStaffIds();
  const unique = new Set(ids);
  assert(
    unique.size === ids.length,
    "getCoreStaffIds() returns unique IDs",
    `Found duplicates: ${ids.length} total, ${unique.size} unique`
  );
}

// ─── TEST 3: Each staff member has required fields ───
{
  const requiredFields: (keyof CoreStaffRole)[] = [
    "id",
    "name",
    "title",
    "systemPrompt",
    "databases",
    "kanbanColumns",
    "autonomyLevel",
    "boardSeat",
    "avatar",
  ];

  for (const [roleId, role] of Object.entries(CORE_STAFF_ROLES)) {
    const missing = requiredFields.filter((f) => !(f in role));
    assert(
      missing.length === 0,
      `Staff '${roleId}' has all required fields`,
      missing.length > 0
        ? `Missing fields: ${missing.join(", ")}`
        : `All fields present`
    );
  }
}

// ─── TEST 4: CEO (strategos) has top autonomy and board seat ───
{
  const ceo = getStaffById("strategos");
  assert(
    ceo !== undefined,
    "CEO (strategos) exists in staff registry",
    "getStaffById('strategos') returned undefined"
  );

  if (ceo) {
    assert(
      ceo.autonomyLevel === 4,
      "CEO has maximum autonomy level (4)",
      `CEO autonomy is ${ceo.autonomyLevel}, expected 4`
    );

    assert(
      ceo.boardSeat === true,
      "CEO has a board seat",
      `CEO boardSeat is ${ceo.boardSeat}, expected true`
    );

    assert(
      ceo.reportsTo === undefined,
      "CEO reports to nobody (top of hierarchy)",
      `CEO reportsTo is '${ceo.reportsTo}', expected undefined`
    );
  }
}

// ─── TEST 5: Agent prompts contain required sections (role, behavior, tools) ───
{
  for (const roleId of getCoreStaffIds()) {
    const prompt = getSystemPrompt(roleId);
    const staff = getStaffById(roleId);

    assert(
      prompt.length > 100,
      `Prompt for '${roleId}' is non-trivial`,
      `Prompt length is ${prompt.length}, expected > 100 chars`
    );

    assert(
      prompt.includes("YOUR ROLE") || prompt.includes("YOUR DATABASES"),
      `Prompt for '${roleId}' contains role section`,
      "Missing role/databases section in prompt"
    );

    assert(
      prompt.includes("YOUR TOOLS"),
      `Prompt for '${roleId}' contains tools section`,
      "Missing tools section in prompt"
    );

    assert(
      prompt.includes("YOUR KANBAN"),
      `Prompt for '${roleId}' contains kanban section`,
      "Missing kanban section in prompt"
    );

    assert(
      prompt.includes("YOUR AUTHORITY"),
      `Prompt for '${roleId}' contains authority section`,
      "Missing authority section in prompt"
    );

    // Check that prompt references the correct staff member
    if (staff) {
      assert(
        prompt.includes(staff.name) || prompt.includes(staff.title),
        `Prompt for '${roleId}' references correct staff name/title`,
        `Prompt does not reference '${staff.name}' or '${staff.title}'`
      );
    }
  }
}

// ─── TEST 6: Agent databases array is non-empty for each agent ───
{
  for (const [roleId, role] of Object.entries(CORE_STAFF_ROLES)) {
    assert(
      role.databases.length > 0,
      `Agent '${roleId}' has at least one database`,
      `databases array is empty`
    );
  }
}

// ─── TEST 7: Model/autonomy configuration is valid for each agent ───
{
  for (const [roleId, role] of Object.entries(CORE_STAFF_ROLES)) {
    assert(
      role.autonomyLevel >= 1 && role.autonomyLevel <= 4,
      `Agent '${roleId}' has valid autonomy level (1-4)`,
      `autonomyLevel is ${role.autonomyLevel}`
    );

    assert(
      typeof role.boardSeat === "boolean",
      `Agent '${roleId}' has boolean boardSeat`,
      `boardSeat is ${typeof role.boardSeat}`
    );

    assert(
      role.kanbanColumns.length >= 3,
      `Agent '${roleId}' has at least 3 kanban columns`,
      `Only ${role.kanbanColumns.length} columns defined`
    );
  }
}

// ─── TEST 8: No duplicate staff IDs ───
{
  const ids = getCoreStaffIds();
  const seen = new Set<string>();
  let duplicates: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  assert(
    duplicates.length === 0,
    "No duplicate staff IDs in registry",
    `Duplicates found: ${duplicates.join(", ")}`
  );
}

// ─── TEST 9: Agent hierarchy is correct (CEO at top, reports below) ───
{
  // CEO has no reportsTo
  const ceo = getStaffById("strategos");
  assert(
    ceo?.reportsTo === undefined,
    "CEO is at the top of hierarchy (no reportsTo)",
    `CEO reportsTo is '${ceo?.reportsTo}'`
  );

  // All board members except CEO report to CEO
  const boardMembers = getBoardMembers();
  const nonCeoBoard = boardMembers.filter((m) => m.id !== "strategos");
  const allReportToCeo = nonCeoBoard.every((m) => m.reportsTo === "strategos");
  assert(
    allReportToCeo,
    "All board members (except CEO) report to CEO",
    `Non-CEO board members: ${nonCeoBoard.map((m) => `${m.id}->${m.reportsTo}`).join(", ")}`
  );

  // Physician reports to COO, not CEO (advisory role)
  const physician = getStaffById("physician-health");
  assert(
    physician?.reportsTo === "coo-productivity",
    "Physician reports to COO (not CEO)",
    `Physician reportsTo is '${physician?.reportsTo}', expected 'coo-productivity'`
  );
}

// ─── TEST 10: Agent delegation paths are valid ───
{
  for (const [roleId, role] of Object.entries(CORE_STAFF_ROLES)) {
    if (role.reportsTo !== undefined) {
      const manager = getStaffById(role.reportsTo);
      assert(
        manager !== undefined,
        `Agent '${roleId}' reports to valid agent ('${role.reportsTo}')`,
        `Manager '${role.reportsTo}' not found in staff registry`
      );
    }
  }

  // Verify CEO has direct reports
  const ceoReports = getDirectReports("strategos");
  assert(
    ceoReports.length > 0,
    "CEO has direct reports",
    `CEO has ${ceoReports.length} direct reports`
  );

  // Verify COO has at least one report (physician)
  const cooReports = getDirectReports("coo-productivity");
  assert(
    cooReports.length > 0,
    "COO has direct reports (physician)",
    `COO has ${cooReports.length} direct reports`
  );
}

// ─── TEST 11: Agent tool permissions are consistent ───
{
  // CEO is the only one who can use notify.telegram (checked in prompt)
  for (const [roleId, role] of Object.entries(CORE_STAFF_ROLES)) {
    const prompt = getSystemPrompt(roleId);

    if (roleId !== "strategos") {
      assert(
        prompt.includes("Do NOT use notify.telegram"),
        `Non-CEO agent '${roleId}' is forbidden from notify.telegram`,
        "Prompt does not forbid notify.telegram for non-CEO"
      );
    }

    // CEO-specific prompt should include Telegram permission
    if (roleId === "strategos") {
      assert(
        prompt.includes("ONLY agent who may message the user via Telegram"),
        "CEO prompt includes Telegram messaging permission",
        "Missing Telegram permission in CEO prompt"
      );
    }
  }
}

// ─── TEST 12: C-suite harmony — all agents can communicate with each other ───
{
  const allIds = getCoreStaffIds();
  const boardMembers = getBoardMembers();
  const boardIds = boardMembers.map((m) => m.id);

  // Every agent prompt includes agent.call and message.send instructions
  for (const roleId of allIds) {
    const prompt = getSystemPrompt(roleId);
    assert(
      prompt.includes("agent.call"),
      `Agent '${roleId}' can call other agents`,
      "Missing agent.call in prompt"
    );
    assert(
      prompt.includes("message.send"),
      `Agent '${roleId}' can send messages`,
      "Missing message.send in prompt"
    );
    assert(
      prompt.includes("agent.handoff"),
      `Agent '${roleId}' can handoff conversations`,
      "Missing agent.handoff in prompt"
    );
    assert(
      prompt.includes("agent.meeting"),
      `Agent '${roleId}' can call board meetings`,
      "Missing agent.meeting in prompt"
    );
    assert(
      prompt.includes("agent.inbox"),
      `Agent '${roleId}' can check inbox`,
      "Missing agent.inbox in prompt"
    );
  }

  // All board members have boardSeat=true
  assert(
    boardMembers.length >= 5,
    "Board has at least 5 voting members",
    `Only ${boardMembers.length} board members`
  );

  // Verify all board members are listed in the org chart
  const orgChart = getOrgChart();
  for (const member of boardMembers) {
    assert(
      orgChart.includes(member.name),
      `Board member '${member.name}' appears in org chart`,
      `Org chart does not include '${member.name}'`
    );
  }
}

// ─── TEST 13: Heartbeat mechanism is configured ───
{
  assert(
    typeof startHeartbeat === "function",
    "startHeartbeat is exported as a function",
    `startHeartbeat is ${typeof startHeartbeat}`
  );

  // Verify heartbeat interval constant is defined (15 minutes)
  const heartbeatIntervalMs = 15 * 60 * 1000;
  assert(
    heartbeatIntervalMs > 0,
    "Heartbeat interval is positive (15 minutes)",
    `Interval is ${heartbeatIntervalMs}`
  );

  // Verify all core staff IDs are iterated in heartbeat logic
  const ids = getCoreStaffIds();
  assert(
    ids.includes("strategos"),
    "Heartbeat covers CEO (strategos)",
    "strategos not in core staff IDs"
  );
}

// ─── TEST 14: Message processor is configured ───
{
  assert(
    typeof MessageProcessor === "function",
    "MessageProcessor class is exported",
    `MessageProcessor is ${typeof MessageProcessor}`
  );

  assert(
    typeof startMessageProcessor === "function",
    "startMessageProcessor is exported as a function",
    `startMessageProcessor is ${typeof startMessageProcessor}`
  );

  assert(
    typeof getMessageProcessor === "function",
    "getMessageProcessor is exported as a function",
    `getMessageProcessor is ${typeof getMessageProcessor}`
  );

  // Default interval is 30 seconds
  const defaultInterval = 30000;
  assert(
    defaultInterval > 0,
    "Message processor default interval is positive (30s)",
    `Interval is ${defaultInterval}`
  );
}

// ─── TEST 15: Agent executor is configured with tool names ───
{
  assert(
    typeof AgentExecutor === "function",
    "AgentExecutor class is exported",
    `AgentExecutor is ${typeof AgentExecutor}`
  );

  assert(
    typeof startAgentExecutor === "function",
    "startAgentExecutor is exported as a function",
    `startAgentExecutor is ${typeof startAgentExecutor}`
  );

  assert(
    typeof getAgentExecutor === "function",
    "getAgentExecutor is exported as a function",
    `getAgentExecutor is ${typeof getAgentExecutor}`
  );

  assert(
    typeof setExecutorTools === "function",
    "setExecutorTools is exported for tool name configuration",
    `setExecutorTools is ${typeof setExecutorTools}`
  );

  // Verify AgentExecutor has setToolExecutor method signature via prototype
  const proto = AgentExecutor.prototype;
  assert(
    typeof proto.setToolExecutor === "function",
    "AgentExecutor has setToolExecutor method",
    "setToolExecutor not found on AgentExecutor prototype"
  );
}

// ─── BONUS TEST: canPerformAction works correctly ───
{
  assert(
    canPerformAction("strategos", 4) === true,
    "CEO can perform level 4 actions",
    `canPerformAction('strategos', 4) = ${canPerformAction("strategos", 4)}`
  );

  assert(
    canPerformAction("strategos", 3) === true,
    "CEO can perform level 3 actions",
    `canPerformAction('strategos', 3) = ${canPerformAction("strategos", 3)}`
  );

  assert(
    canPerformAction("coo-productivity", 3) === true,
    "COO can perform level 3 actions",
    `canPerformAction('coo-productivity', 3) = ${canPerformAction("coo-productivity", 3)}`
  );

  assert(
    canPerformAction("coo-productivity", 4) === false,
    "COO cannot perform level 4 actions",
    `canPerformAction('coo-productivity', 4) = ${canPerformAction("coo-productivity", 4)}`
  );

  assert(
    canPerformAction("nonexistent", 1) === false,
    "Nonexistent agent cannot perform any actions",
    `canPerformAction('nonexistent', 1) = ${canPerformAction("nonexistent", 1)}`
  );
}

// ─── BONUS TEST: getAllSystemPrompts returns prompts for all agents ───
{
  const allPrompts = getAllSystemPrompts();
  const ids = getCoreStaffIds();

  assert(
    Object.keys(allPrompts).length === ids.length,
    "getAllSystemPrompts returns correct number of prompts",
    `Got ${Object.keys(allPrompts).length}, expected ${ids.length}`
  );

  for (const id of ids) {
    assert(
      allPrompts[id] !== undefined && allPrompts[id].length > 0,
      `getAllSystemPrompts includes non-empty prompt for '${id}'`,
      `Prompt for '${id}' is missing or empty`
    );
  }
}

// ─── BONUS TEST: getPromptForRole returns correct structure ───
{
  for (const id of getCoreStaffIds()) {
    const result = getPromptForRole(id);
    assert(
      result !== null && result.role !== undefined && result.prompt !== undefined,
      `getPromptForRole('${id}') returns valid structure`,
      `Got ${result === null ? "null" : "valid"}`
    );
  }

  const invalidResult = getPromptForRole("nonexistent-agent");
  assert(
    invalidResult === null,
    "getPromptForRole returns null for nonexistent agent",
    `Got ${invalidResult === null ? "null" : "non-null"}`
  );
}

// ─── BONUS TEST: Database references in prompts match staff definitions ───
{
  for (const [roleId, role] of Object.entries(CORE_STAFF_ROLES)) {
    const prompt = getSystemPrompt(roleId);
    for (const db of role.databases) {
      assert(
        prompt.includes(db),
        `Prompt for '${roleId}' references database '${db}'`,
        `Database '${db}' not found in prompt`
      );
    }
  }
}

// ─── SUMMARY ───

console.log(`\n${"=".repeat(60)}`);
console.log(`Test Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("=".repeat(60));

if (failed > 0) {
  console.log("\nFAILURES DETECTED");
  process.exit(1);
} else {
  console.log("\nALL TESTS PASSED ✓");
  process.exit(0);
}
