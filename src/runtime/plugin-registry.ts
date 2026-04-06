// Plugin System Foundation — Discovery-based plugin loading
// Inspired by OpenClaw's extensions/ pattern
// Plugins extend Strategos without modifying core code

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "../logger.js";
import { STRATEGOS_HOME } from "../agents/workspace-manager.js";

// ── Types ──────────────────────────────────────────────────────────────

export type PluginType = "tool" | "channel" | "memory" | "provider";

export interface PluginManifest {
  name: string;
  version: string;
  type: PluginType;
  description: string;
  main: string;
  author?: string;
  license?: string;
  configSchema?: Record<string, unknown>;
}

export interface PluginInstance {
  manifest: PluginManifest;
  directory: string;
  loaded: boolean;
  error?: string;
  exports?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

// ── Plugin Registry ────────────────────────────────────────────────────

const PLUGINS_DIR = path.join(STRATEGOS_HOME, "plugins");
const CONFIG_FILE = path.join(STRATEGOS_HOME, "plugins.json");

const pluginRegistry = new Map<string, PluginInstance>();

// ── Manifest Validation ────────────────────────────────────────────────

const VALID_TYPES: PluginType[] = ["tool", "channel", "memory", "provider"];

function validateManifest(manifest: unknown, dir: string): PluginManifest | null {
  if (!manifest || typeof manifest !== "object") return null;
  const m = manifest as Record<string, unknown>;

  const name = typeof m.name === "string" ? m.name.trim() : "";
  const version = typeof m.version === "string" ? m.version.trim() : "";
  const type = typeof m.type === "string" ? (m.type as PluginType) : null;
  const description = typeof m.description === "string" ? m.description.trim() : "";
  const main = typeof m.main === "string" ? m.main.trim() : "";

  if (!name || !version || !type || !description || !main) {
    logger.warn({ dir }, "Invalid plugin manifest — missing required fields");
    return null;
  }

  if (!VALID_TYPES.includes(type)) {
    logger.warn({ dir, type }, "Invalid plugin type");
    return null;
  }

  return {
    name,
    version,
    type,
    description,
    main,
    author: typeof m.author === "string" ? m.author : undefined,
    license: typeof m.license === "string" ? m.license : undefined,
    configSchema: typeof m.configSchema === "object" && m.configSchema !== null
      ? m.configSchema as Record<string, unknown>
      : undefined,
  };
}

// ── Plugin Discovery ───────────────────────────────────────────────────

function discoverPluginDirs(): string[] {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    return [];
  }

  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => path.join(PLUGINS_DIR, e.name));
}

// ── Config Loading ─────────────────────────────────────────────────────

function loadPluginConfig(manifestName: string): Record<string, unknown> {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    return (config[manifestName] as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

// ── Plugin Loading ─────────────────────────────────────────────────────

async function loadPluginInstance(dir: string): Promise<PluginInstance | null> {
  const manifestPath = path.join(dir, "plugin.json");

  if (!fs.existsSync(manifestPath)) return null;

  let manifest: PluginManifest | null;
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    manifest = validateManifest(parsed, dir);
    if (!manifest) return null;
  } catch (err: any) {
    logger.warn({ dir, error: err.message }, "Failed to parse plugin.json");
    return null;
  }

  const instance: PluginInstance = {
    manifest,
    directory: dir,
    loaded: false,
    config: loadPluginConfig(manifest.name),
  };

  const entryPoint = path.join(dir, manifest.main);

  if (!fs.existsSync(entryPoint)) {
    instance.error = `Entry point not found: ${manifest.main}`;
    logger.warn({ plugin: manifest.name, entryPoint }, instance.error);
    return instance;
  }

  try {
    const mod = await import(`file://${entryPoint}`);
    instance.exports = mod;
    instance.loaded = true;
    logger.info({ plugin: manifest.name, type: manifest.type, version: manifest.version }, "Plugin loaded");
  } catch (err: any) {
    instance.error = err.message;
    logger.error({ plugin: manifest.name, error: err.message }, "Failed to load plugin");
  }

  return instance;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Discover and load all plugins from the plugins directory.
 * Called during system initialization. Existing plugins are not reloaded.
 */
export async function discoverAndLoadPlugins(): Promise<PluginInstance[]> {
  const dirs = discoverPluginDirs();
  const loaded: PluginInstance[] = [];

  for (const dir of dirs) {
    const existing = Array.from(pluginRegistry.values()).find(p => p.directory === dir);
    if (existing) continue;

    const instance = await loadPluginInstance(dir);
    if (!instance) continue;

    pluginRegistry.set(instance.manifest.name, instance);
    loaded.push(instance);
  }

  const total = pluginRegistry.size;
  const ok = Array.from(pluginRegistry.values()).filter(p => p.loaded).length;
  logger.info({ total, loaded: ok }, "Plugin discovery complete");
  return loaded;
}

/**
 * Hot-reload a specific plugin by name.
 * Removes old instance, discovers fresh copy, loads it.
 */
export async function reloadPlugin(name: string): Promise<PluginInstance | null> {
  const existing = pluginRegistry.get(name);
  if (existing) {
    pluginRegistry.delete(name);
  }

  const dirs = discoverPluginDirs();
  const dir = dirs.find(d => {
    const manifestPath = path.join(d, "plugin.json");
    if (!fs.existsSync(manifestPath)) return false;
    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const m = JSON.parse(raw);
      return m.name === name;
    } catch {
      return false;
    }
  });

  if (!dir) {
    logger.warn({ plugin: name }, "Plugin not found for reload");
    return null;
  }

  const instance = await loadPluginInstance(dir);
  if (instance) {
    pluginRegistry.set(name, instance);
  }

  return instance;
}

/**
 * Get a loaded plugin by name. Returns undefined if not found or not loaded.
 */
export function getPlugin(name: string): PluginInstance | undefined {
  const plugin = pluginRegistry.get(name);
  return plugin?.loaded ? plugin : undefined;
}

/**
 * List all discovered plugins (loaded and failed).
 */
export function listPlugins(): PluginInstance[] {
  return Array.from(pluginRegistry.values());
}

/**
 * List loaded plugins filtered by type.
 */
export function listPluginsByType(type: PluginType): PluginInstance[] {
  return Array.from(pluginRegistry.values())
    .filter(p => p.loaded && p.manifest.type === type);
}

/**
 * Get plugin health summary for system health reporting.
 */
export function getPluginHealth(): { total: number; loaded: number; failed: number; plugins: { name: string; type: string; status: string; error?: string }[] } {
  const all = Array.from(pluginRegistry.values());
  const loaded = all.filter(p => p.loaded);
  const failed = all.filter(p => !p.loaded);

  return {
    total: all.length,
    loaded: loaded.length,
    failed: failed.length,
    plugins: all.map(p => ({
      name: p.manifest.name,
      type: p.manifest.type,
      status: p.loaded ? "ok" : "error",
      error: p.error,
    })),
  };
}

/**
 * Clear the plugin registry (for testing).
 */
export function clearPluginRegistry(): void {
  pluginRegistry.clear();
}
