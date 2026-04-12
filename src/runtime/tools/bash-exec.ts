import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { logger } from "../../logger";

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

const DANGEROUS_COMMANDS = new Set(["node", "nodejs", "python", "python3", "npx", "bun", "sed", "awk"]);

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
      const { command, args: cmdArgs = [], agent_id, cwd, timeout_ms = 30000 } = args as unknown as BashArgs;

      if (!agent_id) {
        return { content: [{ type: "text", text: "Error: agent_id is required" }] };
      }

      const baseCommand = path.basename(command);
      if (!ALLOWED_COMMANDS.has(baseCommand)) {
        return { content: [{ type: "text", text: `Error: Command '${baseCommand}' is not in the allowlist. Allowed: ${[...ALLOWED_COMMANDS].join(", ")}` }] };
      }

      if (DANGEROUS_COMMANDS.has(baseCommand)) {
        logger.warn({ agent_id, command: baseCommand, args: cmdArgs }, "bash: dangerous command execution — agent has full code execution capability");
      }

      const homeDir = process.env.HOME || process.env.USERPROFILE || "/root";
      const workspaceDir = path.join(homeDir, ".operant", "agents", agent_id);

      let workingDir = workspaceDir;
      if (cwd) {
        if (cwd.includes("..")) {
          return { content: [{ type: "text", text: "Error: Path traversal not allowed in cwd." }] };
        }
        let workingDir = path.resolve(workspaceDir, cwd);
        try {
          workingDir = fs.realpathSync(workingDir);
        } catch {
          // Directory doesn't exist yet — skip symlink check
          // The containment check below still protects against prefix escape
        }
        if (!(workingDir === workspaceDir || workingDir.startsWith(workspaceDir + path.sep))) {
          return { content: [{ type: "text", text: "Error: cwd must be within your workspace directory." }] };
        }
      }

      if (!fs.existsSync(workingDir)) {
        fs.mkdirSync(workingDir, { recursive: true });
        // Re-resolve after creation to catch symlinks
        try {
          workingDir = fs.realpathSync(workingDir);
        } catch { /* still doesn't exist? skip */ }
        if (!(workingDir === workspaceDir || workingDir.startsWith(workspaceDir + path.sep))) {
          return { content: [{ type: "text", text: "Error: cwd must be within your workspace directory." }] };
        }
      }

      try {
        const { stdout, stderr } = await execFileAsync(baseCommand, cmdArgs as string[], {
          cwd: workingDir,
          timeout: timeout_ms,
          maxBuffer: 1024 * 1024,
          env: {
            PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
            HOME: homeDir,
            USER: process.env.USER || "operant",
            LANG: process.env.LANG || "en_US.UTF-8",
            TERM: "dumb",
            NODE_ENV: process.env.NODE_ENV || "production",
          },
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
