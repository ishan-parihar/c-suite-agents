// Audio Transcribe Tool — Wraps the Apex Whisper-Hindi2Hinglish transcriber
// Standalone implementation — no cross-dependencies with other tools

import { spawn } from "node:child_process";
import { statSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, basename, extname, isAbsolute, sep } from "node:path";
import { logger } from "../../logger";
import { getAgentWorkspace } from "../../agents/workspace-manager";

interface AnyAgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

/**
 * Locate the apex_transcriber.py script.
 * Checks env var first, then common paths.
 */
function findApexScript(): string | null {
  const envPath = process.env.MEDIA_APEX_WRAPPER;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    join(homedir(), "Documents", "GitHub", "openscript", "mcp", "scripts", "apex_transcriber.py"),
    resolve(join(__dirname, "..", "..", "..", "..", "openscript", "mcp", "scripts", "apex_transcriber.py")),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return null;
}

/**
 * Locate the whisper-hindi conda environment Python.
 * Checks env var first, then common conda paths.
 */
function findWhisperPython(): string | null {
  const envPath = process.env.MEDIA_APEX_PYTHON || process.env.WHISPER_HINDI_PYTHON;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    join(homedir(), "miniconda3", "envs", "whisper-hindi", "bin", "python3"),
    join(homedir(), "miniconda3", "envs", "whisper-hindi", "bin", "python3.11"),
    join(homedir(), "anaconda3", "envs", "whisper-hindi", "bin", "python3"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return null;
}

/**
 * Run a subprocess and capture stdout/stderr.
 * Returns a promise that resolves with { stdout, stderr, code }.
 */
function runSubprocess(
  cmd: string,
  args: string[],
  options: { timeout: number }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env },
      timeout: options.timeout,
    });

    let killed = false;
    const killTimer = setTimeout(() => {
      if (!killed) {
        child.kill("SIGKILL");
        killed = true;
      }
    }, options.timeout + 5000);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      logger.error({ err: err.message }, "audio.transcribe subprocess error");
      resolve({ stdout, stderr: stderr + `\nProcess error: ${err.message}`, code: null });
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr, code });
    });
  });
}

export function createAudioTranscribeTool(): AnyAgentTool | null {
  const apexScript = findApexScript();
  if (!apexScript) {
    logger.warn("audio.transcribe disabled: apex_transcriber.py not found. Set MEDIA_APEX_WRAPPER env var.");
    return null;
  }

  const whisperPython = findWhisperPython();
  if (!whisperPython) {
    logger.warn("audio.transcribe disabled: whisper-hindi conda env not found. Set MEDIA_APEX_PYTHON env var.");
    return null;
  }

  return {
    name: "audio.transcribe",
    description: "Transcribe audio/voice files using the Apex Whisper-Hindi2Hinglish model. Accepts a file path to an audio file (OGG, MP3, WAV, etc.) and returns the transcription text.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the audio file to transcribe" },
        language: { type: "string", description: "Language hint (default: 'hi' for Hinglish)", default: "hi" },
      },
      required: ["file_path"],
    },
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      try {
        const filePath = args.file_path as string;

        if (!filePath) {
          return { content: [{ type: "text", text: "Error: file_path is required." }] };
        }

        // Sandbox: resolve path and enforce workspace containment
        const agentId = (args.agent_id as string) || "unknown";
        const workspaceDir = getAgentWorkspace(agentId);
        let resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceDir, filePath);
        try {
          resolvedPath = realpathSync(resolvedPath);
        } catch {
          return { content: [{ type: "text", text: `Error: File not found: ${filePath}` }] };
        }
        if (!(resolvedPath === workspaceDir || resolvedPath.startsWith(workspaceDir + sep))) {
          logger.warn({ agentId, filePath, workspaceDir }, "audio.transcribe: path outside workspace");
          return { content: [{ type: "text", text: "Error: File path must be within workspace directory." }] };
        }

        try {
          statSync(resolvedPath);
        } catch {
          return { content: [{ type: "text", text: `Error: File not found: ${filePath}` }] };
        }

        const absPath = resolvedPath;
        const outDir = dirname(absPath);
        const stem = basename(absPath, extname(absPath));
        const txtOutput = join(outDir, stem + ".apex.txt");

        logger.info({ file: absPath }, "audio.transcribe starting");

        const TIMEOUT_MS = 1800000;

        const result = await runSubprocess(
          whisperPython,
          [apexScript, "run", "--video", absPath],
          { timeout: TIMEOUT_MS }
        );

        if (result.code !== 0) {
          const errorMsg = result.stderr.trim().slice(-500);
          logger.error({ code: result.code, stderr: errorMsg }, "audio.transcribe subprocess failed");
          return { content: [{ type: "text", text: `Error: Apex transcription failed (exit code ${result.code}). ${errorMsg}` }] };
        }

        if (!existsSync(txtOutput)) {
          logger.error({ txtOutput }, "audio.transcribe output file not found");
          return { content: [{ type: "text", text: `Error: Transcription output file not found: ${txtOutput}` }] };
        }

        // Size guard — reject files > 100KB
        const txtStat = statSync(txtOutput);
        if (txtStat.size > 100 * 1024) {
          logger.error({ size: txtStat.size, path: txtOutput }, "audio.transcribe output file exceeds size limit");
          return { content: [{ type: "text", text: "Error: Transcription output file too large (max 100KB)" }] };
        }

        const transcriptionText = readFileSync(txtOutput, "utf-8").trim();

        if (!transcriptionText) {
          logger.warn({ file: absPath }, "audio.transcribe returned empty transcription");
          return { content: [{ type: "text", text: "No speech detected in the audio file." }] };
        }

        logger.info({ wordCount: transcriptionText.split(/\s+/).length }, "audio.transcribe completed");

        return { content: [{ type: "text", text: transcriptionText }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "audio.transcribe failed");
        return { content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    },
  };
}
