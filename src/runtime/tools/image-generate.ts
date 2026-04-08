// Image Generate Tool — Generates images from text prompts
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

async function ensureMediaDir(): Promise<string> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  return MEDIA_DIR;
}

function resolveApiConfig(): { client: OpenAI; model: string } | null {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const baseUrl = process.env.OPENAI_BASE_URL || "";

  if (apiKey) {
    const client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
    return { client, model: "dall-e-3" };
  }

  try {
    const config = loadConfig();
    if (config.llm?.apiKey && config.llm.model) {
      const client = new OpenAI({
        apiKey: config.llm.apiKey,
        ...(config.llm.baseUrl ? { baseURL: config.llm.baseUrl } : {}),
      });
      return { client, model: "dall-e-3" };
    }
  } catch (err) {
    logger.debug({ err }, "Failed to load config for image.generate");
  }

  return null;
}

export function createImageGenerateTool(): AnyAgentTool | null {
  const apiConfig = resolveApiConfig();
  if (!apiConfig) {
    logger.warn("image.generate disabled: no API key or config available");
    return null;
  }

  const { client } = apiConfig;

  return {
    name: "image.generate",
    description: "Generate images from text prompts using AI. Saves images to the media directory and returns file paths.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of the image to generate",
        },
        size: {
          type: "string",
          description: "Image size (e.g., 1024x1024, 1024x1792, 1792x1024). Default: 1024x1024",
        },
        count: {
          type: "number",
          description: "Number of images to generate (1-4). Default: 1",
        },
      },
      required: ["prompt"],
    },
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      try {
        const prompt = args.prompt as string | undefined;
        if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
          return { content: [{ type: "text", text: "Error: 'prompt' is required and must be a non-empty string." }] };
        }

        const size = (args.size as string) || "1024x1024";
        const count = Math.min(Math.max(1, (args.count as number) || 1), 4);

        const response = await client.images.generate({
          model: "dall-e-3",
          prompt: prompt.trim(),
          n: count,
          size: size as "1024x1024" | "1024x1792" | "1792x1024",
          response_format: "b64_json",
        });

        const mediaDir = await ensureMediaDir();
        const savedPaths: string[] = [];

        const data = response.data || [];
        for (let i = 0; i < data.length; i++) {
          const img = data[i];
          if (!img?.b64_json) continue;

          const timestamp = Date.now();
          const filename = `generated_${timestamp}_${i}.png`;
          const filepath = join(mediaDir, filename);

          const tmpPath = `${filepath}.tmp`;
          try {
            writeFileSync(tmpPath, Buffer.from(img.b64_json, "base64"));
            renameSync(tmpPath, filepath);
          } catch (writeErr) {
            try { unlinkSync(tmpPath); } catch { }
            throw writeErr;
          }
          savedPaths.push(filepath);
          logger.info({ filepath, size }, "image.generate saved");
        }

        if (savedPaths.length === 0) {
          return { content: [{ type: "text", text: "Error: No images were generated." }] };
        }

        const pathsText = savedPaths.length === 1
          ? savedPaths[0]
          : savedPaths.map((p, i) => `${i + 1}. ${p}`).join("\n");

        return { content: [{ type: "text", text: `Generated ${savedPaths.length} image(s):\n${pathsText}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "image.generate failed");
        return { content: [{ type: "text", text: `Error generating image: ${msg}` }] };
      }
    },
  };
}
