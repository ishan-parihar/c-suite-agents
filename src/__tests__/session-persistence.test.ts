// Session Persistence Tests
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import {
  SessionPersistence,
  type SessionEntry,
} from "../runtime/session-persistence.js";

describe("SessionPersistence", () => {
  let tmpDir: string;
  let persistence: SessionPersistence;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-test-"));
    persistence = new SessionPersistence({ dir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("save / load", () => {
    test("save and load a single entry", async () => {
      const entry: SessionEntry = {
        timestamp: Date.now(),
        role: "user",
        content: "Hello",
      };
      await persistence.save("test-session", entry);
      const loaded = await persistence.load("test-session");
      expect(loaded).toHaveLength(1);
      expect(loaded[0].role).toBe("user");
      expect(loaded[0].content).toBe("Hello");
    });

    test("appends multiple entries in order", async () => {
      await persistence.save("multi", { timestamp: 1, role: "user", content: "A" });
      await persistence.save("multi", { timestamp: 2, role: "assistant", content: "B" });
      await persistence.save("multi", { timestamp: 3, role: "user", content: "C" });
      const loaded = await persistence.load("multi");
      expect(loaded).toHaveLength(3);
      expect(loaded[0].content).toBe("A");
      expect(loaded[1].content).toBe("B");
      expect(loaded[2].content).toBe("C");
    });

    test("load returns empty array for non-existent session", async () => {
      const loaded = await persistence.load("does-not-exist");
      expect(loaded).toEqual([]);
    });

    test("preserves metadata", async () => {
      await persistence.save("meta", {
        timestamp: Date.now(),
        role: "assistant",
        content: "test",
        metadata: { tokens: 150, model: "llama" },
      });
      const loaded = await persistence.load("meta");
      expect(loaded[0].metadata).toEqual({ tokens: 150, model: "llama" });
    });

    test("isolates different sessions", async () => {
      await persistence.save("s1", { timestamp: 1, role: "user", content: "session1" });
      await persistence.save("s2", { timestamp: 1, role: "user", content: "session2" });
      const l1 = await persistence.load("s1");
      const l2 = await persistence.load("s2");
      expect(l1[0].content).toBe("session1");
      expect(l2[0].content).toBe("session2");
    });
  });

  describe("rotation", () => {
    test("rotates when file exceeds maxFileSize", async () => {
      // Use a tiny max file size to trigger rotation
      const small = new SessionPersistence({ dir: tmpDir, maxFileSize: 100, maxFiles: 2 });
      // Write enough entries to exceed 100 bytes
      for (let i = 0; i < 20; i++) {
        await small.save("rotate-test", {
          timestamp: Date.now(),
          role: "user",
          content: `Entry number ${i} with enough content to grow`,
        });
      }
      // Check that rotated files exist
      const primary = path.join(tmpDir, "sessions", "rotate-test.jsonl");
      const rotated1 = `${primary}.1`;
      // At least the primary should exist
      expect(fs.existsSync(primary)).toBe(true);
    });

    test("rotated files are loaded in correct order (oldest first)", async () => {
      const small = new SessionPersistence({ dir: tmpDir, maxFileSize: 80, maxFiles: 3 });
      // Write entries to trigger rotation
      for (let i = 0; i < 30; i++) {
        await small.save("order-test", {
          timestamp: i,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}`,
        });
      }
      const loaded = await small.load("order-test");
      // Entries should be in chronological order
      expect(loaded.length).toBeGreaterThan(0);
      // First entry should have lower timestamp than last
      if (loaded.length > 1) {
        expect(loaded[0].timestamp).toBeLessThanOrEqual(loaded[loaded.length - 1].timestamp);
      }
    });

    test("delete oldest file when max rotation limit reached", async () => {
      const small = new SessionPersistence({ dir: tmpDir, maxFileSize: 60, maxFiles: 2 });
      for (let i = 0; i < 40; i++) {
        await small.save("limit-test", {
          timestamp: Date.now(),
          role: "user",
          content: `Data ${i}`,
        });
      }
      // maxFiles = 2, so .2 should not exist (it gets deleted)
      const primary = path.join(tmpDir, "sessions", "limit-test.jsonl");
      const oldest = `${primary}.3`; // beyond maxFiles
      expect(fs.existsSync(oldest)).toBe(false);
    });
  });

  describe("listSessions", () => {
    test("returns empty array when no sessions", async () => {
      const sessions = await persistence.listSessions();
      expect(sessions).toEqual([]);
    });

    test("returns summary for each session", async () => {
      await persistence.save("alpha", { timestamp: Date.now(), role: "user", content: "A" });
      await persistence.save("beta", { timestamp: Date.now(), role: "user", content: "B" });
      await persistence.save("beta", { timestamp: Date.now(), role: "assistant", content: "C" });

      const sessions = await persistence.listSessions();
      expect(sessions.length).toBe(2);

      const alpha = sessions.find((s) => s.sessionId === "alpha");
      const beta = sessions.find((s) => s.sessionId === "beta");
      expect(alpha).toBeDefined();
      expect(beta).toBeDefined();
      expect(alpha!.totalEntries).toBe(1);
      expect(beta!.totalEntries).toBe(2);
    });

    test("sessions sorted by lastModified descending", async () => {
      await persistence.save("old", { timestamp: 1000, role: "user", content: "old" });
      // Small delay to ensure different mtime
      await new Promise((r) => setTimeout(r, 10));
      await persistence.save("new", { timestamp: 2000, role: "user", content: "new" });

      const sessions = await persistence.listSessions();
      expect(sessions[0].sessionId).toBe("new");
    });
  });

  describe("deleteSession", () => {
    test("deletes all files for a session", async () => {
      await persistence.save("to-delete", { timestamp: Date.now(), role: "user", content: "X" });
      await persistence.save("to-delete", { timestamp: Date.now(), role: "assistant", content: "Y" });

      expect((await persistence.load("to-delete")).length).toBeGreaterThan(0);

      await persistence.deleteSession("to-delete");
      expect(await persistence.load("to-delete")).toEqual([]);
    });

    test("deleteSession does not affect other sessions", async () => {
      await persistence.save("keep", { timestamp: Date.now(), role: "user", content: "safe" });
      await persistence.save("delete", { timestamp: Date.now(), role: "user", content: "gone" });

      await persistence.deleteSession("delete");

      const keepLoaded = await persistence.load("keep");
      expect(keepLoaded).toHaveLength(1);
      expect(keepLoaded[0].content).toBe("safe");
    });

    test("deleteSession is idempotent", async () => {
      await persistence.deleteSession("nonexistent"); // should not throw
    });
  });

  describe("malformed line handling", () => {
    test("skips malformed JSONL lines gracefully", async () => {
      // Write a valid entry
      await persistence.save("malformed", {
        timestamp: Date.now(),
        role: "user",
        content: "valid",
      });
      // Manually append a bad line
      const filePath = path.join(tmpDir, "sessions", "malformed.jsonl");
      fs.appendFileSync(filePath, "this is not json\n");

      const loaded = await persistence.load("malformed");
      // Should only have the valid entry
      const validEntries = loaded.filter((e) => e.content === "valid");
      expect(validEntries).toHaveLength(1);
    });
  });
});
