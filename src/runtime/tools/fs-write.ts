import * as fs from "fs";
import * as path from "path";

export interface FsWriteArgs {
  file_path: string;
  content: string;
  agent_id: string;
  append?: boolean;
}

export function createFsWriteTool() {
  return {
    name: "fs.write" as const,
    description: "Write content to a file in your workspace directory. Creates the file if it doesn't exist. Use append=true to add to the end of an existing file.",
    parameters: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file, relative to your workspace directory.",
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
      const { file_path, content, agent_id, append = false } = args as FsWriteArgs;

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
        return { content: [{ type: "text", text: "Error: Access denied. You can only write files within your workspace directory." }] };
      }

      try {
        // Ensure parent directory exists
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

        if (append && fs.existsSync(resolvedPath)) {
          fs.appendFileSync(resolvedPath, content, "utf-8");
          return { content: [{ type: "text", text: `Appended ${content.length} characters to ${file_path}` }] };
        } else {
          // Atomic write: write to tmp file, then rename
          const tmpPath = `${resolvedPath}.tmp-${process.pid}`;
          fs.writeFileSync(tmpPath, content, "utf-8");
          fs.renameSync(tmpPath, resolvedPath);
          return { content: [{ type: "text", text: `Wrote ${content.length} characters to ${file_path}` }] };
        }
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error writing file: ${err.message}` }] };
      }
    },
  };
}
