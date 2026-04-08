// LanceDB Storage Layer — 3 isolated tables, proper indexing, decay

import { connect, type Connection, type Table } from "@lancedb/lancedb";
import { logger } from "../logger.js";
import type { MemoryEntry, MemoryScope, MemoryQuery, DecayConfig } from "./types.js";

const TABLES: Record<MemoryScope, string> = {
  personal: "memory_personal",
  project: "memory_project",
  company: "memory_company",
};

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "both", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "because", "but", "and", "or", "if", "while", "about", "it", "its",
  "this", "that", "these", "those", "i", "me", "my", "myself", "we",
  "our", "ours", "you", "your", "he", "him", "his", "she", "her",
  "they", "them", "their", "what", "which", "who", "whom",
]);

export class MemoryStore {
  private db!: Connection;
  private tables: Map<MemoryScope, Table> = new Map();
  private keywordIndex: Map<MemoryScope, Map<string, Set<string>>> = new Map();
  private indexBuilt: Map<MemoryScope, boolean> = new Map();

  static async init(dir: string): Promise<MemoryStore> {
    const store = new MemoryStore();
    store.db = await connect(dir);

    for (const [scope, tableName] of Object.entries(TABLES)) {
      store.tables.set(scope as MemoryScope, await store.ensureTable(tableName));
    }

    logger.info({ dir, tables: TABLES }, "Memory store initialized");
    return store;
  }

  private async ensureTable(name: string): Promise<Table> {
    try {
      return await this.db.openTable(name);
    } catch {
      logger.info({ table: name }, "Creating memory table");
      const seedVector = new Array(1024).fill(0);
      const scope = name.includes("personal") ? "personal" : name.includes("project") ? "project" : "company";
      const seed = {
        id: "init",
        ts: Date.now(),
        scope,
        kind: "episodic",
        type: "log",
        agent_id: "ceo-strategic",
        project_id: "",
        task_id: "",
        thread_id: "",
        content: "init",
        content_hash: "init",
        importance: 0,
        original_importance: 0,
        tags: ["init"],
        ttl_ms: 0,
        decay_rate: 0,
        source: "system",
        consolidated_from: ["init"],
        vector: seedVector,
      };
      return await this.db.createTable(name, [seed]);
    }
  }

  async insert(scope: MemoryScope, entry: MemoryEntry): Promise<void> {
    const table = this.tables.get(scope);
    if (!table) throw new Error(`Unknown scope: ${scope}`);

    await table.add([{
      id: entry.id,
      ts: entry.ts,
      scope: entry.scope,
      kind: entry.kind,
      type: entry.type,
      agent_id: entry.agent_id,
      project_id: entry.project_id || "",
      task_id: entry.task_id || "",
      thread_id: entry.thread_id || "",
      content: entry.content,
      content_hash: entry.content_hash,
      importance: entry.importance,
      original_importance: entry.original_importance,
      tags: entry.tags,
      ttl_ms: entry.ttl_ms || 0,
      decay_rate: entry.decay_rate,
      source: entry.source,
      consolidated_from: entry.consolidated_from || [],
      vector: entry.vector,
    }]);

    logger.debug({ id: entry.id, scope, agent_id: entry.agent_id }, "Memory inserted");
    this.updateKeywordIndex(scope, entry);
  }

  private extractWords(text: string): Set<string> {
    const words = new Set<string>();
    const tokens = text.toLowerCase().split(/[\s,_\-./\\|:;!?()[\]{}"'`~@#$%^&*+=<>]+/);
    for (const t of tokens) {
      if (t.length >= 2 && !STOP_WORDS.has(t)) {
        words.add(t);
      }
    }
    return words;
  }

  private updateKeywordIndex(scope: MemoryScope, entry: MemoryEntry) {
    let index = this.keywordIndex.get(scope);
    if (!index) {
      index = new Map();
      this.keywordIndex.set(scope, index);
    }
    const words = new Set<string>();
    this.extractWords(entry.content).forEach(w => words.add(w));
    for (const tag of entry.tags) {
      this.extractWords(tag).forEach(w => words.add(w));
    }
    this.extractWords(entry.type).forEach(w => words.add(w));
    index.set(entry.id, words);
    this.indexBuilt.set(scope, true);
  }

  async buildIndexFromStore(scope: MemoryScope) {
    const entries = await this.getAll(scope);
    const index = new Map<string, Set<string>>();
    for (const entry of entries) {
      const words = new Set<string>();
      this.extractWords(entry.content).forEach(w => words.add(w));
      for (const tag of entry.tags) {
        this.extractWords(tag).forEach(w => words.add(w));
      }
      this.extractWords(entry.type).forEach(w => words.add(w));
      index.set(entry.id, words);
    }
    this.keywordIndex.set(scope, index);
    this.indexBuilt.set(scope, true);
    logger.debug({ scope, entries: entries.length }, "Keyword index built");
  }

  async searchKeyword(scope: MemoryScope, query: string, _agentId?: string): Promise<MemoryEntry[]> {
    if (!this.indexBuilt.get(scope)) {
      await this.buildIndexFromStore(scope);
    }

    const queryWords = this.extractWords(query);
    if (queryWords.size === 0) return [];

    const index = this.keywordIndex.get(scope);
    if (!index) return [];

    const allEntries = await this.getAll(scope);
    const filtered = _agentId ? allEntries.filter(e => e.agent_id === _agentId) : allEntries;

    const results: Array<{ entry: MemoryEntry; matchCount: number }> = [];

    for (const entry of filtered) {
      const entryWords = index.get(entry.id);
      if (!entryWords) continue;

      let matchCount = 0;
      for (const qw of queryWords) {
        if (entryWords.has(qw)) matchCount++;
      }

      if (matchCount > 0) {
        results.push({ entry, matchCount });
      } else {
        const lowerContent = entry.content.toLowerCase();
        const lowerTags = entry.tags.map(t => t.toLowerCase()).join(" ");
        const lowerType = entry.type.toLowerCase();
        const fullText = `${lowerContent} ${lowerTags} ${lowerType}`;
        for (const qw of queryWords) {
          if (fullText.includes(qw)) {
            matchCount++;
            results.push({ entry, matchCount });
            break;
          }
        }
      }
    }

    results.sort((a, b) => b.matchCount - a.matchCount);
    return results.map(r => r.entry);
  }

  async search(scope: MemoryScope, vector: number[], query: MemoryQuery): Promise<MemoryEntry[]> {
    const table = this.tables.get(scope);
    if (!table) return [];

    // Fetch more results server-side, filter in JS to avoid SQL injection
    const results = await table.search(vector).limit(query.top_k * 10).toArray();

    let filtered = results as any[];

    // JS-side filtering — no string interpolation
    filtered = filtered.filter((r: any) => r.agent_id === query.agent_id);

    const dateFrom = query.date_from;
    const dateTo = query.date_to;
    const minImportance = query.min_importance;

    if (dateFrom) {
      filtered = filtered.filter((r: any) => r.ts >= dateFrom);
    }
    if (dateTo) {
      filtered = filtered.filter((r: any) => r.ts <= dateTo);
    }
    if (minImportance !== undefined) {
      filtered = filtered.filter((r: any) => r.importance >= minImportance);
    }
    if (query.kinds && query.kinds.length > 0) {
      filtered = filtered.filter((r: any) => query.kinds!.includes(r.kind));
    }

    if (query.tags && query.tags.length > 0) {
      filtered = filtered.filter((r: any) => {
        const rowTags: string[] = Array.isArray(r.tags) ? r.tags : [];
        return query.tag_match === "all"
          ? query.tags!.every(t => rowTags.includes(t))
          : query.tags!.some(t => rowTags.includes(t));
      });
    }

    const now = Date.now();
    const scored = filtered.map((r: any) => {
      const distance = r._distance ?? 1.0;
      const vectorScore = Math.max(0, 1 - distance);
      const importanceScore = r.importance || 0;
      const ageHours = (now - (r.ts || now)) / 3600000;
      const recencyScore = Math.exp(-ageHours / 168);

      return {
        ...r,
        _combined_score: vectorScore * 0.6 + importanceScore * 0.25 + recencyScore * 0.15,
      };
    });

    scored.sort((a: any, b: any) => b._combined_score - a._combined_score);

    return scored.slice(0, query.top_k).map((r: any) => ({
      id: r.id,
      ts: r.ts,
      scope: r.scope as MemoryScope,
      kind: r.kind as MemoryEntry["kind"],
      type: r.type as MemoryEntry["type"],
      agent_id: r.agent_id,
      project_id: r.project_id || undefined,
      task_id: r.task_id || undefined,
      thread_id: r.thread_id || undefined,
      content: r.content,
      content_hash: r.content_hash,
      importance: r.importance,
      original_importance: r.original_importance,
      tags: Array.isArray(r.tags) ? r.tags : [],
      ttl_ms: r.ttl_ms > 0 ? r.ttl_ms : null,
      decay_rate: r.decay_rate || 0.5,
      source: (r.source || "manual") as MemoryEntry["source"],
      consolidated_from: Array.isArray(r.consolidated_from) ? r.consolidated_from : undefined,
      vector: r.vector || [],
    }));
  }

  async deleteByHash(scope: MemoryScope, contentHash: string): Promise<number> {
    const table = this.tables.get(scope);
    if (!table) return 0;

    // Search then delete by _rowid to avoid string interpolation
    const matches = await table.query().toArray() as any[];
    const toDelete = matches.filter((r: any) => r.content_hash === contentHash);
    for (const row of toDelete) {
      if (row._rowid !== undefined) {
        await table.delete(`_rowid = ${row._rowid}`);
      }
      this.keywordIndex.get(scope)?.delete(row.id);
    }
    return toDelete.length;
  }

  async deleteById(scope: MemoryScope, id: string): Promise<number> {
    const table = this.tables.get(scope);
    if (!table) return 0;

    // Search then delete by _rowid to avoid string interpolation
    const matches = await table.query().toArray() as any[];
    const toDelete = matches.filter((r: any) => r.id === id);
    for (const row of toDelete) {
      if (row._rowid !== undefined) {
        await table.delete(`_rowid = ${row._rowid}`);
      }
      this.keywordIndex.get(scope)?.delete(row.id);
    }
    return toDelete.length;
  }

  async deleteExpired(scope: MemoryScope): Promise<number> {
    const table = this.tables.get(scope);
    if (!table) return 0;

    const now = Date.now();
    const all = await table.query().toArray() as any[];
    let deleted = 0;

    for (const row of all) {
      if (row.ttl_ms && row.ttl_ms > 0 && row.ts && (row.ts + row.ttl_ms) < now) {
        if (row._rowid !== undefined) {
          await table.delete(`_rowid = ${row._rowid}`);
        }
        this.keywordIndex.get(scope)?.delete(row.id);
        deleted++;
      }
    }

    return deleted;
  }

  async decay(scope: MemoryScope, config: DecayConfig): Promise<number> {
    const table = this.tables.get(scope);
    if (!table) return 0;

    const now = Date.now();
    const halfLife = config.half_life_hours * 3600000;
    const all = await table.query().toArray() as any[];
    let updated = 0;

    for (const row of all) {
      if (!row.ts) continue;

      const ageMs = now - row.ts;
      const base = row.original_importance ?? row.importance ?? 0.5;
      const decayed = base * Math.pow(0.5, ageMs / halfLife);

      if (decayed < config.archive_threshold) {
        if (row._rowid !== undefined) {
          await table.delete(`_rowid = ${row._rowid}`);
        }
        this.keywordIndex.get(scope)?.delete(row.id);
        updated++;
      } else if (Math.abs(decayed - (row.importance || 0)) > 0.005) {
        if (row._rowid !== undefined) {
          await table.delete(`_rowid = ${row._rowid}`);
        }
        await table.add([{ ...row, importance: decayed }]);
        updated++;
      }
    }

    if (updated > 0) {
      logger.info({ scope, updated }, "Memory decay applied");
    }

    return updated;
  }

  async count(scope: MemoryScope, agentId?: string): Promise<number> {
    const table = this.tables.get(scope);
    if (!table) return 0;

    const all = await table.query().toArray() as any[];
    if (agentId) {
      return all.filter(r => r.agent_id === agentId).length;
    }
    return all.length;
  }

  async getAll(scope: MemoryScope, agentId?: string, tag?: string): Promise<MemoryEntry[]> {
    const table = this.tables.get(scope);
    if (!table) return [];

    const all = await table.query().toArray() as any[];
    let filtered = all;

    if (agentId) filtered = filtered.filter(r => r.agent_id === agentId);
    if (tag) filtered = filtered.filter(r => Array.isArray(r.tags) && r.tags.includes(tag));

    return filtered.map((r: any) => ({
      id: r.id,
      ts: r.ts,
      scope: r.scope as MemoryScope,
      kind: r.kind as MemoryEntry["kind"],
      type: r.type as MemoryEntry["type"],
      agent_id: r.agent_id,
      project_id: r.project_id || undefined,
      task_id: r.task_id || undefined,
      thread_id: r.thread_id || undefined,
      content: r.content,
      content_hash: r.content_hash,
      importance: r.importance,
      original_importance: r.original_importance,
      tags: Array.isArray(r.tags) ? r.tags : [],
      ttl_ms: r.ttl_ms > 0 ? r.ttl_ms : null,
      decay_rate: r.decay_rate || 0.5,
      source: (r.source || "manual") as MemoryEntry["source"],
      consolidated_from: Array.isArray(r.consolidated_from) ? r.consolidated_from : undefined,
      vector: r.vector || [],
    }));
  }

  close() {
    this.tables.clear();
    this.db.close();
  }
}
