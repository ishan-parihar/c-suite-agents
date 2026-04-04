// Memory Lifecycle — TTL, decay, consolidation pipeline

import { createHash } from "node:crypto";
import { logger } from "../logger.js";
import { getNativeRuntime } from "../runtime/native-agent-runtime.js";
import type { MemoryStore } from "./store.js";
import type { EmbeddingService } from "./embeddings.js";
import type { MemoryDedup } from "./dedup.js";
import type { MemoryScope, MemoryEntry, DecayConfig } from "./types.js";
import { v4 as uuidv4 } from "uuid";

export class MemoryLifecycle {
  constructor(
    private store: MemoryStore,
    private dedup: MemoryDedup,
    private embedder: EmbeddingService,
  ) {}

  async create(entry: {
    agent_id: string;
    scope: MemoryScope;
    kind: MemoryEntry["kind"];
    type: MemoryEntry["type"];
    content: string;
    importance: number;
    tags: string[];
    project_id?: string;
    task_id?: string;
    thread_id?: string;
    ttl_ms: number | null;
    decay_rate: number;
    source: MemoryEntry["source"];
  }): Promise<string | null> {
    const dup = await this.dedup.isDuplicate(entry.scope, entry.agent_id, entry.content);
    if (dup.isDup) {
      logger.debug({ existingId: dup.existingId }, "Memory deduplicated — skipping");
      return null;
    }

    const vector = await this.embedder.embed(entry.content);
    const fullEntry: MemoryEntry = {
      id: uuidv4(),
      ts: Date.now(),
      ...entry,
      content_hash: this.hashContent(entry.content),
      original_importance: entry.importance,
      vector,
    };

    await this.store.insert(entry.scope, fullEntry);
    logger.debug({ id: fullEntry.id, scope: entry.scope, agent_id: entry.agent_id }, "Memory created");
    return fullEntry.id;
  }

  async consolidate(scope: MemoryScope, agentId: string, tag: string): Promise<string | null> {
    const memories = await this.store.getAll(scope, agentId, tag);
    const recent = memories.filter(m => Date.now() - m.ts < 7 * 24 * 3600000);

    if (recent.length < 3) return null;

    const contentList = recent.slice(0, 15).map((m, i) => `${i + 1}. ${m.content}`).join("\n");
    const prompt = `Summarize these ${recent.length} memory entries about "${tag}" into a single concise insight (3-4 sentences max):\n\n${contentList}`;

    let summary: string;
    try {
      const runtime = getNativeRuntime();
      const sessionId = runtime.createSession("memory-consolidation");
      const result = await runtime.sendMessage(sessionId, prompt, "memory-consolidation");
      summary = result.text || `[Consolidation of ${recent.length} entries about ${tag}]`;
    } catch {
      summary = `[Consolidation of ${recent.length} entries about ${tag}]`;
    }

    const vector = await this.embedder.embed(summary);
    const consolidated: MemoryEntry = {
      id: uuidv4(),
      ts: Date.now(),
      scope,
      kind: "semantic",
      type: "insight",
      agent_id: agentId,
      content: summary,
      content_hash: this.hashContent(summary),
      importance: 0.8,
      original_importance: 0.8,
      tags: [tag, "consolidated"],
      ttl_ms: null,
      decay_rate: 0.1,
      source: "system",
      consolidated_from: recent.map(r => r.id),
      vector,
    };

    await this.store.insert(scope, consolidated);
    logger.info({ id: consolidated.id, sourceCount: recent.length, tag }, "Memories consolidated");

    for (const m of recent) {
      await this.store.deleteById(scope, m.id);
    }

    return consolidated.id;
  }

  async runDecay(config: DecayConfig): Promise<{ decayed: number; consolidated: number }> {
    let totalDecayed = 0;
    let totalExpired = 0;

    const scopes: MemoryScope[] = ["personal", "project", "company"];
    for (const scope of scopes) {
      totalDecayed += await this.store.decay(scope, config);
      totalExpired += await this.store.deleteExpired(scope);
    }

    logger.info({ decayed: totalDecayed, expired: totalExpired }, "Memory lifecycle decay run");
    return { decayed: totalDecayed, consolidated: 0 };
  }

  private hashContent(content: string): string {
    return createHash("sha256").update(content.trim()).digest("hex");
  }
}
