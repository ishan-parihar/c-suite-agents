// Context Injection — Auto-inject relevant memories into session prompts

import { logger } from "../logger.js";
import type { MemoryRetriever } from "./retrieval.js";
import type { MemoryEntry, MemoryInjection, MemoryScope } from "./types.js";

const MEMORY_TOKEN_BUDGET = 8000;
const AVG_TOKENS_PER_CHAR = 0.25;

export class MemoryInjector {
  constructor(private retriever: MemoryRetriever) {}

  async injectForSession(
    agentId: string,
    userMessage: string,
    systemPrompt: string,
    wakeContext: string,
  ): Promise<MemoryInjection> {
    const usedTokens = this.estimateTokens(systemPrompt + wakeContext + userMessage);
    const remaining = Math.max(0, MEMORY_TOKEN_BUDGET - usedTokens);

    if (remaining < 200) {
      return {
        system_prompt_addition: "",
        relevant_memories: [],
        token_budget_used: 0,
        token_budget_remaining: remaining,
      };
    }

    const memories = await this.retriever.searchRecent(
      "personal",
      agentId,
      userMessage,
      72,
      10,
    );

    // Filter out passive heartbeat memories
    const filtered = this.filterPassiveMemories(memories);

    const [truncated, tokenCount] = this.truncateToBudget(filtered, remaining);
    const formatted = this.formatMemories(truncated);

    logger.debug({ agentId, memoryCount: truncated.length, tokensUsed: tokenCount }, "Memory injection");

    return {
      system_prompt_addition: formatted,
      relevant_memories: truncated,
      token_budget_used: tokenCount,
      token_budget_remaining: remaining - tokenCount,
    };
  }

  async injectForProactiveWork(
    agentId: string,
    domainContext: string,
  ): Promise<string> {
    const memories = await this.retriever.searchRecent(
      "personal",
      agentId,
      domainContext,
      168,
      5,
    );

    if (memories.length === 0) return "";

    // Filter out passive heartbeat memories
    const filtered = this.filterPassiveMemories(memories);
    if (filtered.length === 0) return "";

    const lines = ["\n## Recent Context in Your Domain"];
    for (const m of filtered) {
      const age = this.humanizeAge(m.ts);
      lines.push(`- [${m.type}] (${age}) ${m.content.slice(0, 250)}`);
    }

    return lines.join("\n");
  }

  async injectForTask(
    agentId: string,
    taskDescription: string,
  ): Promise<string> {
    const memories = await this.retriever.search({
      agent_id: agentId,
      query: taskDescription,
      scopes: ["personal", "project"],
      top_k: 5,
      min_importance: 0.3,
    });

    if (memories.length === 0) return "";

    // Filter out passive heartbeat memories that reinforce "nothing to do" behavior
    const filtered = this.filterPassiveMemories(memories);
    if (filtered.length === 0) return "";

    const lines = ["\n## Relevant Past Work"];
    for (const m of filtered) {
      lines.push(`- ${m.content.slice(0, 250)}`);
    }

    return lines.join("\n");
  }

  /**
   * Filter out passive heartbeat memories that reinforce agent passivity.
   * If more than 60% of memories are passive, return empty list.
   */
  private filterPassiveMemories(memories: MemoryEntry[]): MemoryEntry[] {
    const passivePatterns = [
      /same\s+(picture|pattern|as\s*before)/i,
      /nothing\s+(new|changed|to\s*flag|to\s*report|different)/i,
      /just\s+(monitoring|checking|watching)/i,
      /no\s+escalation\s*needed/i,
      /repetitive/i,
      /all\s+clear.*monitoring/i,
      /nothing\s+urgent/i,
      /pattern\s+has\s+been\s+the\s+same/i,
      /same\s+picture\s+as\s+before/i,
    ];

    return memories.filter(m => {
      return !passivePatterns.some(p => p.test(m.content));
    });
  }

  private truncateToBudget(memories: MemoryEntry[], budget: number): [MemoryEntry[], number] {
    const truncated: MemoryEntry[] = [];
    let tokenCount = 0;

    for (const m of memories) {
      const mTokens = this.estimateTokens(m.content);
      if (tokenCount + mTokens > budget) break;
      truncated.push(m);
      tokenCount += mTokens;
    }

    return [truncated, tokenCount];
  }

  private formatMemories(memories: MemoryEntry[]): string {
    if (memories.length === 0) return "";

    const lines = ["\n## Relevant Memory Context"];
    for (const m of memories) {
      const age = this.humanizeAge(m.ts);
      lines.push(`- [${m.type}] (${age}, importance: ${(m.importance * 100).toFixed(0)}%) ${m.content.slice(0, 300)}`);
    }

    return lines.join("\n");
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length * AVG_TOKENS_PER_CHAR);
  }

  private humanizeAge(ts: number): string {
    const hours = (Date.now() - ts) / 3600000;
    if (hours < 1) return "just now";
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
}
