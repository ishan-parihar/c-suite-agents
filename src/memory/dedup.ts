// Deduplication — Content hashing + near-duplicate detection

import { createHash } from "node:crypto";
import type { MemoryEntry, MemoryScope } from "./types";
import type { MemoryStore } from "./store";
import type { EmbeddingService } from "./embeddings";
import { logger } from "../logger";

export class MemoryDedup {
  constructor(
    private store: MemoryStore,
    private embedder: EmbeddingService,
  ) {}

  async isDuplicate(
    scope: MemoryScope,
    agentId: string,
    content: string,
  ): Promise<{ isDup: boolean; existingId?: string }> {
    const hash = this.hashContent(content);

    const exact = await this.exactMatchCheck(scope, hash, agentId);
    if (exact) {
      logger.debug({ existingId: exact }, "Exact duplicate found");
      return { isDup: true, existingId: exact };
    }

    const similar = await this.store.search(scope, await this.embedder.embed(content), {
      agent_id: agentId,
      query: content.slice(0, 200),
      scopes: [scope],
      top_k: 3,
      min_importance: 0.3,
    });

    for (const s of similar) {
      const sim = this.cosineSimilarity(await this.embedder.embed(content), s.vector);
      const levSim = this.levenshteinSimilarity(content, s.content);
      if (sim > 0.95 && levSim > 0.9) {
        logger.debug({ existingId: s.id, similarity: sim, levenshtein: levSim }, "Near-duplicate found");
        return { isDup: true, existingId: s.id };
      }
    }

    return { isDup: false };
  }

  private async exactMatchCheck(scope: MemoryScope, hash: string, agentId: string): Promise<string | null> {
    const all = await this.store.getAll(scope, agentId);
    const match = all.find(e => e.content_hash === hash);
    return match ? match.id : null;
  }

  private hashContent(content: string): string {
    return createHash("sha256").update(content.trim()).digest("hex");
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private levenshteinSimilarity(a: string, b: string): number {
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    if (long.length === 0) return 1.0;
    const dist = this.levenshteinDistance(short, long);
    return (long.length - dist) / long.length;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }
}
