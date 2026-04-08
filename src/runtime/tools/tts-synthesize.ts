// TTS Synthesize Tool — Converts text to speech
// Standalone implementation — no cross-dependencies with other tools

import { promises as fs } from "node:fs";
import { writeFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import { logger } from "../../logger.js";
import { loadConfig } from "../../config/loader.js";

interface AnyAgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

const MEDIA_DIR = join(homedir(), ".strategos", "media");
const MAX_TTS_INPUT_CHARS = 4096;
const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

async function ensureMediaDir(): Promise<string> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  return MEDIA_DIR;
}

function resolveApiConfig(): { client: OpenAI } | null {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const baseUrl = process.env.OPENAI_BASE_URL || "";

  if (apiKey) {
    const client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
    return { client };
  }

  try {
    const config = loadConfig();
    if (config.llm?.apiKey) {
      const client = new OpenAI({
        apiKey: config.llm.apiKey,
        ...(config.llm.baseUrl ? { baseURL: config.llm.baseUrl } : {}),
      });
      return { client };
    }
  } catch (err) {
    logger.debug({ err }, "Failed to load config for tts.synthesize");
  }

  return null;
}

export function createTtsSynthesizeTool(): AnyAgentTool | null {
  const apiConfig = resolveApiConfig();
  if (!apiConfig) {
    logger.warn("tts.synthesize disabled: no API key or config available");
    return null;
  }

  const { client } = apiConfig;

  return {
    name: "tts.synthesize",
    description: "Convert text to speech using AI. Saves audio to the media directory and returns the file path.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to convert to speech",
        },
        voice: {
          type: "string",
          enum: VALID_VOICES,
          description: "Voice to use. Default: alloy",
        },
        speed: {
          type: "number",
          description: "Playback speed (0.25-4.0). Default: 1.0",
        },
      },
      required: ["text"],
    },
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      try {
        const text = args.text as string | undefined;
        if (!text || typeof text !== "string" || text.trim().length === 0) {
          return { content: [{ type: "text", text: "Error: 'text' is required and must be a non-empty string." }] };
        }

        if (text.length > MAX_TTS_INPUT_CHARS) {
          return { content: [{ type: "text", text: `Error: Input text exceeds maximum length of ${MAX_TTS_INPUT_CHARS} characters (received ${text.length}).` }] };
        }

        const voice = ((args.voice as string) || "alloy") as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
        if (!VALID_VOICES.includes(voice)) {
          return { content: [{ type: "text", text: `Error: Invalid voice '${voice}'. Valid voices: ${VALID_VOICES.join(", ")}` }] };
        }

        const speed = Math.min(Math.max(0.25, (args.speed as number) || 1.0), 4.0);

        const response = await client.audio.speech.create({
          model: "tts-1",
          voice,
          input: text.trim(),
          speed,
          response_format: "mp3",
        });

        const mediaDir = await ensureMediaDir();
        const timestamp = Date.now();
        const filename = `tts_${timestamp}_${voice}.mp3`;
        const filepath = join(mediaDir, filename);

        const buffer = Buffer.from(await response.arrayBuffer());
        const tmpPath = `${filepath}.tmp`;
        try {
          writeFileSync(tmpPath, buffer);
          renameSync(tmpPath, filepath);
        } catch (writeErr) {
          try { unlinkSync(tmpPath); } catch { }
          throw writeErr;
        }
        logger.info({ filepath, voice, speed, bytes: buffer.length }, "tts.synthesize saved");

        return { content: [{ type: "text", text: `Audio saved: ${filepath}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "tts.synthesize failed");
        return { content: [{ type: "text", text: `Error synthesizing speech: ${msg}` }] };
      }
    },
  };
}
