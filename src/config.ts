import { loadConfig, getConfigPath } from "./config/loader";

// Load config once at module initialization (defaults < .env < ~/.operant/config.json)
let _config: ReturnType<typeof loadConfig> | null = null;

function getConfig() {
  if (!_config) {
    try {
      _config = loadConfig();
    } catch (err: unknown) {
      console.error(`[operant] Config load failed: ${(err as Error).message}. Using defaults.`);
      _config = loadConfig(); // Will succeed with defaults even if file is bad
    }
  }
  return _config;
}

// Re-export for advanced usage
export { getConfig, getConfigPath };

// Backward-compatible API for existing importers (5 files)
export const cfg = new Proxy({} as typeof legacyCfg, {
  get(_target, prop: string) {
    const c = getConfig();
    switch (prop) {
      case "telegramToken":
        return c.telegram?.botToken ?? "";
      case "telegramChatId":
        return c.telegram?.chatId ?? "";
      case "ollamaEmbedModel": {
        const embed = c.embedding;
        return embed?.model ?? "qwen3-embedding:0.6b";
      }
      case "lancedbDir":
        return c.paths?.lancedb ?? ".lancedb";
      case "kanbanDb":
        return c.paths?.kanbanDb ?? "kanban.db";
      default:
        return undefined;
    }
  },
});

const legacyCfg = {
  telegramToken: "",
  telegramChatId: "",
  ollamaEmbedModel: "qwen3-0.6",
  lancedbDir: ".lancedb",
  kanbanDb: "kanban.db",
};
export type Cfg = typeof legacyCfg;
