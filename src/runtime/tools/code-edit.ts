import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { AsyncMutex } from "../async-mutex.js";

const fileEditMutex = new AsyncMutex();

export interface CodeEditArgs {
  file_path: string;
  old_string: string;
  new_string: string;
  agent_id: string;
}

export function createCodeEditTool() {
  return {
    name: "code.edit" as const,
    description: "Make a precise edit to a source code file. Replaces old_string with new_string. The old_string must match the file content exactly (including whitespace). For best results, include 2-3 lines of surrounding context in old_string. Only available to the CTO agent.",
    parameters: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file, relative to the source code workspace root.",
        },
        old_string: {
          type: "string",
          description: "The exact text to replace. Must match the file content exactly, including whitespace and newlines.",
        },
        new_string: {
          type: "string",
          description: "The new text to insert in place of old_string.",
        },
        agent_id: {
          type: "string",
          description: "Your agent ID (auto-injected by the runtime).",
        },
      },
      required: ["file_path", "old_string", "new_string"],
      additionalProperties: false,
    },
    permissionTier: "write" as const,
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const { file_path, agent_id, old_string, new_string } = args as CodeEditArgs;

      if (agent_id !== "cto-technical") {
        return { content: [{ type: "text", text: "Error: code.edit is only available to the CTO agent." }] };
      }

      if (process.env.CTO_CODE_MODIFICATION_ENABLED !== "true") {
        return { content: [{ type: "text", text: "Error: Code modification is disabled. Set CTO_CODE_MODIFICATION_ENABLED=true to enable." }] };
      }

      const sourceWorkspace = process.env.SOURCE_WORKSPACE;
      if (!sourceWorkspace) {
        return { content: [{ type: "text", text: "Error: SOURCE_WORKSPACE is not configured." }] };
      }

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
        // File doesn't exist yet (edit operations) — skip symlink check
        // The containment check below still protects against prefix escape
      }
      if (!(resolvedPath === sourceWorkspace || resolvedPath.startsWith(sourceWorkspace + path.sep))) {
        return { content: [{ type: "text", text: "Error: Access denied. File is outside the source code workspace." }] };
      }

      try {
        const release = await fileEditMutex.acquire(resolvedPath);
        try {
        const stat = fs.statSync(resolvedPath);
        if (stat.size > 100 * 1024) {
          return { content: [{ type: "text", text: `Error: File is too large (${(stat.size / 1024).toFixed(1)}KB). Maximum is 100KB. Read the file first to see its current content.` }] };
        }

        const content = fs.readFileSync(resolvedPath, "utf-8");

        const firstIndex = content.indexOf(old_string);
        if (firstIndex === -1) {
          return { content: [{ type: "text", text: `Error: old_string not found in ${file_path}. Read the file first to see its current content.` }] };
        }

        const lastIndex = content.lastIndexOf(old_string);
        if (firstIndex !== lastIndex) {
          return { content: [{ type: "text", text: `Error: old_string appears ${content.split(old_string).length - 1} times in ${file_path}. Include more surrounding context to make it unique.` }] };
        }

        const newContent = content.replace(old_string, new_string);
        const tmpPath = `${resolvedPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
        fs.writeFileSync(tmpPath, newContent, "utf-8");
        fs.renameSync(tmpPath, resolvedPath);

        return { content: [{ type: "text", text: `Edited ${file_path}: replaced ${old_string.length} chars with ${new_string.length} chars.` }] };
        } finally {
          release();
        }
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return { content: [{ type: "text", text: `Error: File not found: ${file_path}` }] };
        }
        return { content: [{ type: "text", text: `Error editing file: ${err.message}` }] };
      }
    },
  };
}
