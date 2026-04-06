import * as fs from "fs";
import * as path from "path";

export interface FsEditArgs {
  file_path: string;
  agent_id: string;
  old_string: string;
  new_string: string;
}

export function createFsEditTool() {
  return {
    name: "fs.edit" as const,
    description: "Make a precise edit to a file in your workspace. Replaces old_string with new_string. The old_string must match the file content exactly (including whitespace). For best results, include 2-3 lines of surrounding context in old_string.",
    parameters: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file, relative to your workspace directory.",
        },
        agent_id: {
          type: "string",
          description: "Your agent ID (auto-injected by the runtime).",
        },
        old_string: {
          type: "string",
          description: "The exact text to replace. Must match the file content exactly, including whitespace and newlines.",
        },
        new_string: {
          type: "string",
          description: "The new text to insert in place of old_string.",
        },
      },
      required: ["file_path", "old_string", "new_string"],
      additionalProperties: false,
    },
    permissionTier: "write" as const,
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const { file_path, agent_id, old_string, new_string } = args as FsEditArgs;

      if (!agent_id) {
        return { content: [{ type: "text", text: "Error: agent_id is required" }] };
      }

      const homeDir = process.env.HOME || process.env.USERPROFILE || "/root";
      const workspaceDir = path.join(homeDir, ".strategos", "agents", agent_id);

      if (file_path.includes("..")) {
        return { content: [{ type: "text", text: "Error: Path traversal not allowed." }] };
      }

      const resolvedPath = path.resolve(workspaceDir, file_path);
      if (!resolvedPath.startsWith(workspaceDir)) {
        return { content: [{ type: "text", text: "Error: Access denied." }] };
      }

      try {
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
        const tmpPath = `${resolvedPath}.tmp-${process.pid}`;
        fs.writeFileSync(tmpPath, newContent, "utf-8");
        fs.renameSync(tmpPath, resolvedPath);

        return { content: [{ type: "text", text: `Edited ${file_path}: replaced ${old_string.length} chars with ${new_string.length} chars.` }] };
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return { content: [{ type: "text", text: `Error: File not found: ${file_path}` }] };
        }
        return { content: [{ type: "text", text: `Error editing file: ${err.message}` }] };
      }
    },
  };
}
