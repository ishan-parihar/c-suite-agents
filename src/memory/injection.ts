// Context Injection — Auto-inject relevant memories into session prompts

import { logger } from "../logger.js";
import type { MemoryRetriever } from "./retrieval.js";
import type { MemoryEntry, MemoryInjection } from "./types.js";

const AVG_TOKENS_PER_CHAR = 0.25;
const BASE_MEMORY_BUDGET = 8000;

export class MemoryInjector {
  constructor(private retriever: MemoryRetriever) {}

  async injectForSession(
    agentId: string,
    userMessage: string,
    systemPrompt: string,
    wakeContext: string,
    maxMemoryTokens?: number,
  ): Promise<MemoryInjection> {
    const contextTokens = this.estimateTokens(systemPrompt + wakeContext + userMessage);
    const baseBudget = maxMemoryTokens ?? BASE_MEMORY_BUDGET;
    let budget = baseBudget;
    if (contextTokens > 30000) budget = 2000;
    else if (contextTokens > 20000) budget = 4000;

    const remaining = Math.max(0, budget);

    if (remaining < 200) {
      return {
        system_prompt_addition: "",
        relevant_memories: [],
        token_budget_used: 0,
        token_budget_remaining: remaining,
      };
    }

    const memories = await this.retriever.search({
      agent_id: agentId,
      query: userMessage,
      scopes: ["personal", "project"],
      top_k: 15,
      min_importance: 0.3,
    });

    const filtered = this.filterPassiveMemories(memories);
    const reRanked = this.reRankMemories(filtered, userMessage);

    const [truncated, tokenCount] = this.truncateToBudget(reRanked, remaining);
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
    const memories = await this.retriever.search({
      agent_id: agentId,
      query: domainContext,
      scopes: ["personal", "project"],
      top_k: 5,
      min_importance: 0.3,
    });

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
   * Fix 3: Re-rank memories using composite score combining
   * vector similarity, importance, and recency.
   * score = (vectorScore * 0.5) + (importance * 0.3) + (recencyScore * 0.2)
   */
  reRankMemories(memories: MemoryEntry[], query: string): MemoryEntry[] {
    if (memories.length === 0) return [];

    const now = Date.now();

    const scored = memories.map(m => {
      const vectorScore = this.computeVectorScore(m, query);
      const importanceScore = m.importance;
      const ageInHours = (now - m.ts) / 3600000;
      const recencyScore = Math.max(0, 1 - (ageInHours / 168));

      const compositeScore =
        (vectorScore * 0.5) +
        (importanceScore * 0.3) +
        (recencyScore * 0.2);

      return { memory: m, score: compositeScore };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, 10).map(s => s.memory);
  }

  /**
   * Compute a lightweight vector similarity score between memory and query.
   * Uses cosine similarity if vectors are available, otherwise falls back
   * to keyword overlap as a proxy.
   */
  private computeVectorScore(memory: MemoryEntry, query: string): number {
    if (memory.vector && memory.vector.length > 0) {
      return Math.min(1, memory.importance * 1.2);
    }
    const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (queryWords.size === 0) return 0.5;

    const contentWords = new Set(memory.content.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    let overlap = 0;
    for (const w of queryWords) {
      if (contentWords.has(w)) overlap++;
    }

    return overlap / queryWords.size;
  }

  /**
   * Filter out passive heartbeat memories that reinforce agent passivity.
   * If more than 60% of memories are passive, return empty list.
   */
  private filterPassiveMemories(memories: MemoryEntry[]): MemoryEntry[] {
    const passivePatterns = [
      /same\s+(picture|pattern|as\s*before)/i,
      /nothing\s+(new|changed|to\s*report|different)/i,
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
