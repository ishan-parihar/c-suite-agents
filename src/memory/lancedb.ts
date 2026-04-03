import { connect, type Table } from "@lancedb/lancedb";
import ollama from "ollama";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { cfg } from "../config.js";
import { validateAgentIdentity } from "../auth/session.js";

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
  private constructor(private dir: string, private events?: Table) {}

  static async init(dir: string) {
    const db = await connect(dir);
    let events: Table | undefined;
    try {
      events = await db.openTable("events");
    } catch {
      // If the events table does not exist, initialize it with a seed record
      const model = cfg.ollamaEmbedModel;
      const emb = await ollama.embed({ model, input: "init" });
      const vector = emb.embeddings[0] as number[];
      events = await db.createTable("events", [
        {
          id: uuidv4(),
          ts: new Date().toISOString(),
          type: "log",
          agent_id: "strategos",
          content: "init",
          importance: 0,
          tags: ["init"],
          vector,
        },
      ]);
    }
    return new Memory(dir, events);
  }

  async ensureAgent(agentId: string) {
    const validation = await validateAgentIdentity(agentId);
    if (!validation.valid) {
      throw new Error(`Invalid agent ID: ${agentId}. ${validation.reason}`);
    }
    logger.debug({ agentId, isStaff: validation.isStaff, isHired: validation.isHired }, "Agent validated");
  }

  async upsertEvent(e: MemoryEvent): Promise<string> {
    const id = e.id || uuidv4();
    const ts = e.ts || new Date().toISOString();
    const model = cfg.ollamaEmbedModel;
    const emb = await ollama.embed({ model, input: e.content });
    const vector = emb.embeddings[0] as number[];
    await this.events!.add([{ ...e, id, ts, vector }]);
    logger.debug({ id }, "memory.upsert");
    return id;
  }

  async search(agentId: string, query: string, topK = 5, _filter?: Record<string, any>) {
    await this.ensureAgent(agentId);
    const model = cfg.ollamaEmbedModel;
    const emb = await ollama.embed({ model, input: query });
    const vector = emb.embeddings[0] as number[];
    const safeAgentId = agentId.replace(/'/g, "''");
    const rows = await this.events!
      .search(vector)
      .where(`agent_id = '${safeAgentId}'`)
      .limit(topK)
      .toArray();
    return rows;
  }
}
