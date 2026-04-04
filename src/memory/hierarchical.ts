// Three-Tier Memory Hierarchy
// 1. Personal Memory — Agent's private thoughts
// 2. Project Memory — Shared among team members
// 3. Company Memory — All agents can access

import { connect, type Table } from "@lancedb/lancedb";
import ollama from "ollama";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { cfg } from "../config.js";

export type MemoryScope = "personal" | "project" | "company";

export type MemoryEntry = {
  id?: string;
  ts?: string;
  scope: MemoryScope;
  type: "note" | "obs" | "io" | "log" | "decision" | "meeting" | "insight";
  agent_id?: string; // For personal memory
  project_id?: string; // For project memory
  content: string;
  importance?: number;
  tags?: string[];
  ttl?: string | null;
  vector?: number[];
};

export class HierarchicalMemory {
  private personalDBs: Map<string, Table> = new Map();
  private projectDBs: Map<string, Table> = new Map();
  private companyDB?: Table;
  private lancedbDir: string;

  private constructor(lancedbDir: string) {
    this.lancedbDir = lancedbDir;
  }

  static async init(lancedbDir: string): Promise<HierarchicalMemory> {
    const hm = new HierarchicalMemory(lancedbDir);
    // Company memory is shared
    await hm.initCompanyMemory();
    return hm;
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const model = cfg.ollamaEmbedModel;
    const emb = await ollama.embed({ model, input: text });
    return emb.embeddings[0] as number[];
  }

  private async initCompanyMemory() {
    const db = await connect(this.lancedbDir);
    try {
      this.companyDB = await db.openTable("company_memory");
    } catch {
      // Seed with initial record
      const vector = await this.getEmbedding("company initialization");
      this.companyDB = await db.createTable("company_memory", [{
        id: uuidv4(),
        ts: new Date().toISOString(),
        scope: "company",
        type: "log",
        content: "Company memory initialized",
        importance: 0,
        tags: ["init"],
        vector
      }]);
    }
    logger.info("Company memory initialized");
  }

  private async getPersonalTable(agentId: string): Promise<Table> {
    if (this.personalDBs.has(agentId)) {
      return this.personalDBs.get(agentId)!;
    }
    const db = await connect(this.lancedbDir);
    const tableName = `personal_${agentId}`;
    let table: Table;
    try {
      table = await db.openTable(tableName);
    } catch {
      const vector = await this.getEmbedding("agent initialization");
      table = await db.createTable(tableName, [{
        id: uuidv4(),
        ts: new Date().toISOString(),
        scope: "personal",
        agent_id: agentId,
        type: "log",
        content: "Personal memory initialized",
        importance: 0,
        tags: ["init"],
        vector
      }]);
    }
    this.personalDBs.set(agentId, table);
    return table;
  }

  private async getProjectTable(projectId: string): Promise<Table> {
    if (this.projectDBs.has(projectId)) {
      return this.projectDBs.get(projectId)!;
    }
    const db = await connect(this.lancedbDir);
    const tableName = `project_${projectId}`;
    let table: Table;
    try {
      table = await db.openTable(tableName);
    } catch {
      const vector = await this.getEmbedding("project initialization");
      table = await db.createTable(tableName, [{
        id: uuidv4(),
        ts: new Date().toISOString(),
        scope: "project",
        project_id: projectId,
        type: "log",
        content: "Project memory initialized",
        importance: 0,
        tags: ["init"],
        vector
      }]);
    }
    this.projectDBs.set(projectId, table);
    return table;
  }

  async upsert(entry: MemoryEntry): Promise<string> {
    const id = entry.id || uuidv4();
    const ts = entry.ts || new Date().toISOString();
    const vector = await this.getEmbedding(entry.content);
    
    const record = { ...entry, id, ts, vector };
    
    let table: Table;
    switch (entry.scope) {
      case "personal":
        if (!entry.agent_id) throw new Error("Personal memory requires agent_id");
        table = await this.getPersonalTable(entry.agent_id);
        break;
      case "project":
        if (!entry.project_id) throw new Error("Project memory requires project_id");
        table = await this.getProjectTable(entry.project_id);
        break;
      case "company":
        table = this.companyDB!;
        break;
    }
    
    await table.add([record]);
    logger.debug({ id, scope: entry.scope }, "Memory upsert");
    return id;
  }

  async search(scope: MemoryScope, query: string, options: {
    agent_id?: string;
    project_id?: string;
    top_k?: number;
    min_importance?: number;
    tags?: string[];
  }): Promise<any[]> {
    const vector = await this.getEmbedding(query);
    const topK = options.top_k || 10;
    
    let table: Table | undefined;
    switch (scope) {
      case "personal":
        if (!options.agent_id) throw new Error("Personal search requires agent_id");
        table = await this.getPersonalTable(options.agent_id);
        break;
      case "project":
        if (!options.project_id) throw new Error("Project search requires project_id");
        table = await this.getProjectTable(options.project_id);
        break;
      case "company":
        table = this.companyDB;
        break;
    }
    
    if (!table) return [];
    
    const results = await table.search(vector).limit(topK * 2).toArray();
    
    // Filter results
    let filtered = results.filter((r: any) => {
      if (options.min_importance !== undefined && r.importance < options.min_importance) return false;
      if (options.tags && options.tags.length > 0) {
        const recordTags = r.tags || [];
        if (!options.tags.some(t => recordTags.includes(t))) return false;
      }
      return true;
    });
    
    // Re-rank by importance and recency
    filtered = filtered.sort((a: any, b: any) => {
      const importanceDiff = (b.importance || 0) - (a.importance || 0);
      if (Math.abs(importanceDiff) > 0.1) return importanceDiff;
      return new Date(b.ts).getTime() - new Date(a.ts).getTime();
    });
    
    return filtered.slice(0, topK);
  }

  // Convenience methods
  async searchPersonal(agentId: string, query: string, topK?: number) {
    return this.search("personal", query, { agent_id: agentId, top_k: topK });
  }

  async searchProject(projectId: string, query: string, topK?: number) {
    return this.search("project", query, { project_id: projectId, top_k: topK });
  }

  async searchCompany(query: string, topK?: number) {
    return this.search("company", query, { top_k: topK });
  }

  // Cross-scope search (searches all accessible memories for an agent)
  async searchAll(agentId: string, query: string, options: {
    project_ids?: string[];
    top_k?: number;
  }): Promise<{ scope: MemoryScope; entries: any[] }[]> {
    const [personalResult, companyResult] = await Promise.allSettled([
      this.searchPersonal(agentId, query, options.top_k),
      this.searchCompany(query, options.top_k)
    ]);
    const personal = personalResult.status === "fulfilled" ? personalResult.value : [];
    const company = companyResult.status === "fulfilled" ? companyResult.value : [];
    if (personalResult.status === "rejected" || companyResult.status === "rejected") {
      logger.warn({
        personalOk: personalResult.status === "fulfilled",
        companyOk: companyResult.status === "fulfilled",
      }, "searchAll: partial scope failure");
    }
    
    const projectMemories: any[] = [];
    if (options.project_ids) {
      for (const projectId of options.project_ids) {
        const entries = await this.searchProject(projectId, query, options.top_k);
        projectMemories.push(...entries);
      }
    }
    
    return [
      { scope: "personal", entries: personal },
      { scope: "project", entries: projectMemories },
      { scope: "company", entries: company }
    ];
  }
}

export default HierarchicalMemory;
