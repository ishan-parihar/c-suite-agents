import { describe, test, expect } from "bun:test";
import { NativeAgentRuntime } from "../runtime/native-agent-runtime.js";

describe("NativeAgentRuntime session isolation", () => {
  test("uses distinct runtime sessions per contextId", async () => {
    const runtime = new NativeAgentRuntime({
      llm: {
        provider: "ollama",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.1:8b",
        contextTokens: 32768,
      },
    });

    const a = await runtime.getOrCreateRuntimeSession("ceo-strategic", { mode: "message", contextId: "chat-a" });
    const b = await runtime.getOrCreateRuntimeSession("ceo-strategic", { mode: "message", contextId: "chat-b" });
    const a2 = await runtime.getOrCreateRuntimeSession("ceo-strategic", { mode: "message", contextId: "chat-a" });

    expect(a).not.toBe(b);
    expect(a2).toBe(a);
  });
});

