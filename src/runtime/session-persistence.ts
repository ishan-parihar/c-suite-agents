import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { logger } from "../logger.js";

export interface SessionEntry {
  timestamp: number;
  role: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SessionSummary {
  sessionId: string;
  fileCount: number;
  lastModified: number;
  totalEntries: number;
}

const DEFAULT_MAX_FILE_SIZE = 256 * 1024;
const DEFAULT_MAX_FILES = 3;
const SESSIONS_DIR = "sessions";

export class SessionPersistence {
  private dir: string;
  private maxFileSize: number;
  private maxFiles: number;
  private sessionsDir: string;
  private sessionLocks = new Map<string, Promise<void>>();

  constructor(options: { dir: string; maxFileSize?: number; maxFiles?: number }) {
    this.dir = options.dir;
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.sessionsDir = path.join(this.dir, SESSIONS_DIR);
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  private sessionFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private allSessionFilePaths(sessionId: string): string[] {
    const files: string[] = [];
    const primary = this.sessionFilePath(sessionId);
    if (fs.existsSync(primary)) {
      files.push(primary);
    }
    for (let i = 1; i <= this.maxFiles; i++) {
      const rotated = `${primary}.${i}`;
      if (fs.existsSync(rotated)) {
        files.push(rotated);
      }
    }
    return files;
  }

  async save(sessionId: string, entry: SessionEntry): Promise<void> {
    this.ensureDir();
    const filePath = this.sessionFilePath(sessionId);

    // Per-session mutex — serialize saves for the same session
    const prev = this.sessionLocks.get(sessionId) || Promise.resolve();
    let resolveLock: () => void;
    const lock = new Promise<void>((r) => { resolveLock = r; });
    this.sessionLocks.set(sessionId, lock);

    try {
      await prev; // Wait for previous save to complete

      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size >= this.maxFileSize) {
          await this.rotate(sessionId);
        }
      }

      const line = JSON.stringify(entry) + "\n";
      const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;

      try {
        let existing = "";
        if (fs.existsSync(filePath)) {
          existing = fs.readFileSync(filePath, "utf-8");
        }
        fs.writeFileSync(tmpPath, existing + line);
        fs.renameSync(tmpPath, filePath);
      } catch (err: any) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore cleanup errors
        }
        throw new Error(`Failed to save session entry for ${sessionId}: ${err.message}`);
      }
    } finally {
      resolveLock!(); // Release lock for next waiter
    }

    // Auto-cleanup to prevent unbounded map growth
    if (this.sessionLocks.size > 100) {
      this.cleanupLocks();
    }
  }

  async load(sessionId: string): Promise<SessionEntry[]> {
    const files = this.allSessionFilePaths(sessionId);
    if (files.length === 0) {
      return [];
    }

    const entries: SessionEntry[] = [];
    const rotatedFiles: string[] = [];
    for (let i = this.maxFiles; i >= 1; i--) {
      const rotated = `${this.sessionFilePath(sessionId)}.${i}`;
      if (fs.existsSync(rotated)) {
        rotatedFiles.push(rotated);
      }
    }

    const orderedFiles = [...rotatedFiles, this.sessionFilePath(sessionId)];

    for (const filePath of orderedFiles) {
      try {
        const fileStat = fs.statSync(filePath);
        if (fileStat.size > 100 * 1024) {
          logger.warn({ filePath, size: fileStat.size }, "Session file too large, skipping");
          continue;
        }
      } catch {
        continue;
      }
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            entries.push(JSON.parse(trimmed) as SessionEntry);
          } catch {
            logger.warn({ filePath, line: trimmed.slice(0, 80) }, "Skipping malformed JSONL line");
          }
        }
      }
    }

    return entries;
  }

  async rotate(sessionId: string): Promise<void> {
    const primary = this.sessionFilePath(sessionId);

    if (!fs.existsSync(primary)) {
      return;
    }

    const oldest = `${primary}.${this.maxFiles}`;
    if (fs.existsSync(oldest)) {
      fs.unlinkSync(oldest);
    }

    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = `${primary}.${i}`;
      const dst = `${primary}.${i + 1}`;
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }

    fs.renameSync(primary, `${primary}.1`);

    logger.info({ sessionId, maxFiles: this.maxFiles }, "Session file rotated");
  }

  async listSessions(): Promise<SessionSummary[]> {
    this.ensureDir();

    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.sessionsDir);
    const sessionMap = new Map<string, { files: string[] }>();

    for (const entry of entries) {
      const match = entry.match(/^(.+)\.jsonl(?:\.(\d+))?$/);
      if (match) {
        const sessionId = match[1];
        if (!sessionMap.has(sessionId)) {
          sessionMap.set(sessionId, { files: [] });
        }
        sessionMap.get(sessionId)!.files.push(entry);
      }
    }

    const summaries: SessionSummary[] = [];

    for (const [sessionId, { files }] of sessionMap) {
      const filePaths = files.map((f) => path.join(this.sessionsDir, f));
      let totalEntries = 0;
      let lastModified = 0;

      for (const filePath of filePaths) {
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs > lastModified) {
            lastModified = stats.mtimeMs;
          }

          if (stats.size > 100 * 1024) {
            logger.warn({ filePath, size: stats.size }, "Session file too large, skipping read");
            continue;
          }

          const content = fs.readFileSync(filePath, "utf-8");
          for (const line of content.split("\n")) {
            if (line.trim()) {
              totalEntries++;
            }
          }
        } catch {
          // skip unreadable files
        }
      }

      summaries.push({
        sessionId,
        fileCount: files.length,
        lastModified: Math.floor(lastModified),
        totalEntries,
      });
    }

    return summaries.sort((a, b) => b.lastModified - a.lastModified);
  }

  cleanupLocks(activeSessions?: Set<string>): void {
    for (const [sessionId] of this.sessionLocks) {
      if (!activeSessions || !activeSessions.has(sessionId)) {
        this.sessionLocks.delete(sessionId);
      }
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const files = this.allSessionFilePaths(sessionId);

    for (const filePath of files) {
      try {
        fs.unlinkSync(filePath);
      } catch (err: any) {
        logger.warn({ filePath, error: err.message }, "Failed to delete session file");
      }
    }

    const tmpPath = `${this.sessionFilePath(sessionId)}.tmp`;
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }

    logger.info({ sessionId, filesDeleted: files.length }, "Session deleted from persistence");
  }
}
