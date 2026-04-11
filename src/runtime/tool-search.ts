import { buildToolDefinitions, getAllToolDefinitions, type ToolDefinition, type PermissionTier } from "./tool-bridge";

export interface ToolSearchResult {
  name: string;
  description: string;
  permissionTier: PermissionTier;
  matchScore: number;
}

/**
 * Check if `term` is a subsequence of `target` (characters appear in order, not necessarily contiguous).
 * Hard-limited to 12 chars to prevent ReDoS-style abuse.
 */
function isSubsequence(term: string, target: string): boolean {
  if (term.length > 12) return false;
  let ti = 0;
  for (let i = 0; i < target.length && ti < term.length; i++) {
    if (target[i] === term[ti]) ti++;
  }
  return ti === term.length;
}

export class ToolSearch {
  private tools: ToolDefinition[];

  constructor(tools: ToolDefinition[]) {
    this.tools = tools;
  }

  search(query: string, maxResults = 10): ToolSearchResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const scored: ToolSearchResult[] = this.tools
      .map(tool => {
        const nameLower = tool.name.toLowerCase();
        const descLower = tool.description.toLowerCase();
        let score = 0;

        for (const term of terms) {
          const nameIdx = nameLower.indexOf(term);
          if (nameIdx !== -1) {
            score += nameIdx === 0 ? 10 : 5;
          }

          if (descLower.includes(term)) {
            score += 2;
          }

          if (isSubsequence(term, tool.name)) {
            score += 3;
          }
        }

        return {
          name: tool.name,
          description: tool.description,
          permissionTier: tool.permissionTier ?? "read",
          matchScore: score,
        };
      })
      .filter(r => r.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);

    return scored.slice(0, maxResults);
  }
}

import { LruMap } from "./utils";

const instances = new LruMap<string, ToolSearch>(50);

/**
 * Get or create a ToolSearch instance scoped to a specific agent.
 * Each agent gets its own search index based on the tools available to it.
 */
export function getSearchForAgent(agentId: string, scopedToolNames: string[]): ToolSearch {
  if (!instances.has(agentId)) {
    const scopedDefs = buildToolDefinitions(scopedToolNames);
    instances.set(agentId, new ToolSearch(scopedDefs));
  }
  return instances.get(agentId)!;
}

/**
 * Remove a ToolSearch instance when an agent is removed.
 */
export function removeInstance(agentId: string): void {
  instances.delete(agentId);
}

/**
 * Clear all cached ToolSearch instances. Call during shutdown to release memory.
 */
export function cleanupAll(): void {
  instances.clear();
}

/** @deprecated Use getSearchForAgent() instead. This searches ALL tools, ignoring agent scoping. */
export function searchTools(query: string, maxResults?: number): ToolSearchResult[] {
  const allTools = getAllToolDefinitions();
  const searcher = new ToolSearch(allTools);
  return searcher.search(query, maxResults);
}
