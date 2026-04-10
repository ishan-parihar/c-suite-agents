// Image Analyze Tool — Analyzes images using vision-capable LLMs
// Standalone implementation — no cross-dependencies with other tools

import { promises as fs, realpathSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { homedir } from "node:os";
import { join, extname, resolve, normalize, sep } from "node:path";
import OpenAI from "openai";
import { logger } from "../../logger.js";
import { loadConfig } from "../../config/loader.js";

interface AnyAgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

// Simple extension-to-MIME mapping
const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".svg": "image/svg+xml",
};

const MAX_CONTENT_LENGTH = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT_MS = 15_000; // 15 seconds

function detectMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function isUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

// Private IP ranges: loopback, link-local, RFC1918
const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // 127.0.0.0/8 (loopback)
  /^10\./,                           // 10.0.0.0/8
  /^192\.168\./,                     // 192.168.0.0/16
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // 172.16.0.0/12
  /^169\.254\./,                     // 169.254.0.0/16 (link-local, incl. 169.254.169.254)
  /^0\./,                            // 0.0.0.0/8
];

function isPrivateIP(hostname: string): boolean {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return true;
  }
  // Also block literal localhost
  if (hostname === "localhost" || hostname === "::1") return true;
  return false;
}

async function readStreamWithLimit(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  if (!body) throw new Error("Response body is null");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      if (totalBytes > maxBytes) {
        throw new Error(`Download aborted: exceeded maximum allowed size (${maxBytes / (1024 * 1024)}MB)`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

function validateUrlScheme(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid URL scheme: ${url.protocol}. Only http:// and https:// are allowed.`);
  }
}

function validateNotPrivateIP(url: URL): void {
  if (isPrivateIP(url.hostname)) {
    throw new Error(`Access to private/reserved IP addresses is blocked: ${url.hostname}`);
  }
}

/**
 * DNS rebinding protection: resolve hostname and verify the resolved IP is not private.
 * Returns resolved addresses for before/after comparison (null on DNS failure).
 */
async function validateResolvedIP(hostname: string): Promise<string[] | null> {
  try {
    const lookupPromise = lookup(hostname, { all: true });
    lookupPromise.catch(() => {});
    const results = await Promise.race([
      lookupPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS lookup timeout (5s)")), 5000)
      ),
    ]);
    const addresses = (results as { address: string }[]).map((r) => r.address);
    for (const addr of addresses) {
      if (isPrivateIP(addr)) {
        throw new Error(`DNS rebinding blocked: ${hostname} resolved to private/reserved IP ${addr}`);
      }
    }
    return addresses;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("DNS rebinding blocked")) {
      throw err;
    }
    // DNS lookup failures are non-fatal — the URL already passed validateNotPrivateIP
    logger.debug({ hostname, err }, "DNS lookup failed; skipping rebinding check");
    return null;
  }
}


async function imageToDataUrl(source: string): Promise<string> {
  if (isUrl(source)) {
    const parsedUrl = new URL(source);
    validateUrlScheme(parsedUrl);
    validateNotPrivateIP(parsedUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // Pre-fetch DNS validation: check ALL resolved IPs are not private
    const beforeAddresses = await validateResolvedIP(parsedUrl.hostname);

    let response: Response;
    try {
      response = await fetch(source, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    // Post-fetch DNS validation + response handling with guaranteed body cleanup
    try {
      const afterAddresses = await validateResolvedIP(parsedUrl.hostname);

      // Compare before/after to detect DNS rebinding mid-request
      if (beforeAddresses && afterAddresses) {
        if (beforeAddresses.length !== afterAddresses.length ||
            !beforeAddresses.every((addr, i) => addr === afterAddresses[i])) {
          throw new Error(`DNS rebinding detected: ${parsedUrl.hostname} resolved to different addresses before vs after fetch`);
        }
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch image from URL: ${response.status} ${response.statusText}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_LENGTH) {
        throw new Error(`Image exceeds maximum allowed size (10MB): ${contentLength} bytes`);
      }

      const buffer = await readStreamWithLimit(response.body, MAX_CONTENT_LENGTH);
      const contentType = response.headers.get("content-type") || "image/jpeg";
      return `data:${contentType};base64,${buffer.toString("base64")}`;
    } catch (err) {
      if (response?.body && !response.body.locked) {
        await response.body.cancel().catch(() => {});
      }
      throw err;
    }
  }

  const allowedBaseDirs = [
    resolve(join(homedir(), ".operant", "media")),
    resolve(join(homedir(), ".local", "share", "operant", "media")),
  ];
  let resolved = resolve(source);
  try {
    resolved = realpathSync(resolved);
  } catch {
    throw new Error(`File not found: ${source}`);
  }

  if (!allowedBaseDirs.some((base) => resolved === base || resolved.startsWith(base + sep))) {
    throw new Error(`Path traversal blocked: ${source} (must be under ${allowedBaseDirs[0]} or ${allowedBaseDirs[1]})`);
  }

  const ext = extname(resolved).toLowerCase();
  const allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];
  if (!allowed.includes(ext)) {
    throw new Error(`Invalid image file extension: ${ext}`);
  }

  const buffer = await fs.readFile(resolved);
  const mimeType = detectMimeType(resolved);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Resolve API configuration from env vars or Operant config.
 * Returns { client, model } or null if no API key is available.
 */
function resolveApiConfig(): { client: OpenAI; model: string } | null {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const baseUrl = process.env.OPENAI_BASE_URL || "";

  if (apiKey) {
    const client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
    return { client, model: "gpt-4o" };
  }

  // Fallback to Operant config
  try {
    const config = loadConfig();
    if (config.llm?.apiKey && config.llm.model) {
      const client = new OpenAI({
        apiKey: config.llm.apiKey,
        ...(config.llm.baseUrl ? { baseURL: config.llm.baseUrl } : {}),
      });
      return { client, model: config.llm.model };
    }
  } catch (err) {
    logger.debug({ err }, "Failed to load config for image.analyze");
  }

  return null;
}

export function createImageAnalyzeTool(): AnyAgentTool | null {
  const apiConfig = resolveApiConfig();
  if (!apiConfig) {
    logger.warn("image.analyze disabled: no API key or config available");
    return null;
  }

  const { client, model } = apiConfig;

  return {
    name: "image.analyze",
    description: "Analyze one or more images using AI vision capability. Returns a text description of the image(s).",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: 'Optional prompt for analysis. Default: "Describe the image."',
        },
        image: {
          type: "string",
          description: "Single image file path or URL",
        },
        images: {
          type: "array",
          items: { type: "string" },
          description: "Array of image file paths or URLs (max 10)",
        },
      },
    },
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      try {
        const prompt = (args.prompt as string) || "Describe the image.";
        const singleImage = args.image as string | undefined;
        const imageArray = args.images as string[] | undefined;

        // Collect all image sources
        const sources: string[] = [];
        if (singleImage) sources.push(singleImage);
        if (imageArray && Array.isArray(imageArray)) {
          sources.push(...imageArray);
        }

        if (sources.length === 0) {
          return { content: [{ type: "text", text: "Error: No image or images provided. Specify 'image' (string) or 'images' (array)." }] };
        }

        if (sources.length > 10) {
          return { content: [{ type: "text", text: "Error: Maximum 10 images allowed. You provided " + sources.length + "." }] };
        }

        // Convert all sources to content parts
        const contentParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
          { type: "text", text: prompt },
        ];

        for (const source of sources) {
          try {
            const dataUrl = await imageToDataUrl(source);
            contentParts.push({ type: "image_url", image_url: { url: dataUrl } });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn({ source, err: msg }, "Failed to load image for analysis");
            contentParts.push({ type: "text", text: `[Failed to load image: ${source} — ${msg}]` });
          }
        }

        const response = await client.chat.completions.create({
          model,
          messages: [{ role: "user", content: contentParts }],
          max_tokens: 2048,
        }, { timeout: 60000 });

        const description = response.choices[0]?.message?.content || "No description returned.";
        logger.info({ sources: sources.length, model }, "image.analyze completed");

        return { content: [{ type: "text", text: description }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "image.analyze failed");
        return { content: [{ type: "text", text: `Error analyzing image: ${msg}` }] };
      }
    },
  };
}
