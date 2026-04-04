// Memory Type Definitions — Production Memory System

export type MemoryScope = "personal" | "project" | "company";
export type MemoryKind = "episodic" | "semantic" | "procedural";
export type MemoryType = "note" | "obs" | "io" | "log" | "decision" | "meeting" | "insight";
export type MemorySource = "manual" | "proactive" | "scheduled" | "conversation" | "system";

export interface MemoryEntry {
  id: string;
  ts: number;
  scope: MemoryScope;
  kind: MemoryKind;
  type: MemoryType;
  agent_id: string;
  project_id?: string;
  task_id?: string;
  thread_id?: string;
  content: string;
  content_hash: string;
  importance: number;
  original_importance: number;
  tags: string[];
  ttl_ms: number | null;
  decay_rate: number;
  source: MemorySource;
  consolidated_from?: string[];
  vector: number[];
}

export interface MemoryQuery {
  agent_id: string;
  query: string;
  scopes: MemoryScope[];
  kinds?: MemoryKind[];
  tags?: string[];
  tag_match?: "any" | "all";
  date_from?: number;
  date_to?: number;
  min_importance?: number;
  top_k: number;
  agent_ids?: string[];
  project_ids?: string[];
}

export interface MemoryInjection {
  system_prompt_addition: string;
  relevant_memories: MemoryEntry[];
  token_budget_used: number;
  token_budget_remaining: number;
}

export interface DecayConfig {
  half_life_hours: number;
  min_importance: number;
  archive_threshold: number;
}

export interface MemoryUpsertParams {
  agent_id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  type: MemoryType;
  content: string;
  importance?: number;
  tags?: string[];
  project_id?: string;
  task_id?: string;
  thread_id?: string;
  ttl_hours?: number;
  decay_rate?: number;
  source?: MemorySource;
}
