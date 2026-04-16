import * as fs from "fs";
import * as path from "path";

export interface FsReadArgs {
  file_path: string;
  agent_id: string;
}

export function createFsReadTool() {
  return {
    name: "fs.read" as const,
    description: "Read the contents of a file in your workspace directory. Returns the full file content.",
    parameters: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file, relative to your workspace directory (e.g., 'MEMORY.md', 'TOOLS.md'). Do NOT use absolute paths.",
        },
        agent_id: {
          type: "string",
          description: "Your agent ID (auto-injected by the runtime).",
        },
      },
      required: ["file_path"],
      additionalProperties: false,
    },
    permissionTier: "read" as const,
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const { file_path, agent_id } = args as FsReadArgs;

      if (!agent_id) {
        return { content: [{ type: "text", text: "Error: agent_id is required" }] };
      }

      // Resolve workspace directory
      const homeDir = process.env.HOME || process.env.USERPROFILE || "/root";
      const workspaceDir = path.join(homeDir, ".operant", "agents", agent_id);

      // Security: validate path is within workspace
      if (file_path.includes("..")) {
        return { content: [{ type: "text", text: `Error: Path traversal not allowed. Use paths relative to your workspace directory.` }] };
      }

      let resolvedPath = path.resolve(workspaceDir, file_path);
      try {
        resolvedPath = fs.realpathSync(resolvedPath);
      } catch {
        return { content: [{ type: "text", text: `Error: File not found: ${file_path}` }] };
      }
      if (!(resolvedPath === workspaceDir || resolvedPath.startsWith(workspaceDir + path.sep))) {
        return { content: [{ type: "text", text: `Error: Access denied. You can only read files within your workspace directory.` }] };
      }

      try {
        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
          return { content: [{ type: "text", text: `Error: '${file_path}' is not a file.` }] };
        }

        // Limit file size to prevent context overflow (100KB)
        if (stat.size > 100 * 1024) {
          return { content: [{ type: "text", text: `Error: File is too large (${(stat.size / 1024).toFixed(1)}KB). Maximum file size is 100KB.` }] };
        }

        const content = fs.readFileSync(resolvedPath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return { content: [{ type: "text", text: `Error: File not found: ${file_path}` }] };
        }
        return { content: [{ type: "text", text: `Error reading file: ${err.message}` }] };
      }
    },
  };
}
