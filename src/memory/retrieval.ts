// Retrieval — Query builder with vector + metadata + temporal + tag filtering

import { logger } from "../logger.js";
import type { MemoryStore } from "./store.js";
import type { EmbeddingService } from "./embeddings.js";
import type { MemoryEntry, MemoryQuery, MemoryScope } from "./types.js";

export class MemoryRetriever {
  constructor(
    private store: MemoryStore,
    private embedder: EmbeddingService,
  ) {}

  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    const vector = await this.embedder.embed(query.query);
    const allResults: MemoryEntry[] = [];

    for (const scope of query.scopes) {
      const scopeResults = await this.store.search(scope, vector, query);
      allResults.push(...scopeResults);
    }

    if (query.agent_ids && query.agent_ids.length > 0) {
      const allowed = new Set(query.agent_ids);
      return allResults.filter(r => allowed.has(r.agent_id));
    }

    return allResults;
  }

  async searchKeyword(query: MemoryQuery): Promise<MemoryEntry[]> {
    const allResults: MemoryEntry[] = [];

    for (const scope of query.scopes) {
      const scopeResults = await this.store.searchKeyword(scope, query.query, query.agent_id);
      allResults.push(...scopeResults.slice(0, 10));
    }

    if (query.agent_ids && query.agent_ids.length > 0) {
      const allowed = new Set(query.agent_ids);
      return allResults.filter(r => allowed.has(r.agent_id));
    }

    return allResults;
  }

  async hybridSearch(query: MemoryQuery): Promise<MemoryEntry[]> {
    const [vectorResults, keywordResults] = await Promise.all([
      this.search(query),
      this.searchKeyword(query),
    ]);

    const seen = new Set<string>();
    const merged: MemoryEntry[] = [];

    for (const r of vectorResults) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
    for (const r of keywordResults) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }

    return merged.slice(0, 15);
  }

  async searchByTag(
    scope: MemoryScope,
    agentId: string,
    tag: string,
    topK = 20,
  ): Promise<MemoryEntry[]> {
    return this.store.search(scope, await this.embedder.embed(tag), {
      agent_id: agentId,
      query: tag,
      scopes: [scope],
      tags: [tag],
      tag_match: "any",
      top_k: topK,
    });
  }

  async searchRecent(
    scope: MemoryScope,
    agentId: string,
    query: string,
    hoursBack = 24,
    topK = 10,
  ): Promise<MemoryEntry[]> {
    const dateFrom = Date.now() - hoursBack * 3600000;
    return this.store.search(scope, await this.embedder.embed(query), {
      agent_id: agentId,
      query,
      scopes: [scope],
      date_from: dateFrom,
      top_k: topK,
    });
  }

  async searchCrossAgent(
    scope: MemoryScope,
    query: string,
    agentIds: string[],
    topK = 10,
  ): Promise<MemoryEntry[]> {
    const vector = await this.embedder.embed(query);
    const all: MemoryEntry[] = [];

    for (const agentId of agentIds) {
      const results = await this.store.search(scope, vector, {
        agent_id: agentId,
        query,
        scopes: [scope],
        top_k: Math.ceil(topK / agentIds.length),
      });
      all.push(...results);
    }

    return all.slice(0, topK);
  }

  async stats(): Promise<Record<MemoryScope, { total: number; perAgent: Record<string, number> }>> {
    const scopes: MemoryScope[] = ["personal", "project", "company"];
    const result: Record<string, any> = {};

    for (const scope of scopes) {
      const perAgent = await this.perAgentCounts(scope);
      const total = Object.values(perAgent).reduce((sum, n) => sum + n, 0);
      result[scope] = { total, perAgent };
    }

    return result as any;
  }

  private async perAgentCounts(scope: MemoryScope): Promise<Record<string, number>> {
    const all = await this.store.getAll(scope);
    const counts: Record<string, number> = {};
    for (const m of all) {
      counts[m.agent_id] = (counts[m.agent_id] || 0) + 1;
    }
    return counts;
  }

  async agentStats(scope: MemoryScope): Promise<{ total: number; perAgent: Record<string, number> }> {
    const perAgent = await this.perAgentCounts(scope);
    const total = Object.values(perAgent).reduce((sum, n) => sum + n, 0);
    return { total, perAgent };
  }
}
