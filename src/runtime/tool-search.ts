import { getAllToolDefinitions, type ToolDefinition, type PermissionTier } from "./tool-bridge.js";

export interface ToolSearchResult {
  name: string;
  description: string;
  permissionTier: PermissionTier;
  matchScore: number;
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

          try {
            const fuzzy = new RegExp(term.split("").join(".*"), "i");
            if (fuzzy.test(tool.name)) {
              score += 3;
            }
          } catch {
            // skip invalid regex terms
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

let instance: ToolSearch | null = null;

function getInstance(): ToolSearch {
  if (!instance) {
    instance = new ToolSearch(getAllToolDefinitions());
  }
  return instance;
}

export function searchTools(query: string, maxResults?: number): ToolSearchResult[] {
  return getInstance().search(query, maxResults);
}
