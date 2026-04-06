import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createFsReadTool } from "../runtime/tools/fs-read";
import { createFsWriteTool } from "../runtime/tools/fs-write";
import { createFsEditTool } from "../runtime/tools/fs-edit";
import { createBashTool } from "../runtime/tools/bash-exec";

const workspaceBase = path.join(os.tmpdir(), ".strategos-test-home");

function setupTestWorkspace() {
  const agentDir = path.join(workspaceBase, ".strategos", "agents", "test-agent");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "MEMORY.md"), "# Memory\ntest content", "utf-8");
  process.env.HOME = workspaceBase;
}

function cleanupTestWorkspace() {
  fs.rmSync(workspaceBase, { recursive: true, force: true });
}

describe("fs.read tool", () => {
  beforeEach(() => {
    cleanupTestWorkspace();
    setupTestWorkspace();
  });

  afterEach(() => {
    cleanupTestWorkspace();
  });

  test("reads file within workspace", async () => {
    const tool = createFsReadTool();
    const result = await tool.execute("call-1", { file_path: "MEMORY.md", agent_id: "test-agent" });
    expect(result.content[0].text).toContain("# Memory");
    expect(result.content[0].text).toContain("test content");
  });

  test("rejects path traversal", async () => {
    const tool = createFsReadTool();
    const result = await tool.execute("call-1", { file_path: "../etc/passwd", agent_id: "test-agent" });
    expect(result.content[0].text).toContain("Path traversal not allowed");
  });

  test("reports file not found", async () => {
    const tool = createFsReadTool();
    const result = await tool.execute("call-1", { file_path: "nonexistent.md", agent_id: "test-agent" });
    expect(result.content[0].text).toContain("File not found");
  });
});

describe("fs.write tool", () => {
  beforeEach(() => {
    cleanupTestWorkspace();
    setupTestWorkspace();
  });

  afterEach(() => {
    cleanupTestWorkspace();
  });

  test("writes new file", async () => {
    const tool = createFsWriteTool();
    const result = await tool.execute("call-1", {
      file_path: "NEW_FILE.md",
      content: "# New File\nCreated by agent.",
      agent_id: "test-agent",
    });
    expect(result.content[0].text).toContain("Wrote");
    const agentDir = path.join(workspaceBase, ".strategos", "agents", "test-agent");
    expect(fs.existsSync(path.join(agentDir, "NEW_FILE.md"))).toBe(true);
    expect(fs.readFileSync(path.join(agentDir, "NEW_FILE.md"), "utf-8")).toContain("# New File");
  });

  test("appends to existing file", async () => {
    const writeTool = createFsWriteTool();
    await writeTool.execute("call-1", { file_path: "MEMORY.md", content: "initial", agent_id: "test-agent" });
    const result = await writeTool.execute("call-2", {
      file_path: "MEMORY.md",
      content: "\nappended",
      agent_id: "test-agent",
      append: true,
    });
    expect(result.content[0].text).toContain("Appended");
    const agentDir = path.join(workspaceBase, ".strategos", "agents", "test-agent");
    const content = fs.readFileSync(path.join(agentDir, "MEMORY.md"), "utf-8");
    expect(content).toContain("initial");
    expect(content).toContain("appended");
  });

  test("rejects path traversal", async () => {
    const tool = createFsWriteTool();
    const result = await tool.execute("call-1", {
      file_path: "../../../etc/evil.sh",
      content: "rm -rf /",
      agent_id: "test-agent",
    });
    expect(result.content[0].text).toContain("Path traversal not allowed");
  });
});

describe("fs.edit tool", () => {
  beforeEach(() => {
    cleanupTestWorkspace();
    setupTestWorkspace();
  });

  afterEach(() => {
    cleanupTestWorkspace();
  });

  test("edits file content", async () => {
    const agentDir = path.join(workspaceBase, ".strategos", "agents", "test-agent");
    fs.writeFileSync(path.join(agentDir, "MEMORY.md"), "# Memory\n\n## Section A\nOld content here.\n\n## Section B\nKeep this.\n", "utf-8");

    const tool = createFsEditTool();
    const result = await tool.execute("call-1", {
      file_path: "MEMORY.md",
      old_string: "Old content here.",
      new_string: "Updated content.",
      agent_id: "test-agent",
    });
    expect(result.content[0].text).toContain("Edited");

    const updated = fs.readFileSync(path.join(agentDir, "MEMORY.md"), "utf-8");
    expect(updated).toContain("Updated content.");
    expect(updated).toContain("Keep this.");
  });

  test("rejects when old_string not found", async () => {
    const tool = createFsEditTool();
    const result = await tool.execute("call-1", {
      file_path: "MEMORY.md",
      old_string: "does not exist in file",
      new_string: "replacement",
      agent_id: "test-agent",
    });
    expect(result.content[0].text).toContain("not found");
  });

  test("rejects when old_string appears multiple times", async () => {
    const agentDir = path.join(workspaceBase, ".strategos", "agents", "test-agent");
    fs.writeFileSync(path.join(agentDir, "MEMORY.md"), "duplicate\nduplicate\n", "utf-8");

    const tool = createFsEditTool();
    const result = await tool.execute("call-1", {
      file_path: "MEMORY.md",
      old_string: "duplicate",
      new_string: "unique",
      agent_id: "test-agent",
    });
    expect(result.content[0].text).toContain("appears");
    expect(result.content[0].text).toContain("times");
  });
});

describe("bash tool", () => {
  beforeEach(() => {
    cleanupTestWorkspace();
    setupTestWorkspace();
  });

  afterEach(() => {
    cleanupTestWorkspace();
  });

  test("executes allowed command", async () => {
    const agentDir = path.join(workspaceBase, ".strategos", "agents", "test-agent");
    fs.writeFileSync(path.join(agentDir, "test.txt"), "hello", "utf-8");

    const tool = createBashTool();
    const result = await tool.execute("call-1", {
      command: "cat",
      args: ["test.txt"],
      agent_id: "test-agent",
    });
    expect(result.content[0].text).toContain("hello");
  });

  test("rejects disallowed command", async () => {
    const tool = createBashTool();
    const result = await tool.execute("call-1", {
      command: "iptables",
      agent_id: "test-agent",
    });
    expect(result.content[0].text).toContain("not in the allowlist");
  });

  test("runs within workspace directory", async () => {
    const tool = createBashTool();
    const result = await tool.execute("call-1", {
      command: "pwd",
      agent_id: "test-agent",
    });
    expect(result.content[0].text).toContain("test-agent");
  });
});
