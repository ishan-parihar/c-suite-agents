import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

export interface BashArgs {
  command: string;
  args?: string[];
  agent_id: string;
  cwd?: string;
  timeout_ms?: number;
}

const ALLOWED_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "wc", "find", "grep", "stat", "file", "du", "df",
  "mkdir", "touch", "cp", "mv", "rm", "chmod",
  "date", "whoami", "pwd", "echo", "uname",
  "git", "node", "npm", "npx", "pnpm", "bun",
  "curl", "wget",
  "python", "python3",
  "jq", "awk", "sed", "sort", "uniq", "cut", "tr",
]);

export function createBashTool() {
  return {
    name: "bash" as const,
    description: "Execute a shell command in your workspace directory. The command runs with your workspace as the working directory. Use for file operations, data processing, git operations, and other system tasks.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The command to execute (e.g., 'ls', 'git', 'node'). Must be a single executable name, not a shell pipeline.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments to pass to the command.",
        },
        agent_id: {
          type: "string",
          description: "Your agent ID (auto-injected by the runtime).",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command (relative to workspace, default: workspace root).",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000).",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    permissionTier: "danger" as const,
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const { command, args: cmdArgs = [], agent_id, cwd, timeout_ms = 30000 } = args as BashArgs;

      if (!agent_id) {
        return { content: [{ type: "text", text: "Error: agent_id is required" }] };
      }

      const baseCommand = path.basename(command);
      if (!ALLOWED_COMMANDS.has(baseCommand)) {
        return { content: [{ type: "text", text: `Error: Command '${baseCommand}' is not in the allowlist. Allowed: ${[...ALLOWED_COMMANDS].join(", ")}` }] };
      }

      const homeDir = process.env.HOME || process.env.USERPROFILE || "/root";
      const workspaceDir = path.join(homeDir, ".strategos", "agents", agent_id);

      let workingDir = workspaceDir;
      if (cwd) {
        if (cwd.includes("..")) {
          return { content: [{ type: "text", text: "Error: Path traversal not allowed in cwd." }] };
        }
        workingDir = path.resolve(workspaceDir, cwd);
        if (!workingDir.startsWith(workspaceDir)) {
          return { content: [{ type: "text", text: "Error: cwd must be within your workspace directory." }] };
        }
      }

      if (!fs.existsSync(workingDir)) {
        fs.mkdirSync(workingDir, { recursive: true });
      }

      try {
        const { stdout, stderr } = await execFileAsync(baseCommand, cmdArgs as string[], {
          cwd: workingDir,
          timeout: timeout_ms,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, HOME: homeDir },
        });

        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += `\n[stderr]\n${stderr}`;

        if (!output.trim()) output = "(command completed with no output)";

        const MAX_OUTPUT = 10000;
        if (output.length > MAX_OUTPUT) {
          output = output.slice(0, MAX_OUTPUT) + `\n\n[Output truncated — ${output.length - MAX_OUTPUT} more characters]`;
        }

        return { content: [{ type: "text", text: output }] };
      } catch (err: any) {
        if (err.killed) {
          return { content: [{ type: "text", text: `Error: Command timed out after ${timeout_ms}ms` }] };
        }
        if (err.code === "ENOENT") {
          return { content: [{ type: "text", text: `Error: Command '${baseCommand}' not found in PATH` }] };
        }
        const output = [err.stdout, err.stderr].filter(Boolean).join("\n");
        if (output) {
          const MAX_OUTPUT = 10000;
          const truncated = output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + "\n[truncated]" : output;
          return { content: [{ type: "text", text: `Command failed (exit code ${err.code}):\n${truncated}` }] };
        }
        return { content: [{ type: "text", text: `Command failed: ${err.message}` }] };
      }
    },
  };
}
