// MemoryFacade — Unified entry point for the production memory system

import { logger } from "../logger.js";
import { MemoryStore } from "./store.js";
import { EmbeddingService, getEmbeddingService } from "./embeddings.js";
import { MemoryDedup } from "./dedup.js";
import { MemoryLifecycle } from "./lifecycle.js";
import { MemoryRetriever } from "./retrieval.js";
import { MemoryInjector } from "./injection.js";
import type {
  MemoryScope,
  MemoryEntry,
  MemoryQuery,
  MemoryInjection,
  DecayConfig,
  MemoryUpsertParams,
} from "./types.js";

export class MemoryFacade {
  private store: MemoryStore;
  private embedder: EmbeddingService;
  private dedup: MemoryDedup;
  private lifecycle: MemoryLifecycle;
  private retriever: MemoryRetriever;
  private injector: MemoryInjector;

  private constructor(
    store: MemoryStore,
    embedder: EmbeddingService,
  ) {
    this.store = store;
    this.embedder = embedder;
    this.dedup = new MemoryDedup(store, embedder);
    this.lifecycle = new MemoryLifecycle(store, this.dedup, embedder);
    this.retriever = new MemoryRetriever(store, embedder);
    this.injector = new MemoryInjector(this.retriever);
  }

  static async init(dir: string, _embedModel?: string): Promise<MemoryFacade> {
    const store = await MemoryStore.init(dir);
    const embedder = getEmbeddingService();
    return new MemoryFacade(store, embedder);
  }

  async upsert(params: MemoryUpsertParams): Promise<string | null> {
    return this.lifecycle.create({
      agent_id: params.agent_id,
      scope: params.scope,
      kind: params.kind,
      type: params.type,
      content: params.content,
      importance: params.importance ?? 0.5,
      tags: params.tags ?? [],
      project_id: params.project_id,
      task_id: params.task_id,
      thread_id: params.thread_id,
      ttl_ms: params.ttl_hours ? params.ttl_hours * 3600000 : null,
      decay_rate: params.decay_rate ?? 0.5,
      source: params.source ?? "manual",
    });
  }

  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.retriever.hybridSearch(query);
  }

  async searchByTag(scope: MemoryScope, agentId: string, tag: string, topK = 20): Promise<MemoryEntry[]> {
    return this.retriever.searchByTag(scope, agentId, tag, topK);
  }

  async injectForSession(
    agentId: string,
    userMessage: string,
    systemPrompt: string,
    wakeContext: string,
  ): Promise<MemoryInjection> {
    return this.injector.injectForSession(agentId, userMessage, systemPrompt, wakeContext);
  }

  async injectForProactiveWork(agentId: string, domainContext: string): Promise<string> {
    return this.injector.injectForProactiveWork(agentId, domainContext);
  }

  async injectForTask(agentId: string, taskDescription: string): Promise<string> {
    return this.injector.injectForTask(agentId, taskDescription);
  }

  async consolidate(scope: MemoryScope, agentId: string, tag: string): Promise<string | null> {
    return this.lifecycle.consolidate(scope, agentId, tag);
  }

  async runDecay(config: DecayConfig): Promise<{ decayed: number; consolidated: number }> {
    return this.lifecycle.runDecay(config);
  }

  async forget(scope: MemoryScope, id: string): Promise<boolean> {
    const deleted = await this.store.deleteById(scope, id);
    return deleted > 0;
  }

  async forgetByTag(scope: MemoryScope, agentId: string, tag: string): Promise<number> {
    const memories = await this.retriever.searchByTag(scope, agentId, tag, 1000);
    let deleted = 0;
    for (const m of memories) {
      const ok = await this.store.deleteById(scope, m.id);
      if (ok > 0) deleted++;
    }
    return deleted;
  }

  async stats(): Promise<Record<MemoryScope, { total: number; perAgent: Record<string, number> }>> {
    return this.retriever.stats();
  }

  close(): void {
    this.store.close();
    logger.info("MemoryFacade closed");
  }
}

let facade: MemoryFacade | null = null;

export async function getMemoryFacade(): Promise<MemoryFacade> {
  if (!facade) {
    facade = await MemoryFacade.init(
      process.env.LANCEDB_DIR || ".lancedb",
      process.env.OLLAMA_EMBED_MODEL,
    );
    logger.info("MemoryFacade initialized");
  }
  return facade;
}

export { MemoryStore } from "./store.js";
export { EmbeddingService, getEmbeddingService } from "./embeddings.js";
export { MemoryDedup } from "./dedup.js";
export { MemoryLifecycle } from "./lifecycle.js";
export { MemoryRetriever } from "./retrieval.js";
export { MemoryInjector } from "./injection.js";
export type {
  MemoryScope,
  MemoryKind,
  MemoryType,
  MemorySource,
  MemoryEntry,
  MemoryQuery,
  MemoryInjection,
  DecayConfig,
  MemoryUpsertParams,
} from "./types.js";
