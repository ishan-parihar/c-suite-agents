import readline from "node:readline";

// ---------------------------------------------------------------------------
// ANSI Color Helpers (subset from setup-wizard.ts)
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

// ---------------------------------------------------------------------------
// Section Registry
// ---------------------------------------------------------------------------

export const CONFIGURE_SECTIONS = [
  { id: "llm",       label: "LLM Configuration",       desc: "Provider, model, API key, temperature, timeout, retry" },
  { id: "context",   label: "Context Management",      desc: "Max messages, compaction, pruning settings" },
  { id: "agents",    label: "Agent Defaults",          desc: "Autonomy, concurrency, tool rounds" },
  { id: "telegram",  label: "Telegram Bot",            desc: "Bot token and chat ID" },
  { id: "paths",     label: "Data Paths",              desc: "LanceDB, Kanban, Messages, offices, logs" },
  { id: "mcp",       label: "MCP Servers",             desc: "Manage local and remote MCP servers" },
  { id: "embedding", label: "Embedding Model",         desc: "Provider, model, dimensions for vector search" },
  { id: "logging",   label: "Logging",                 desc: "Log level, file path, rotation size" },
  { id: "health",    label: "Health Check",            desc: "Run doctor diagnostic checks" },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardSection = (typeof CONFIGURE_SECTIONS)[number]["id"];

export type SectionHandler = (
  config: Record<string, unknown>,
  options?: { nonInteractive?: boolean }
) => Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Section Hint Helper
// ---------------------------------------------------------------------------

/**
 * Returns a short status string for a section based on current config.
 */
export function getSectionHint(
  section: WizardSection,
  config: Record<string, unknown>,
): string {
  switch (section) {
    case "llm": {
      const llm = config.llm as Record<string, unknown> | undefined;
      if (llm?.provider && llm?.model) {
        return `${llm.provider}/${llm.model}`;
      }
      return "not configured";
    }

    case "context": {
      const ctx = config.context as Record<string, unknown> | undefined;
      const compaction = ctx?.compactionEnabled ?? ctx?.compaction;
      const maxMsg = ctx?.maxMessages ?? ctx?.max_messages;
      const comp = compaction === true || compaction === "on" ? "on" : compaction === false || compaction === "off" ? "off" : "?";
      return maxMsg !== undefined
        ? `compaction=${comp}, maxMessages=${maxMsg}`
        : "not configured";
    }

    case "agents": {
      const agents = config.agents as Record<string, unknown> | undefined;
      const autonomy = agents?.autonomy ?? agents?.autonomyLevel;
      const maxConcurrent = agents?.maxConcurrent ?? agents?.max_concurrent;
      if (autonomy !== undefined || maxConcurrent !== undefined) {
        return `autonomy=${autonomy ?? "?"}, maxConcurrent=${maxConcurrent ?? "?"}`;
      }
      return "not configured";
    }

    case "telegram": {
      const tg = config.telegram as Record<string, unknown> | undefined;
      return tg?.botToken ? "configured" : "not configured";
    }

    case "paths": {
      const paths = config.paths as Record<string, unknown> | undefined;
      if (paths && Object.keys(paths).length > 0) {
        return `${Object.keys(paths).length} paths configured`;
      }
      return "not configured";
    }

    case "mcp": {
      const mcp = config.mcp as Record<string, unknown> | undefined;
      if (Array.isArray(mcp)) {
        return mcp.length > 0 ? `${mcp.length} servers` : "none configured";
      }
      if (mcp && typeof mcp === "object") {
        const count = Object.keys(mcp).length;
        return count > 0 ? `${count} servers` : "none configured";
      }
      return "none configured";
    }

    case "embedding": {
      const emb = config.embedding as Record<string, unknown> | undefined;
      if (emb?.provider && emb?.model) {
        return `${emb.provider}/${emb.model}`;
      }
      return "not configured";
    }

    case "logging": {
      const log = config.logging as Record<string, unknown> | undefined;
      return log?.level ? String(log.level) : "not configured";
    }

    case "health": {
      return "run doctor";
    }

    default: {
      return "";
    }
  }
}

// ---------------------------------------------------------------------------
// Readline Helper (inline, based on setup-wizard.ts pattern)
// ---------------------------------------------------------------------------

let rlInstance: readline.Interface | null = null;

function getRl(): readline.Interface {
  if (!rlInstance) {
    rlInstance = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rlInstance;
}

function closeRl(): void {
  if (rlInstance) {
    rlInstance.close();
    rlInstance = null;
  }
}

/**
 * Display numbered section list and return selected section ID or "continue".
 */
export async function promptSection(
  sections: typeof CONFIGURE_SECTIONS,
  currentConfig: Record<string, unknown>,
): Promise<WizardSection | "continue"> {
  console.log(`\nSelect section to configure (or "continue" to finish):`);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const hint = getSectionHint(section.id as WizardSection, currentConfig);
    const idx = i + 1;
    const paddedIdx = String(idx).padStart(2, " ");
    console.log(`  ${paddedIdx}. ${BOLD}${section.label.padEnd(22)}${RESET}— ${DIM}${hint}${RESET}`);
  }

  console.log(`  ${BOLD} 0${RESET}. ${BOLD}Continue${RESET}              ${DIM}(finish configuration)${RESET}`);

  return new Promise((resolve) => {
    const rl = getRl();
    rl.question(`\n${YELLOW}?${RESET} Select (0-${sections.length}): `, (answer) => {
      const trimmed = answer.trim();
      const num = parseInt(trimmed, 10);

      if (isNaN(num) || num === 0) {
        closeRl();
        resolve("continue");
        return;
      }

      if (num >= 1 && num <= sections.length) {
        closeRl();
        resolve(sections[num - 1].id as WizardSection);
        return;
      }

      // Invalid selection — default to continue
      closeRl();
      resolve("continue");
    });
  });
}
