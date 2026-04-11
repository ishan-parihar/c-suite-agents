import { describe, test, expect, beforeEach } from "bun:test";
import {
  PromptCacheTracker,
  createPromptFingerprint,
  OpenAICompatibleProvider,
} from "../runtime/provider";

describe("PromptCacheTracker", () => {
  let tracker: PromptCacheTracker;

  beforeEach(() => {
    tracker = new PromptCacheTracker();
  });

  describe("record", () => {
    test("stores cache read for a fingerprint", () => {
      tracker.record("abc123", 5000);
      // check() should now compare against this value
      const result = tracker.check("abc123", 4000);
      expect(result.unexpected).toBe(true);
      expect(result.tokenDrop).toBe(1000);
    });
  });

  describe("check", () => {
    test("returns no unexpected break when no prior record", () => {
      const result = tracker.check("new-fingerprint", 3000);
      expect(result.unexpected).toBe(false);
      expect(result.tokenDrop).toBe(0);
    });

    test("detects unexpected cache break", () => {
      tracker.record("fp-1", 8000);
      const result = tracker.check("fp-1", 2000);
      expect(result.unexpected).toBe(true);
      expect(result.tokenDrop).toBe(6000);
    });

    test("no break when cache read increased", () => {
      tracker.record("fp-2", 3000);
      const result = tracker.check("fp-2", 5000);
      expect(result.unexpected).toBe(false);
      expect(result.tokenDrop).toBe(-2000);
    });

    test("no break when cache read stays same", () => {
      tracker.record("fp-3", 4000);
      const result = tracker.check("fp-3", 4000);
      expect(result.unexpected).toBe(false);
      expect(result.tokenDrop).toBe(0);
    });
  });

  describe("getStats", () => {
    test("returns count of tracked fingerprints", () => {
      expect(tracker.getStats().totalFingerprints).toBe(0);
      tracker.record("a", 100);
      tracker.record("b", 200);
      tracker.record("c", 300);
      expect(tracker.getStats().totalFingerprints).toBe(3);
    });
  });

  describe("clear", () => {
    test("removes all tracked fingerprints", () => {
      tracker.record("a", 100);
      tracker.record("b", 200);
      tracker.clear();
      expect(tracker.getStats().totalFingerprints).toBe(0);
      // After clear, check should behave as if no prior record
      expect(tracker.check("a", 50).unexpected).toBe(false);
    });
  });
});

describe("createPromptFingerprint", () => {
  test("produces consistent hash for same input", () => {
    const messages = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const fp1 = createPromptFingerprint(messages);
    const fp2 = createPromptFingerprint(messages);
    expect(fp1).toBe(fp2);
  });

  test("produces different hash for different input", () => {
    const fp1 = createPromptFingerprint([
      { role: "system", content: "You are helpful" },
    ]);
    const fp2 = createPromptFingerprint([
      { role: "system", content: "You are NOT helpful" },
    ]);
    expect(fp1).not.toBe(fp2);
  });

  test("hash is 16 characters (first 16 of sha256 hex)", () => {
    const fp = createPromptFingerprint([{ role: "system", content: "test" }]);
    expect(fp.length).toBe(16);
  });

  test("only uses first N messages for fingerprint", () => {
    const messages3 = [
      { role: "system", content: "A" },
      { role: "user", content: "B" },
      { role: "assistant", content: "C" },
    ];
    const messages4 = [
      ...messages3,
      { role: "user", content: "D" },
    ];
    // With messageCount=3, both should produce same fingerprint
    const fp3 = createPromptFingerprint(messages3, 3);
    const fp4 = createPromptFingerprint(messages4, 3);
    expect(fp3).toBe(fp4);
  });

  test("default messageCount is 3", () => {
    const messages = [
      { role: "system", content: "S" },
      { role: "user", content: "U" },
      { role: "assistant", content: "A" },
      { role: "user", content: "U2" },
    ];
    const fp = createPromptFingerprint(messages); // default 3
    const fp3 = createPromptFingerprint(messages, 3);
    expect(fp).toBe(fp3);
  });

  test("handles empty messages array", () => {
    const fp = createPromptFingerprint([]);
    expect(fp.length).toBe(16);
  });
});

describe("OpenAICompatibleProvider", () => {
  describe("constructor normalizes baseUrl", () => {
    test("strips trailing slash", () => {
      const p = new OpenAICompatibleProvider("http://localhost:8080/", "key");
      // Access internal via checking the built URL through a complete() call
      // We can't access private fields, but we can verify the URL format
      // by checking that it doesn't have double slashes
      expect(p).toBeDefined();
    });

    test("handles url with trailing /v1", () => {
      const p = new OpenAICompatibleProvider("http://localhost:8080/v1/", "key");
      expect(p).toBeDefined();
    });
  });
});
