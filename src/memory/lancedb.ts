import { connect, type Connection, type Table } from "@lancedb/lancedb";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { validateAgentIdentity } from "../auth/session.js";
import { getEmbeddingService } from "./embeddings.js";

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

export type MemoryEvent = {
  id?: string;
  ts?: string;
  type: "note" | "obs" | "io" | "log";
  agent_id: string;
  project_id?: string;
  task_id?: string;
  content: string;
  importance?: number;
  tags?: string[];
  ttl?: string | null;
  vector?: number[];
};

export class Memory {
  private keywordIndex: Map<string, Set<string>> = new Map();
  private indexBuilt = false;
  private conn: Connection;
  private events?: Table;

  private constructor(_dir: string, conn: Connection, events?: Table) {
    this.conn = conn;
    this.events = events;
  }

  static async init(dir: string) {
    const conn = await connect(dir);
    let events: Table | undefined;
    try {
      events = await conn.openTable("events");
    } catch {
      const embedder = getEmbeddingService();
      const vector = await embedder.embed("init");
      events = await conn.createTable("events", [
        {
          id: uuidv4(),
          ts: new Date().toISOString(),
          type: "log",
          agent_id: "ceo-strategic",
          content: "init",
          importance: 0,
          tags: ["init"],
          vector,
        },
      ]);
    }
    return new Memory(dir, conn, events);
  }

  async ensureAgent(agentId: string) {
    try {
      await validateAgentIdentity(agentId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid agent ID: ${agentId}. ${msg}`);
    }
    logger.debug({ agentId }, "Agent validated");
  }

  async upsertEvent(e: MemoryEvent): Promise<string> {
    const id = e.id || uuidv4();
    const ts = e.ts || new Date().toISOString();
    const embedder = getEmbeddingService();
    const vector = await embedder.embed(e.content);
    await this.events!.add([{ ...e, id, ts, vector }]);
    this.updateKeywordIndex(id, e);
    logger.debug({ id }, "memory.upsert");
    return id;
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

  private async buildKeywordIndex() {
    const rows = await this.events!.query().toArray() as any[];
    const index = new Map<string, Set<string>>();
    for (const row of rows) {
      const words = new Set<string>();
      this.extractWords(row.content || "").forEach(w => words.add(w));
      if (Array.isArray(row.tags)) {
        for (const tag of row.tags) {
          this.extractWords(tag).forEach(w => words.add(w));
        }
      }
      this.extractWords(row.type || "").forEach(w => words.add(w));
      index.set(row.id, words);
    }
    this.keywordIndex = index;
    this.indexBuilt = true;
  }

  private updateKeywordIndex(id: string, e: MemoryEvent) {
    const words = new Set<string>();
    this.extractWords(e.content).forEach(w => words.add(w));
    if (e.tags) {
      for (const tag of e.tags) {
        this.extractWords(tag).forEach(w => words.add(w));
      }
    }
    this.extractWords(e.type).forEach(w => words.add(w));
    this.keywordIndex.set(id, words);
    this.indexBuilt = true;
  }

  async searchKeyword(agentId: string, query: string, topK = 10): Promise<any[]> {
    if (!this.indexBuilt) {
      await this.buildKeywordIndex();
    }

    const queryWords = this.extractWords(query);
    if (queryWords.size === 0) return [];

    const agentRows = await this.events!.query().where(`agent_id = "${agentId}"`).toArray() as any[];

    const results: Array<{ row: any; matchCount: number }> = [];

    for (const row of agentRows) {
      const entryWords = this.keywordIndex.get(row.id);
      if (!entryWords) continue;

      let matchCount = 0;
      for (const qw of queryWords) {
        if (entryWords.has(qw)) matchCount++;
      }

      if (matchCount > 0) {
        results.push({ row, matchCount });
      } else {
        const lowerContent = (row.content || "").toLowerCase();
        const lowerTags = Array.isArray(row.tags) ? row.tags.map((t: string) => t.toLowerCase()).join(" ") : "";
        const lowerType = (row.type || "").toLowerCase();
        const fullText = `${lowerContent} ${lowerTags} ${lowerType}`;
        for (const qw of queryWords) {
          if (fullText.includes(qw)) {
            matchCount++;
            results.push({ row, matchCount });
            break;
          }
        }
      }
    }

    results.sort((a, b) => b.matchCount - a.matchCount);
    return results.slice(0, topK).map(r => r.row);
  }

  async searchHybrid(agentId: string, query: string, topK = 15): Promise<any[]> {
    await this.ensureAgent(agentId);

    const results = await Promise.allSettled([
      this.searchVector(agentId, query, topK),
      this.searchKeyword(agentId, query, topK),
    ]);

    const vectorResult = results[0];
    const keywordResult = results[1];

    let vectorResults: any[] = [];
    let keywordResults: any[] = [];

    if (vectorResult.status === "fulfilled") {
      vectorResults = vectorResult.value;
    }
    if (keywordResult.status === "fulfilled") {
      keywordResults = keywordResult.value;
    }

    if (vectorResult.status === "rejected" && keywordResult.status === "rejected") {
      throw new Error(
        `Hybrid search failed entirely. Vector: ${vectorResult.reason?.message ?? "unknown"}. Keyword: ${keywordResult.reason?.message ?? "unknown"}`,
      );
    }

    const seen = new Set<string>();
    const merged: any[] = [];

    for (const r of vectorResults) {
      const id = r.id || "";
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(r);
      }
    }
    for (const r of keywordResults) {
      const id = r.id || "";
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(r);
      }
    }

    return merged.slice(0, topK);
  }

  private async searchVector(agentId: string, query: string, topK: number): Promise<any[]> {
    const embedder = getEmbeddingService();
    const vector = await embedder.embed(query);
    const rows = await this.events!
      .search(vector)
      .limit(topK * 3)
      .toArray();
    return rows.filter((r: any) => r.agent_id === agentId);
  }

  async search(agentId: string, query: string, topK = 5, _filter?: Record<string, any>) {
    return this.searchHybrid(agentId, query, topK);
  }

  close() {
    this.conn.close();
    this.events = null as unknown as Table;
  }
}
