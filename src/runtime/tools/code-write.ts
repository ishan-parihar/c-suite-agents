import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { AsyncMutex } from "../async-mutex";

const fileWriteMutex = new AsyncMutex();

export interface CodeWriteArgs {
  file_path: string;
  content: string;
  agent_id: string;
  append?: boolean;
}

export function createCodeWriteTool() {
  return {
    name: "code.write" as const,
    description: "Write content to a file in the project source code workspace. Only available to the CTO agent. Creates the file if it doesn't exist. Use append=true to add to the end of an existing file.",
    parameters: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file, relative to the source code workspace root.",
        },
        content: {
          type: "string",
          description: "Content to write to the file.",
        },
        agent_id: {
          type: "string",
          description: "Your agent ID (auto-injected by the runtime).",
        },
        append: {
          type: "boolean",
          description: "If true, append to the end of the file. If false (default), overwrite the file.",
        },
      },
      required: ["file_path", "content"],
      additionalProperties: false,
    },
    permissionTier: "write" as const,
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const { file_path, content, agent_id, append = false } = args as unknown as CodeWriteArgs;

      if (agent_id !== "cto-technical") {
        return { content: [{ type: "text", text: "Error: code.write is only available to the CTO agent." }] };
      }

      if (process.env.CTO_CODE_MODIFICATION_ENABLED !== "true") {
        return { content: [{ type: "text", text: "Error: Code modification is disabled. Set CTO_CODE_MODIFICATION_ENABLED=true to enable." }] };
      }

      const sourceWorkspace = process.env.SOURCE_WORKSPACE || process.cwd();

      if (!path.isAbsolute(sourceWorkspace)) {
        return { content: [{ type: "text", text: "Error: SOURCE_WORKSPACE is not configured." }] };
      }

      if (file_path.includes("..")) {
        return { content: [{ type: "text", text: "Error: Path traversal not allowed." }] };
      }

      let resolvedPath = path.resolve(sourceWorkspace, file_path);
      try {
        resolvedPath = fs.realpathSync(resolvedPath);
      } catch {
        // File doesn't exist yet (write operations) — skip symlink check
        // The containment check below still protects against prefix escape
      }
      if (!(resolvedPath === sourceWorkspace || resolvedPath.startsWith(sourceWorkspace + path.sep))) {
        return { content: [{ type: "text", text: "Error: Access denied. File is outside the source code workspace." }] };
      }

      try {
        // Ensure parent directory exists
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

        if (append && fs.existsSync(resolvedPath)) {
          const release = await fileWriteMutex.acquire(resolvedPath);
          try {
          const fileStat = fs.statSync(resolvedPath);
          if (fileStat.size > 100 * 1024) {
            return { content: [{ type: "text", text: `Error: File too large to append (max 100KB): ${file_path}` }] };
          }
          const existing = fs.readFileSync(resolvedPath, "utf-8");
          const tmpPath = `${resolvedPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
          fs.writeFileSync(tmpPath, existing + content, "utf-8");
          fs.renameSync(tmpPath, resolvedPath);
          return { content: [{ type: "text", text: `Appended ${content.length} characters to ${file_path}` }] };
          } finally {
            release();
          }
        } else {
          const MAX_WRITE_SIZE = 10 * 1024 * 1024;
          if (content.length > MAX_WRITE_SIZE) {
            return { content: [{ type: "text", text: `Error: Content too large (${(content.length / 1024 / 1024).toFixed(1)}MB). Maximum: ${MAX_WRITE_SIZE / 1024 / 1024}MB.` }] };
          }
          const release = await fileWriteMutex.acquire(resolvedPath);
          try {
            const tmpPath = `${resolvedPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
            fs.writeFileSync(tmpPath, content, "utf-8");
            fs.renameSync(tmpPath, resolvedPath);
            return { content: [{ type: "text", text: `Wrote ${content.length} characters to ${file_path}` }] };
          } finally {
            release();
          }
        }
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error writing file: ${err.message}` }] };
      }
    },
  };
}
