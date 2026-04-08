import * as fs from "fs";
import * as path from "path";

export interface CodeReadArgs {
  file_path: string;
  agent_id: string;
}

export function createCodeReadTool() {
  return {
    name: "code.read" as const,
    description: "Read a file from the project source code workspace. Only available to the CTO agent. Use file_path relative to the source code root (e.g., 'src/mcp/server.ts').",
    parameters: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file, relative to the source code workspace root. Do NOT use absolute paths.",
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
      const { file_path, agent_id } = args as unknown as CodeReadArgs;

      if (!agent_id) {
        return { content: [{ type: "text", text: "Error: agent_id is required" }] };
      }

      // Gate to CTO agent only
      if (agent_id !== "cto-technical") {
        return { content: [{ type: "text", text: "Error: code.read is only available to the CTO agent." }] };
      }

      // Check modification enabled flag
      if (process.env.CTO_CODE_MODIFICATION_ENABLED !== "true") {
        return { content: [{ type: "text", text: "Error: Code modification is disabled. Set CTO_CODE_MODIFICATION_ENABLED=true to enable." }] };
      }

      // Resolve source workspace
      const sourceWorkspace = process.env.SOURCE_WORKSPACE || process.cwd();

      // Validate SOURCE_WORKSPACE is an absolute path
      if (!path.isAbsolute(sourceWorkspace)) {
        return { content: [{ type: "text", text: "Error: SOURCE_WORKSPACE is not configured. Set it to the absolute path of your project." }] };
      }

      // Path traversal prevention
      if (file_path.includes("..")) {
        return { content: [{ type: "text", text: "Error: Path traversal not allowed." }] };
      }

      const resolvedPath = path.resolve(sourceWorkspace, file_path);

      // Verify resolved path starts with SOURCE_WORKSPACE
      if (!resolvedPath.startsWith(sourceWorkspace)) {
        return { content: [{ type: "text", text: "Error: Access denied. File is outside the source code workspace." }] };
      }

      try {
        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
          return { content: [{ type: "text", text: `Error: '${file_path}' is not a file.` }] };
        }

        // Limit file size to prevent context overflow (100KB)
        if (stat.size > 100 * 1024) {
          return { content: [{ type: "text", text: `Error: File is too large (${(stat.size / 1024).toFixed(1)}KB). Maximum is 100KB.` }] };
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
