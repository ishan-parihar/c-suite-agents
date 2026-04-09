// Instruction File Discovery — Walks directory tree to find project-scoped context files
// and injects them into the system prompt.
// Inspired by OpenClaw's prompt.rs: walks up from working directory, deduplicates by hash,
// truncates per-file and total content.

import * as fs from "fs";
import * as path from "path";

/**
 * Known instruction file names to search for at each directory level.
 * Ordered by convention prevalence.
 */
export const INSTRUCTION_FILE_NAMES = [
  "CLAUDE.md",
  "CLAUDE.local.md",
  ".claw/CLAUDE.md",
  ".claw/instructions.md",
  ".cursorrules",
  ".windsurfrules",
];

/** Maximum content length per individual file (chars). */
export const MAX_FILE_CONTENT_LENGTH = 4000;

/** Maximum total content length across all discovered files (chars). */
export const MAX_TOTAL_CONTENT_LENGTH = 12000;

/**
 * Represents a discovered instruction file with its content and deduplication hash.
 */
export interface InstructionFile {
  /** Absolute path to the file */
  path: string;
  /** File content, truncated to MAX_FILE_CONTENT_LENGTH */
  content: string;
  /** Content hash for deduplication */
  hash: string;
}

/**
 * Simple string hash function for content deduplication.
 * Uses a basic DJB2-like algorithm — fast and deterministic.
 *
 * @param content - The string to hash
 * @returns A hex string representation of the hash
 */
export function getInstructionFileHash(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
    // Keep hash within safe integer range
    hash = hash & 0x7fffffff;
  }
  return hash.toString(16);
}

/**
 * Discover instruction files by walking UP from startDir to the filesystem root.
 *
 * At each directory level, checks for each file in INSTRUCTION_FILE_NAMES.
 * Reads content, truncates to MAX_FILE_CONTENT_LENGTH, computes hash for deduplication.
 * Stops when total content exceeds MAX_TOTAL_CONTENT_LENGTH.
 *
 * @param startDir - The directory to start walking from (typically process.cwd())
 * @returns Array of InstructionFile ordered from most specific (closest to startDir) to most general
 */
export async function discoverInstructionFiles(startDir: string): Promise<InstructionFile[]> {
  const results: InstructionFile[] = [];
  const seenHashes = new Set<string>();
  let totalLength = 0;

  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (true) {
    for (const fileName of INSTRUCTION_FILE_NAMES) {
      const filePath = path.join(currentDir, fileName);

      // Skip if file doesn't exist or is not a regular file
      // Do NOT follow symlinks — use lstatSync to check
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(filePath);
      } catch {
        continue;
      }

      if (!stat.isFile() || stat.isSymbolicLink()) {
        continue;
      }

      // Size guard — reject files > 100KB
      if (stat.size > 100 * 1024) {
        continue;
      }

      // Read file content
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      // Skip binary files (check for null bytes in first 1024 bytes)
      if (isLikelyBinary(content)) {
        continue;
      }

      // Truncate to max per-file length
      if (content.length > MAX_FILE_CONTENT_LENGTH) {
        content = content.slice(0, MAX_FILE_CONTENT_LENGTH);
      }

      // Compute hash for deduplication
      const fileHash = getInstructionFileHash(content);
      if (seenHashes.has(fileHash)) {
        continue;
      }

      // Check total length budget
      if (totalLength + content.length > MAX_TOTAL_CONTENT_LENGTH) {
        // Stop discovery — we've hit the total budget
        return results;
      }

      seenHashes.add(fileHash);
      totalLength += content.length;

      results.push({
        path: filePath,
        content,
        hash: fileHash,
      });
    }

    // Stop when we've reached the filesystem root
    if (currentDir === root) {
      break;
    }

    const parentDir = path.dirname(currentDir);
    // Safety: break if dirname returns same directory (infinite loop guard)
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return results;
}

/**
 * Check if content is likely binary by looking for null bytes.
 *
 * @param content - The file content to check
 * @returns true if content appears to be binary
 */
function isLikelyBinary(content: string): boolean {
  const sample = content.slice(0, 1024);
  return sample.includes("\0");
}

/**
 * Format discovered instruction files as a markdown section for injection
 * into the system prompt.
 *
 * @param files - Array of discovered InstructionFile
 * @returns Formatted markdown string, or empty string if no files
 */
export function formatInstructionFiles(files: InstructionFile[]): string {
  if (files.length === 0) {
    return "";
  }

  const parts: string[] = ["## Project Instructions\n"];

  for (const file of files) {
    const filename = path.basename(file.path);
    parts.push(`### ${filename}\n`);
    parts.push(file.content);
    parts.push("");
  }

  return parts.join("\n");
}
