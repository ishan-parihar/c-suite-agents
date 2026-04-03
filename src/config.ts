export const cfg = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL || "embeddinggemma",
  lancedbDir: process.env.LANCEDB_DIR || ".lancedb",
  kanbanDb: process.env.KANBAN_DB || "kanban.db",
};
