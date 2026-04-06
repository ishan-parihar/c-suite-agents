// Skill Registry — Dynamic skill discovery and injection
// Discovers SKILL.md files in workspace directories, indexes them,
// and returns relevant skills based on query matching.
//
// Inspired by OpenClaw's SKILL.md pattern — skills are instruction-only
// markdown playbooks injected into the system prompt at runtime.

import * as fs from "fs";
import * as path from "path";
import { logger } from "../logger.js";

// =========================================================================
// Skill Interface
// =========================================================================

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  directory: string;
  triggers: string[];
}

// =========================================================================
// YAML-like Header Parser
// =========================================================================

/**
 * Parse the YAML-like frontmatter header from a SKILL.md file.
 * Expected format:
 * ---
 * name: "My Skill"
 * description: "What this does"
 * triggers: ["keyword1", "keyword2"]
 * ---
 * Returns { header, body } where body is everything after the closing ---.
 */
export function parseSkillMarkdown(raw: string): {
  name: string;
  description: string;
  triggers: string[];
  body: string;
} | null {
  const trimmed = raw.trim();

    if (!trimmed.startsWith("---")) return null;

  const secondDash = trimmed.indexOf("\n---", 4);
  if (secondDash === -1) return null;

  const headerBlock = trimmed.slice(4, secondDash).trim();
  const body = trimmed.slice(secondDash + 4).trim();

  const name = extractQuotedField(headerBlock, "name");
  const description = extractQuotedField(headerBlock, "description");
  const triggers = extractArrayField(headerBlock, "triggers");

  if (!name) return null;

  return {
    name,
    description: description || "",
    triggers: triggers || [],
    body,
  };
}

function extractQuotedField(header: string, field: string): string | null {
  const regex = new RegExp(`^\\s*${field}\\s*:\\s*["']([^"']*)["']`, "m");
  const match = header.match(regex);
  return match ? match[1] : null;
}

function extractArrayField(header: string, field: string): string[] | null {
  const regex = new RegExp(`^\\s*${field}\\s*:\\s*\\[([^\\]]*)\\]`, "m");
  const match = header.match(regex);
  if (!match) return null;

  const inner = match[1].trim();
  if (!inner) return [];

  const items: string[] = [];
  const itemRegex = /["']([^"']*)["']/g;
  let m;
  while ((m = itemRegex.exec(inner)) !== null) {
    items.push(m[1]);
  }
  return items.length > 0 ? items : null;
}

// =========================================================================
// Skill Discovery
// =========================================================================

/**
 * Walk a directory recursively and find all SKILL.md files.
 * Returns array of { filePath, directory }.
 */
function discoverSkillFiles(dir: string): { filePath: string; directory: string }[] {
  const results: { filePath: string; directory: string }[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...discoverSkillFiles(fullPath));
    } else if (entry.name === "SKILL.md") {
      results.push({ filePath: fullPath, directory: dir });
    }
  }

  return results;
}

// =========================================================================
// Caching by Directory mtime
// =========================================================================

interface CachedSkills {
  skills: Skill[];
  mtimeMs: number;
  directory: string;
}

/** Module-level cache: workspaceDir → cached skills */
const skillsCache = new Map<string, CachedSkills>();

/**
 * Get the most recent mtime across a directory tree.
 * Only checks immediate children directories (skills/<name>/) for performance.
 */
function getDirectoryMtime(dir: string): number {
  try {
    const stat = fs.statSync(dir);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Get the mtime of the skills subdirectory if it exists.
 */
function getSkillsDirMtime(skillsDir: string): number {
  if (!fs.existsSync(skillsDir)) return 0;
  return getDirectoryMtime(skillsDir);
}

// =========================================================================
// Skill Index
// =========================================================================

/**
 * Pre-computed searchable index for a skill.
 */
interface SkillIndexEntry {
  skill: Skill;
  /** Lowercase searchable terms from name, description, and triggers */
  searchTerms: string[];
}

// =========================================================================
// SkillRegistry Class
// =========================================================================

export class SkillRegistry {
  private skills: Skill[] = [];
  private searchIndex: SkillIndexEntry[] = [];
  private idMap = new Map<string, Skill>();

  /**
   * Discover all SKILL.md files in a workspace directory.
   * Looks in <workspaceDir>/skills/ subdirectory following the convention:
   * ~/.strategos/agents/<agent-name>/skills/<skill-name>/SKILL.md
   *
   * Uses mtime-based caching to avoid repeated file reads.
   */
  async discover(workspaceDir: string): Promise<Skill[]> {
    const skillsDir = path.join(workspaceDir, "skills");
    const currentMtime = getSkillsDirMtime(skillsDir);

    const cached = skillsCache.get(workspaceDir);
    if (cached && cached.mtimeMs === currentMtime && cached.directory === workspaceDir) {
      logger.debug({ workspaceDir, skillCount: cached.skills.length }, "Skill registry cache hit");
      this.skills = cached.skills;
      this.buildIndex();
      return this.skills;
    }

    const skillFiles = discoverSkillFiles(skillsDir);
    const discovered: Skill[] = [];

    for (const { filePath, directory } of skillFiles) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = parseSkillMarkdown(raw);
        if (!parsed) {
          logger.warn({ filePath }, "Failed to parse SKILL.md — invalid header");
          continue;
        }

        const skillDirName = path.basename(directory);
        const id = `skill-${skillDirName}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

        discovered.push({
          id,
          name: parsed.name,
          description: parsed.description,
          content: parsed.body,
          directory,
          triggers: parsed.triggers,
        });
      } catch (err: any) {
        logger.warn({ filePath, error: err.message }, "Failed to read SKILL.md");
      }
    }

    this.skills = discovered;
    this.buildIndex();

    if (currentMtime > 0) {
      skillsCache.set(workspaceDir, {
        skills: discovered,
        mtimeMs: currentMtime,
        directory: workspaceDir,
      });
    }

    logger.info({ workspaceDir, skillCount: discovered.length }, "Skill registry discovered skills");
    return this.skills;
  }

  /**
   * Build a searchable index from the current skills array.
   * Creates lowercase search terms from name, description, and triggers.
   */
  index(): void {
    this.buildIndex();
  }

  private buildIndex(): void {
    this.searchIndex = [];
    this.idMap.clear();

    for (const skill of this.skills) {
      this.idMap.set(skill.id, skill);

      const terms = new Set<string>();

      for (const word of skill.name.toLowerCase().split(/\s+/)) {
        if (word.length > 1) terms.add(word);
      }

      for (const word of skill.description.toLowerCase().split(/\s+/)) {
        if (word.length > 1) terms.add(word);
      }

      for (const trigger of skill.triggers) {
        terms.add(trigger.toLowerCase());
      }

      this.searchIndex.push({
        skill,
        searchTerms: Array.from(terms),
      });
    }
  }

  /**
   * Find skills relevant to the given query.
   * Case-insensitive keyword matching against name, description, and triggers.
   * Returns skills ranked by number of matching terms (highest first).
   */
  findRelevant(query: string, limit?: number): Skill[] {
    const queryTokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 1);

    if (queryTokens.length === 0) return [];

    const scored = this.searchIndex.map(({ skill, searchTerms }) => {
      let score = 0;
      for (const token of queryTokens) {
        for (const term of searchTerms) {
          if (term === token || term.includes(token) || token.includes(term)) {
            score += 1;
            break;
          }
        }
      }
      return { skill, score };
    });

    const matches = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.skill);

    if (limit && limit > 0) {
      return matches.slice(0, limit);
    }

    return matches;
  }

  /**
   * Look up a skill by its ID.
   */
  getById(id: string): Skill | undefined {
    return this.idMap.get(id);
  }

  /**
   * Get all discovered skills.
   */
  getAll(): Skill[] {
    return [...this.skills];
  }

  /**
   * Clear the cache for a specific workspace or all workspaces.
   */
  static clearCache(workspaceDir?: string): void {
    if (workspaceDir) {
      skillsCache.delete(workspaceDir);
    } else {
      skillsCache.clear();
    }
  }

  /**
   * Get cache statistics.
   */
  static getCacheStats(): { entries: number; workspaces: string[] } {
    return {
      entries: skillsCache.size,
      workspaces: Array.from(skillsCache.keys()),
    };
  }
}
