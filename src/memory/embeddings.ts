// Embedding Service — LRU cache + fallback + config-driven providers

import ollama from "ollama";
import { logger } from "../logger.js";
import { loadConfig } from "../config/loader.js";
import type { EmbeddingConfig } from "../config/schema.js";

const CACHE_SIZE = 5000;

class LRUCache<K, V> {
  private map: Map<K, V>;
  private max: number;

  constructor(max: number) {
    this.max = max;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }
}

export interface EmbeddingConfigInput {
  provider: string;
  model: string;
  fallbackModel?: string;
  baseUrl?: string;
  apiKey?: string;
  dimensions: number;
}

export class EmbeddingService {
  private cache: LRUCache<string, number[]>;
  private provider: string;
  private model: string;
  private fallbackModel: string;
  private dimensions: number;
  private baseUrl?: string;
  private apiKey?: string;

  constructor(config?: EmbeddingConfigInput) {
    this.provider = config?.provider || "ollama";
    this.model = config?.model || "nomic-embed-text";
    this.fallbackModel = config?.fallbackModel || "nomic-embed-text";
    this.baseUrl = config?.baseUrl;
    this.apiKey = config?.apiKey;
    this.dimensions = config?.dimensions || 1024;
    this.cache = new LRUCache(CACHE_SIZE);
  }

  async embed(text: string): Promise<number[]> {
    const key = this.hashKey(text);
    const cached = this.cache.get(key);
    if (cached) return cached;

    try {
      const vector = await this.callEmbedding(this.model, text);
      this.cache.set(key, vector);
      return vector;
    } catch (err: any) {
      logger.warn({ err: err.message, model: this.model }, "Primary embedding failed, trying fallback");
      try {
        const vector = await this.callEmbedding(this.fallbackModel, text);
        this.cache.set(key, vector);
        return vector;
      } catch (fallbackErr: any) {
        logger.error({ err: fallbackErr.message }, "All embedding models failed, returning zero vector");
        return new Array(this.dimensions).fill(0);
      }
    }
  }

  private async callEmbedding(model: string, text: string): Promise<number[]> {
    if (this.provider === "ollama") {
      const result = await ollama.embed({ model, input: text });
      return result.embeddings[0] as number[];
    }

    // OpenAI-compatible providers (openai, qwen-proxy, etc.)
    const url = `${this.baseUrl}/embeddings`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model, input: text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Embedding API error ${response.status}: ${body}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      return data.data[0].embedding;
    } finally {
      clearTimeout(timeout);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const uncached: { index: number; text: string }[] = [];
    const results: number[][] = new Array(texts.length);

    for (let i = 0; i < texts.length; i++) {
      const key = this.hashKey(texts[i]);
      const cached = this.cache.get(key);
      if (cached) {
        results[i] = cached;
      } else {
        uncached.push({ index: i, text: texts[i] });
      }
    }

    if (uncached.length === 0) return results;

    try {
      const batchTexts = uncached.map(u => u.text);
      const batchResult = await this.callBatchEmbedding(this.model, batchTexts);

      for (let i = 0; i < uncached.length; i++) {
        const vector = batchResult[i];
        results[uncached[i].index] = vector;
        this.cache.set(this.hashKey(uncached[i].text), vector);
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Batch embed failed, falling back to individual");
      for (const u of uncached) {
        results[u.index] = await this.embed(u.text);
      }
    }

    return results;
  }

  private async callBatchEmbedding(model: string, texts: string[]): Promise<number[][]> {
    if (this.provider === "ollama") {
      const result = await ollama.embed({ model, input: texts });
      return result.embeddings as number[][];
    }

    // OpenAI-compatible providers
    const url = `${this.baseUrl}/embeddings`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Embedding API error ${response.status}: ${body}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      return data.data.map(item => item.embedding);
    } finally {
      clearTimeout(timeout);
    }
  }

  clearCache(): void {
    this.cache = new LRUCache(CACHE_SIZE);
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  get dim(): number {
    return this.dimensions;
  }

  private hashKey(text: string): string {
    let hash = 0;
    const str = text.trim().slice(0, 200);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }
}

let embeddingService: EmbeddingService | null = null;

export function getEmbeddingService(embeddingConfig?: EmbeddingConfigInput): EmbeddingService {
  if (!embeddingService) {
    let embedCfg: EmbeddingConfigInput | undefined = embeddingConfig;
    if (!embedCfg) {
      try {
        const cfg = loadConfig();
        if (cfg.embedding) {
          embedCfg = cfg.embedding as EmbeddingConfigInput;
        }
      } catch { /* use defaults */ }
    }
    embeddingService = new EmbeddingService(embedCfg);
  }
  return embeddingService;
}
