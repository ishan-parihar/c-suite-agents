import { logger } from "../logger";
import os from "node:os";
import path from "node:path";
import * as fs from "node:fs";

// ── Types ──────────────────────────────────────────────────────────────

export interface DownloadedMedia {
  path: string;
  contentType: string; // MIME type like "image/jpeg", "audio/ogg"
  fileName?: string;
  mimeType?: string;
  placeholder: string; // e.g. "<media:image>", "<media:audio>", "<media:document>"
  fileSize?: number;
}

export interface MediaDetectionResult {
  hasMedia: boolean;
  mediaType:
    | "photo"
    | "video"
    | "video_note"
    | "audio"
    | "voice"
    | "document"
    | "animation"
    | "sticker"
    | null;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
  mediaCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const MEDIA_DIR = path.join(os.homedir(), ".operant", "media", "inbound");
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  json: "application/json",
  xml: "application/xml",
  csv: "text/csv",
  tgs: "application/x-tgsticker",
};

// ── Placeholder Resolution ─────────────────────────────────────────────

/**
 * Returns a placeholder string for a given media type.
 */
export function resolveMediaPlaceholder(type: string): string {
  switch (type) {
    case "photo":
      return "<media:image>";
    case "video":
    case "video_note":
      return "<media:video>";
    case "audio":
    case "voice":
      return "<media:audio>";
    case "document":
      return "<media:document>";
    case "animation":
      return "<media:animation>";
    case "sticker":
      return "<media:sticker>";
    default:
      return "<media:unknown>";
  }
}

// ── Media Detection ────────────────────────────────────────────────────

/**
 * Inspects ctx.message for any attached media and returns a detection result.
 * For photo arrays, uses the last (highest resolution) element.
 */
export function detectMedia(ctx: any): MediaDetectionResult {
  const msg = ctx.message ?? ctx.editedMessage ?? ctx.channelPost;
  if (!msg) {
    return { hasMedia: false, mediaType: null, mediaCount: 0 };
  }

  // Photo — array of sizes, last element is highest resolution
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const best = msg.photo[msg.photo.length - 1];
    return {
      hasMedia: true,
      mediaType: "photo",
      fileId: best.file_id,
      fileName: undefined,
      mimeType: "image/jpeg",
      caption: msg.caption ?? msg.text,
      mediaCount: msg.photo.length,
    };
  }

  if (msg.video) {
    return {
      hasMedia: true,
      mediaType: "video",
      fileId: msg.video.file_id,
      fileName: msg.video.file_name,
      mimeType: msg.video.mime_type,
      caption: msg.caption ?? msg.text,
      mediaCount: 1,
    };
  }

  if (msg.video_note) {
    return {
      hasMedia: true,
      mediaType: "video_note",
      fileId: msg.video_note.file_id,
      fileName: undefined,
      mimeType: msg.video_note.mime_type,
      caption: undefined,
      mediaCount: 1,
    };
  }

  if (msg.audio) {
    return {
      hasMedia: true,
      mediaType: "audio",
      fileId: msg.audio.file_id,
      fileName: msg.audio.file_name ?? msg.audio.title,
      mimeType: msg.audio.mime_type,
      caption: msg.caption ?? msg.text,
      mediaCount: 1,
    };
  }

  if (msg.voice) {
    return {
      hasMedia: true,
      mediaType: "voice",
      fileId: msg.voice.file_id,
      fileName: undefined,
      mimeType: msg.voice.mime_type ?? "audio/ogg",
      caption: undefined,
      mediaCount: 1,
    };
  }

  if (msg.document) {
    return {
      hasMedia: true,
      mediaType: "document",
      fileId: msg.document.file_id,
      fileName: msg.document.file_name,
      mimeType: msg.document.mime_type,
      caption: msg.caption ?? msg.text,
      mediaCount: 1,
    };
  }

  if (msg.animation) {
    return {
      hasMedia: true,
      mediaType: "animation",
      fileId: msg.animation.file_id,
      fileName: msg.animation.file_name,
      mimeType: msg.animation.mime_type,
      caption: msg.caption ?? msg.text,
      mediaCount: 1,
    };
  }

  if (msg.sticker) {
    return {
      hasMedia: true,
      mediaType: "sticker",
      fileId: msg.sticker.file_id,
      fileName: undefined,
      mimeType: msg.sticker.mime_type ?? (msg.sticker.is_animated ? "application/x-tgsticker" : "image/webp"),
      caption: undefined,
      mediaCount: 1,
    };
  }

  return { hasMedia: false, mediaType: null, mediaCount: 0 };
}

// ── Download ───────────────────────────────────────────────────────────

/**
 * Downloads a file from Telegram given a Telegraf context.
 * Uses native fetch() with SSRF protection (api.telegram.org only).
 * Saves to ~/.operant/media/inbound/ with timestamped naming.
 */
export async function downloadTelegramFile(
  ctx: any,
  maxBytes?: number
): Promise<DownloadedMedia | null> {
  const detection = detectMedia(ctx);
  if (!detection.hasMedia || !detection.fileId) {
    logger.debug("No media detected in message, skipping download");
    return null;
  }

  const limit = maxBytes ?? DEFAULT_MAX_BYTES;

  try {
    // Get file info from Telegram API
    const fileInfo = await ctx.getFile(detection.fileId);
    if (!fileInfo?.file_path) {
      logger.error({ fileId: detection.fileId }, "getFile returned no file_path");
      return null;
    }

    // SSRF guard — only allow api.telegram.org
    const downloadUrl = `https://api.telegram.org/file/bot${ctx.telegram.token}/${fileInfo.file_path}`;
    const urlObj = new URL(downloadUrl);
    if (urlObj.hostname !== "api.telegram.org") {
      logger.error({ hostname: urlObj.hostname }, "SSRF blocked: non-telegram hostname");
      return null;
    }

    // Fetch the file with timeout guard
    logger.info({ fileId: detection.fileId, url: downloadUrl }, "Downloading media from Telegram");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(downloadUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      logger.error(
        { status: response.status, fileId: detection.fileId },
        "Failed to download media from Telegram"
      );
      return null;
    }

    // Respect content-length if available
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > limit) {
      logger.warn(
        { contentLength: parseInt(contentLength, 10), limit },
        "File exceeds size limit, aborting download"
      );
      return null;
    }

    // Read body with size enforcement
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength > limit) {
      logger.warn(
        { actualSize: buffer.byteLength, limit },
        "Downloaded file exceeds size limit, discarding"
      );
      return null;
    }

    // Determine file name
    const originalName = detection.fileName ?? fileInfo.file_path.split("/").pop() ?? "file";
    const ext = path.extname(originalName) || guessExtension(detection.mediaType);
    const baseName = ext ? originalName.replace(/\.[^.]+$/, "") : originalName;
    const timestamp = Date.now();
    const safeBase = sanitizeFileName(baseName || detection.mediaType || "file");
    const finalName = `${timestamp}_${safeBase}${ext}`;

    // Ensure media directory exists
    fs.mkdirSync(MEDIA_DIR, { recursive: true });

    const savePath = path.join(MEDIA_DIR, finalName);
    const tmpPath = `${savePath}.tmp`;
    try {
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, savePath);
    } catch (writeErr) {
      try { fs.unlinkSync(tmpPath); } catch { }
      throw writeErr;
    }

    // Detect content type
    const responseContentType = response.headers.get("content-type");
    const contentType =
      responseContentType?.split(";")[0].trim() ??
      detection.mimeType ??
      EXTENSION_TO_MIME[ext.replace(".", "").toLowerCase()] ??
      "application/octet-stream";

    const placeholder = resolveMediaPlaceholder(detection.mediaType!);

    const result: DownloadedMedia = {
      path: savePath,
      contentType,
      fileName: finalName,
      mimeType: contentType,
      placeholder,
      fileSize: buffer.byteLength,
    };

    logger.info(
      { path: savePath, contentType, size: buffer.byteLength },
      "Media downloaded successfully"
    );

    return result;
  } catch (err: any) {
    logger.error({ err: err.message, fileId: detection.fileId }, "Failed to download Telegram media");
    return null;
  }
}

// ── Media Context Builder ──────────────────────────────────────────────

/**
 * Builds a markdown block summarizing downloaded media for inclusion in prompts.
 */
export function buildMediaContext(media: DownloadedMedia[], caption?: string): string {
  if (media.length === 0) return "";

  const lines = ["[Media Context]"];

  for (const m of media) {
    const typeLabel = m.contentType.split("/")[0] || "file";
    const name = m.fileName ?? path.basename(m.path);
    lines.push(`📎 ${typeLabel}: ${name}`);
    if (caption) {
      lines.push(caption);
    }
    lines.push(`Path: ${m.path}`);
    lines.push("You can use appropriate tools to process this file.");
  }

  lines.push("[/Media Context]");
  return lines.join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────────

function guessExtension(mediaType: string | null): string {
  if (!mediaType) return "";
  const map: Record<string, string> = {
    photo: ".jpg",
    video: ".mp4",
    video_note: ".mp4",
    audio: ".mp3",
    voice: ".ogg",
    document: "",
    animation: ".gif",
    sticker: ".webp",
  };
  return map[mediaType] ?? "";
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
}
