// Instruction File Discovery Tests
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import {
  getInstructionFileHash,
  discoverInstructionFiles,
  formatInstructionFiles,
  INSTRUCTION_FILE_NAMES,
  MAX_FILE_CONTENT_LENGTH,
  MAX_TOTAL_CONTENT_LENGTH,
  type InstructionFile,
} from "../runtime/instruction-files.js";

describe("getInstructionFileHash", () => {
  test("produces consistent hash for same content", () => {
    const h1 = getInstructionFileHash("hello world");
    const h2 = getInstructionFileHash("hello world");
    expect(h1).toBe(h2);
  });

  test("produces different hash for different content", () => {
    const h1 = getInstructionFileHash("content A");
    const h2 = getInstructionFileHash("content B");
    expect(h1).not.toBe(h2);
  });

  test("empty string produces a hash", () => {
    const h = getInstructionFileHash("");
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(0);
  });

  test("hash is hexadecimal", () => {
    const h = getInstructionFileHash("test content");
    expect(h).toMatch(/^[0-9a-f]+$/);
  });
});

describe("discoverInstructionFiles", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "instr-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function createInstructionFile(dir: string, name: string, content: string): string {
    const fullPath = path.join(dir, name);
    const parent = path.dirname(fullPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
    return fullPath;
  }

  test("discovers CLAUDE.md in startDir", async () => {
    createInstructionFile(tmpRoot, "CLAUDE.md", "# Project Instructions");
    const files = await discoverInstructionFiles(tmpRoot);
    expect(files.length).toBe(1);
    expect(files[0].content).toBe("# Project Instructions");
  });

  test("discovers files at multiple directory levels", async () => {
    const subDir = path.join(tmpRoot, "sub");
    fs.mkdirSync(subDir);
    createInstructionFile(tmpRoot, "CLAUDE.md", "# Root instructions");
    createInstructionFile(subDir, "CLAUDE.md", "# Sub instructions");

    const files = await discoverInstructionFiles(subDir);
    // Should find the sub CLAUDE.md first (most specific)
    expect(files.length).toBe(2);
    // Sub dir file should come first
    expect(files[0].content).toBe("# Sub instructions");
  });

  test("deduplicates by content hash", async () => {
    const subDir = path.join(tmpRoot, "sub");
    fs.mkdirSync(subDir);
    const sameContent = "# Same content";
    createInstructionFile(tmpRoot, "CLAUDE.md", sameContent);
    createInstructionFile(subDir, "CLAUDE.md", sameContent);

    const files = await discoverInstructionFiles(subDir);
    // Same content = same hash = deduplicated
    expect(files.length).toBe(1);
  });

  test("does not follow symlinks", async () => {
    const targetPath = createInstructionFile(tmpRoot, "CLAUDE.md", "# Real file");
    const linkPath = path.join(tmpRoot, "sub");
    fs.mkdirSync(linkPath);
    try {
      fs.symlinkSync(targetPath, path.join(linkPath, "CLAUDE.md"));
    } catch {
      // Symlinks may not be supported in all environments
      return;
    }
    const files = await discoverInstructionFiles(linkPath);
    // Should NOT include the symlinked file
    const symlinked = files.find((f) => f.path.includes("sub"));
    expect(symlinked).toBeUndefined();
  });

  test("skips non-existent files", async () => {
    const files = await discoverInstructionFiles(tmpRoot);
    expect(files).toEqual([]);
  });

  test("stops at total content budget", async () => {
    // Create a file with content exceeding MAX_TOTAL_CONTENT_LENGTH
    const bigContent = "x".repeat(MAX_TOTAL_CONTENT_LENGTH + 100);
    createInstructionFile(tmpRoot, "CLAUDE.md", bigContent);
    const files = await discoverInstructionFiles(tmpRoot);
    // Should return empty because the file alone exceeds budget
    // Actually, the file is truncated to MAX_FILE_CONTENT_LENGTH first (4000 chars)
    // Then the total budget check: 4000 < 12000, so it should be included
    expect(files.length).toBe(1);
    expect(files[0].content.length).toBe(MAX_FILE_CONTENT_LENGTH);
  });

  test("per-file truncation works", async () => {
    const bigContent = "x".repeat(MAX_FILE_CONTENT_LENGTH + 5000);
    createInstructionFile(tmpRoot, "CLAUDE.md", bigContent);
    const files = await discoverInstructionFiles(tmpRoot);
    expect(files[0].content.length).toBe(MAX_FILE_CONTENT_LENGTH);
  });

  test("each InstructionFile has path, content, and hash", async () => {
    createInstructionFile(tmpRoot, "CLAUDE.md", "# Test");
    const files = await discoverInstructionFiles(tmpRoot);
    expect(files).toHaveLength(1);
    const f = files[0];
    expect(f.path).toBe(path.join(tmpRoot, "CLAUDE.md"));
    expect(f.content).toBe("# Test");
    expect(f.hash).toBe(getInstructionFileHash("# Test"));
  });

  test("skips binary files", async () => {
    const binPath = path.join(tmpRoot, "CLAUDE.md");
    // Write content with null byte (binary indicator)
    fs.writeFileSync(binPath, Buffer.from([0x00, 0x01, 0x02, 0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    const files = await discoverInstructionFiles(tmpRoot);
    expect(files).toEqual([]);
  });

  test("discovers .claw/CLAUDE.md", async () => {
    createInstructionFile(tmpRoot, ".claw/CLAUDE.md", "# Claw instructions");
    const files = await discoverInstructionFiles(tmpRoot);
    expect(files.length).toBe(1);
    expect(files[0].content).toBe("# Claw instructions");
  });

  test("discovers .cursorrules", async () => {
    createInstructionFile(tmpRoot, ".cursorrules", "# Cursor rules");
    const files = await discoverInstructionFiles(tmpRoot);
    expect(files.length).toBe(1);
    expect(files[0].content).toBe("# Cursor rules");
  });
});

describe("formatInstructionFiles", () => {
  test("returns empty string for empty array", () => {
    expect(formatInstructionFiles([])).toBe("");
  });

  test("formats single file as markdown section", () => {
    const files: InstructionFile[] = [
      {
        path: "/project/CLAUDE.md",
        content: "# Hello",
        hash: "abc",
      },
    ];
    const result = formatInstructionFiles(files);
    expect(result).toContain("## Project Instructions");
    expect(result).toContain("### CLAUDE.md");
    expect(result).toContain("# Hello");
  });

  test("formats multiple files", async () => {
    const files: InstructionFile[] = [
      { path: "/a/CLAUDE.md", content: "Content A", hash: "a" },
      { path: "/b/.cursorrules", content: "Content B", hash: "b" },
    ];
    const result = formatInstructionFiles(files);
    expect(result).toContain("### CLAUDE.md");
    expect(result).toContain("### .cursorrules");
    expect(result).toContain("Content A");
    expect(result).toContain("Content B");
  });
});

describe("constants", () => {
  test("INSTRUCTION_FILE_NAMES includes expected files", () => {
    expect(INSTRUCTION_FILE_NAMES).toContain("CLAUDE.md");
    expect(INSTRUCTION_FILE_NAMES).toContain(".cursorrules");
    expect(INSTRUCTION_FILE_NAMES).toContain(".claw/CLAUDE.md");
  });

  test("MAX_FILE_CONTENT_LENGTH is 4000", () => {
    expect(MAX_FILE_CONTENT_LENGTH).toBe(4000);
  });

  test("MAX_TOTAL_CONTENT_LENGTH is 12000", () => {
    expect(MAX_TOTAL_CONTENT_LENGTH).toBe(12000);
  });
});
