/**
 * Config migration module — handles schema upgrades across versions.
 *
 * Pure functions: no side effects, no I/O, no disk writes.
 * The config loader calls `runMigrations` before Zod validation.
 *
 * Current version: 0.2.0 (from package.json).
 */

// ---------------------------------------------------------------------------
// Legacy key definitions
// ---------------------------------------------------------------------------

/**
 * Deprecated config keys that should be migrated to their modern equivalents.
 * Dot-notation strings represent nested keys (e.g. "ollama.baseUrl" means
 * `raw.ollama?.baseUrl`).
 */
export const LEGACY_KEYS: string[] = [
  "agent",            // → agents.defaults
  "ollama.baseUrl",   // → llm.provider = "ollama", llm.baseUrl
  "ollama.model",     // → llm.model
  "embedding.model",  // → deprecated (use llm for everything)
  "kanban.path",      // → paths.kanbanDb
  "memory.path",      // → paths.lancedb
  "log.path",         // → logging.file
  "log.level",        // → logging.level
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a dot-notation key into segments. */
function splitKey(key: string): string[] {
  return key.split(".");
}

/** Safely get a nested value by dot-path. */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = splitKey(path);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Safely set a nested value by dot-path, creating intermediate objects. */
function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = splitKey(path);
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (
      current[seg] === null ||
      typeof current[seg] !== "object" ||
      Array.isArray(current[seg])
    ) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
}

/** Safely delete a nested value by dot-path. */
function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const segments = splitKey(path);
  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || typeof current !== "object") return;
    current = (current as Record<string, unknown>)[segments[i]];
  }
  if (current !== null && typeof current === "object") {
    delete (current as Record<string, unknown>)[segments[segments.length - 1]];
  }
}

/** Remove an entire top-level key. */
function deleteTopLevel(obj: Record<string, unknown>, key: string): void {
  delete obj[key];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a raw config object contains any legacy keys.
 *
 * @returns Object with `found` boolean and `keys` array of matched legacy keys.
 */
export function hasLegacyKeys(
  raw: Record<string, unknown>,
): { found: boolean; keys: string[] } {
  const found: string[] = [];

  for (const legacyKey of LEGACY_KEYS) {
    // Top-level key (no dot)
    if (!legacyKey.includes(".")) {
      if (legacyKey in raw) {
        found.push(legacyKey);
      }
      continue;
    }

    // Nested key — check parent exists and child exists
    const [parent, ...rest] = splitKey(legacyKey);
    const parentObj = raw[parent];
    if (
      parentObj !== null &&
      typeof parentObj === "object" &&
      !Array.isArray(parentObj)
    ) {
      const childPath = rest.join(".");
      if (getByPath(parentObj as Record<string, unknown>, childPath) !== undefined) {
        found.push(legacyKey);
      }
    }
  }

  return { found: found.length > 0, keys: found };
}

/**
 * Migrate legacy config keys to their modern equivalents.
 *
 * Mutates the input object in place and returns migration status.
 *
 * @returns `{ migrated: boolean, warnings: string[] }`
 */
export function migrateLegacyConfig(
  raw: Record<string, unknown>,
): { migrated: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let migrated = false;

  const check = hasLegacyKeys(raw);
  if (!check.found) return { migrated: false, warnings: [] };

  for (const key of check.keys) {
    switch (key) {
      // ── agent → agents.defaults ──────────────────────────────────────
      case "agent": {
        const agentVal = raw.agent;
        if (agentVal !== undefined) {
          if (!raw.agents || typeof raw.agents !== "object") {
            raw.agents = {};
          }
          const agents = raw.agents as Record<string, unknown>;
          if (!agents.defaults || typeof agents.defaults !== "object") {
            agents.defaults = {};
          }
          // Merge agent into agents.defaults (existing values take priority)
          const defaults = agents.defaults as Record<string, unknown>;
          const agentObj =
            typeof agentVal === "object" && !Array.isArray(agentVal)
              ? (agentVal as Record<string, unknown>)
              : {};
          for (const [k, v] of Object.entries(agentObj)) {
            if (!(k in defaults)) {
              defaults[k] = v;
            }
          }
          deleteTopLevel(raw, "agent");
          migrated = true;
          warnings.push(
            'Migrated "agent" → "agents.defaults". Review the merged values.',
          );
        }
        break;
      }

      // ── ollama.baseUrl / ollama.model → llm.* ────────────────────────
      case "ollama.baseUrl": {
        const val = getByPath(raw, "ollama.baseUrl");
        if (val !== undefined) {
          if (!raw.llm || typeof raw.llm !== "object") {
            raw.llm = {};
          }
          const llm = raw.llm as Record<string, unknown>;
          if (llm.provider === undefined) {
            llm.provider = "ollama";
          }
          llm.baseUrl = val;
          deleteByPath(raw, "ollama.baseUrl");
          migrated = true;
          warnings.push(
            'Migrated "ollama.baseUrl" → "llm.baseUrl" (provider set to "ollama").',
          );
        }
        break;
      }

      case "ollama.model": {
        const val = getByPath(raw, "ollama.model");
        if (val !== undefined) {
          if (!raw.llm || typeof raw.llm !== "object") {
            raw.llm = {};
          }
          const llm = raw.llm as Record<string, unknown>;
          llm.model = val;
          // Ensure provider is ollama if not already set
          if (llm.provider === undefined) {
            llm.provider = "ollama";
          }
          deleteByPath(raw, "ollama.model");
          migrated = true;
          warnings.push('Migrated "ollama.model" → "llm.model".');
        }
        break;
      }

      // ── embedding.model → deprecated ─────────────────────────────────
      case "embedding.model": {
        const val = getByPath(raw, "embedding.model");
        if (val !== undefined) {
          deleteByPath(raw, "embedding.model");
          // Clean up empty embedding object
          if (
            raw.embedding &&
            typeof raw.embedding === "object" &&
            Object.keys(raw.embedding as Record<string, unknown>).length === 0
          ) {
            deleteTopLevel(raw, "embedding");
          }
          migrated = true;
          warnings.push(
            `Removed deprecated "embedding.model" (value: ${JSON.stringify(val)}). Use "llm.model" instead.`,
          );
        }
        break;
      }

      // ── kanban.path → paths.kanbanDb ─────────────────────────────────
      case "kanban.path": {
        const val = getByPath(raw, "kanban.path");
        if (val !== undefined) {
          if (!raw.paths || typeof raw.paths !== "object") {
            raw.paths = {};
          }
          const paths = raw.paths as Record<string, unknown>;
          paths.kanbanDb = val;
          deleteByPath(raw, "kanban.path");
          // Clean up empty kanban object
          if (
            raw.kanban &&
            typeof raw.kanban === "object" &&
            Object.keys(raw.kanban as Record<string, unknown>).length === 0
          ) {
            deleteTopLevel(raw, "kanban");
          }
          migrated = true;
          warnings.push('Migrated "kanban.path" → "paths.kanbanDb".');
        }
        break;
      }

      // ── memory.path → paths.lancedb ──────────────────────────────────
      case "memory.path": {
        const val = getByPath(raw, "memory.path");
        if (val !== undefined) {
          if (!raw.paths || typeof raw.paths !== "object") {
            raw.paths = {};
          }
          const paths = raw.paths as Record<string, unknown>;
          paths.lancedb = val;
          deleteByPath(raw, "memory.path");
          if (
            raw.memory &&
            typeof raw.memory === "object" &&
            Object.keys(raw.memory as Record<string, unknown>).length === 0
          ) {
            deleteTopLevel(raw, "memory");
          }
          migrated = true;
          warnings.push('Migrated "memory.path" → "paths.lancedb".');
        }
        break;
      }

      // ── log.path → logging.file ──────────────────────────────────────
      case "log.path": {
        const val = getByPath(raw, "log.path");
        if (val !== undefined) {
          if (!raw.logging || typeof raw.logging !== "object") {
            raw.logging = {};
          }
          const logging = raw.logging as Record<string, unknown>;
          logging.file = val;
          deleteByPath(raw, "log.path");
          migrated = true;
          warnings.push('Migrated "log.path" → "logging.file".');
        }
        break;
      }

      // ── log.level → logging.level ────────────────────────────────────
      case "log.level": {
        const val = getByPath(raw, "log.level");
        if (val !== undefined) {
          if (!raw.logging || typeof raw.logging !== "object") {
            raw.logging = {};
          }
          const logging = raw.logging as Record<string, unknown>;
          logging.level = val;
          deleteByPath(raw, "log.level");
          migrated = true;
          warnings.push('Migrated "log.level" → "logging.level".');
        }
        break;
      }

      // ── Clean up empty parent objects after nested deletions ──────────
    }
  }

  // Clean up empty "log" and "ollama" objects if all children were migrated
  for (const parentKey of ["log", "ollama"]) {
    if (
      raw[parentKey] &&
      typeof raw[parentKey] === "object" &&
      Object.keys(raw[parentKey] as Record<string, unknown>).length === 0
    ) {
      deleteTopLevel(raw, parentKey);
    }
  }

  return { migrated, warnings };
}

/**
 * Main migration entry point.
 *
 * Checks for legacy keys, runs migrations if found, returns the migrated
 * config object and any warnings. If no legacy keys are present, returns
 * the input unchanged.
 *
 * @returns `{ config: Record<string, unknown>, warnings: string[] }`
 */
export function runMigrations(
  raw: Record<string, unknown>,
): { config: Record<string, unknown>; warnings: string[] } {
  const check = hasLegacyKeys(raw);
  if (!check.found) {
    return { config: raw, warnings: [] };
  }

  const result = migrateLegacyConfig(raw);
  return { config: raw, warnings: result.warnings };
}

// ---------------------------------------------------------------------------
// Version management
// ---------------------------------------------------------------------------

/**
 * Parse a semver string into [major, minor, patch].
 * Returns null if the string is not valid semver.
 */
function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * Compare two semver versions.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;

  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/**
 * Check if a config needs upgrading based on version comparison.
 *
 * @param currentVersion  — the app's current version (e.g. "0.2.0")
 * @param configVersion   — the version stamp on the config (may be undefined)
 * @returns `{ needsUpgrade: boolean, message?: string }`
 */
export function checkVersionUpgrade(
  currentVersion: string,
  configVersion?: string,
): { needsUpgrade: boolean; message?: string } {
  // Fresh config (no version stamp) — no upgrade needed
  if (configVersion === undefined || configVersion === "") {
    return { needsUpgrade: false };
  }

  const cmp = compareSemver(currentVersion, configVersion);

  if (cmp === 0) {
    return { needsUpgrade: false };
  }

  if (cmp > 0) {
    // currentVersion > configVersion — upgrade needed
    return {
      needsUpgrade: true,
      message: `Config is from version ${configVersion}; current version is ${currentVersion}. Running migrations...`,
    };
  }

  // currentVersion < configVersion — config is newer (downgrade scenario)
  return {
    needsUpgrade: false,
    message: `WARNING: Config version (${configVersion}) is newer than application version (${currentVersion}). This may indicate a downgrade.`,
  };
}

/**
 * Stamp a config object with the current version.
 *
 * Adds `_version` at the root and updates `wizard.lastRunVersion`.
 *
 * @returns The mutated config object (same reference).
 */
export function stampConfigVersion(
  raw: Record<string, unknown>,
  version: string,
): Record<string, unknown> {
  raw._version = version;

  if (!raw.wizard || typeof raw.wizard !== "object") {
    raw.wizard = {};
  }
  (raw.wizard as Record<string, unknown>).lastRunVersion = version;

  return raw;
}
