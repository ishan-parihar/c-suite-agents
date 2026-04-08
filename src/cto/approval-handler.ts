import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import Database from "better-sqlite3";
import { logger } from "../logger.js";
import type { UpgradeProposal, ProposalItem } from "./upgrade-proposer.js";

// Extended types for execution-layer fields
export interface ProposalItemWithEdits extends ProposalItem {
  edit_instructions?: Array<{ file: string; old_string: string; new_string: string }>;
}

export interface UpgradeProposalExtended extends UpgradeProposal {
  title: string;
  agent_id: string;
  filesToModify: string[];
}

const SOURCE_WORKSPACE = (() => {
  const env = process.env.SOURCE_WORKSPACE;
  if (!env) {
    return process.cwd();
  }
  return env;
})();

const CTO_AGENT_ID = "cto-technical";

function getDbPath(): string {
  const dataDir = path.join(
    process.env.HOME || process.env.USERPROFILE || "/root",
    ".strategos",
    "data"
  );
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "upgrade-log.db");
}

let ctoDb: Database.Database | null = null;

function getDb(): Database.Database {
  if (!ctoDb) {
    ctoDb = new Database(getDbPath());
    ctoDb.pragma("journal_mode = WAL");
    ctoDb.exec(`
      CREATE TABLE IF NOT EXISTS upgrade_log (
        proposal_id        TEXT PRIMARY KEY,
        title              TEXT NOT NULL,
        summary            TEXT NOT NULL,
        agent_id           TEXT NOT NULL DEFAULT '${CTO_AGENT_ID}',
        items_json         TEXT NOT NULL,
        files_to_modify    TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'pending',
        created_date       TEXT NOT NULL DEFAULT (datetime('now')),
        approval_date      TEXT,
        completion_date    TEXT,
        commit_hash        TEXT,
        error_message      TEXT,
        created_by         TEXT
      );
    `);
  }
  return ctoDb;
}

export function closeCtoDb(): void {
  if (ctoDb) {
    ctoDb.close();
    ctoDb = null;
  }
}

function validateWorkspace(): string {
  if (!SOURCE_WORKSPACE) {
    throw new Error("SOURCE_WORKSPACE is not set");
  }
  if (!path.isAbsolute(SOURCE_WORKSPACE)) {
    throw new Error(
      `SOURCE_WORKSPACE must be an absolute path, got: ${SOURCE_WORKSPACE}`
    );
  }
  if (!fs.existsSync(SOURCE_WORKSPACE)) {
    throw new Error(`SOURCE_WORKSPACE does not exist: ${SOURCE_WORKSPACE}`);
  }
  const resolved = path.resolve(SOURCE_WORKSPACE);
  if (resolved !== SOURCE_WORKSPACE) {
    throw new Error(
      `SOURCE_WORKSPACE is not canonical: ${SOURCE_WORKSPACE} vs ${resolved}`
    );
  }
  return resolved;
}

function resolveSafePath(
  relativePath: string,
  allowedFiles: string[],
  workspace: string
): string {
  if (relativePath.includes("..")) {
    throw new Error(`Path traversal not allowed: ${relativePath}`);
  }
  const resolved = path.resolve(workspace, relativePath);
  if (!resolved.startsWith(workspace + path.sep) && resolved !== workspace) {
    throw new Error(
      `Path escapes workspace: ${relativePath} resolves to ${resolved}`
    );
  }
  const normalizedRelative = path.normalize(relativePath);
  if (!allowedFiles.includes(normalizedRelative) && !allowedFiles.includes(relativePath)) {
    throw new Error(
      `File not in proposal's filesToModify: ${relativePath}`
    );
  }
  return resolved;
}

// Atomic write: write to .tmp then rename (mirrors fs-write.ts)
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* tmp may not exist */ }
    throw err;
  }
}

interface EditResult {
  success: boolean;
  message: string;
  originalContent?: string;
}

// Surgical edit with uniqueness check (mirrors fs-edit.ts)
function performSurgicalEdit(
  filePath: string,
  oldString: string,
  newString: string
): EditResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const firstIndex = content.indexOf(oldString);
  if (firstIndex === -1) {
    return {
      success: false,
      message: `old_string not found in ${filePath}`,
      originalContent: content,
    };
  }
  const lastIndex = content.lastIndexOf(oldString);
  if (firstIndex !== lastIndex) {
    const count = content.split(oldString).length - 1;
    return {
      success: false,
      message: `old_string appears ${count} times in ${filePath}; include more context to make it unique`,
      originalContent: content,
    };
  }
  const newContent = content.replace(oldString, newString);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tmpPath, newContent, "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* tmp may not exist */ }
    throw err;
  }
  return {
    success: true,
    message: `Edited ${filePath}: replaced ${oldString.length} chars with ${newString.length} chars`,
    originalContent: content,
  };
}

function gitCommit(
  workspace: string,
  proposalId: string,
  summary: string
): { success: boolean; commitHash?: string; message: string } {
  const addResult = spawnSync("git", ["add", "-A"], {
    cwd: workspace,
    encoding: "utf-8",
    timeout: 30000,
  });
  if (addResult.error) {
    return { success: false, message: `git add failed: ${addResult.error.message}` };
  }
  if (addResult.status !== 0) {
    return { success: false, message: `git add failed: ${addResult.stderr || addResult.stdout}` };
  }

  const commitMsg = `CTO upgrade: ${proposalId} - ${summary}`;
  const commitResult = spawnSync("git", ["commit", "-m", commitMsg], {
    cwd: workspace,
    encoding: "utf-8",
    timeout: 30000,
  });
  if (commitResult.error) {
    return { success: false, message: `git commit failed: ${commitResult.error.message}` };
  }
  if (commitResult.status !== 0) {
    const output = (commitResult.stderr || commitResult.stdout || "").trim();
    if (output.includes("nothing to commit") || output.includes("nothing added")) {
      return { success: true, message: "No changes to commit (all items already applied)" };
    }
    return { success: false, message: `git commit failed: ${output}` };
  }

  // Extract commit hash from git output format: "[branch abc1234] message"
  const stdout = commitResult.stdout || "";
  const hashMatch = stdout.match(/\[.*?([a-f0-9]{7,})\]/);
  const commitHash = hashMatch ? hashMatch[1] : undefined;
  return {
    success: true,
    commitHash,
    message: `Committed: ${commitMsg}${commitHash ? ` (${commitHash})` : ""}`,
  };
}

interface BackupEntry {
  filePath: string;
  content: string;
  existed: boolean;
}

function rollback(backups: BackupEntry[]): void {
  for (const backup of backups) {
    try {
      if (backup.existed) {
        atomicWrite(backup.filePath, backup.content);
        logger.info(`Rolled back ${backup.filePath} to original content`);
      } else {
        if (fs.existsSync(backup.filePath)) {
          fs.unlinkSync(backup.filePath);
          logger.info(`Removed newly created file ${backup.filePath} during rollback`);
        }
      }
    } catch (err: any) {
      logger.error(`Failed to rollback ${backup.filePath}: ${err.message}`);
    }
  }
}

const MAX_CACHE_SIZE = 50;
const proposalCache = new Map<string, UpgradeProposal>();

export function cacheProposal(proposal: UpgradeProposal): void {
  if (proposalCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = proposalCache.keys().next().value;
    if (oldestKey !== undefined) proposalCache.delete(oldestKey);
  }
  proposalCache.set(proposal.id, proposal);
}

function getProposal(proposalId: string): UpgradeProposal | null {
  const cached = proposalCache.get(proposalId);
  if (cached) return cached;

  const db = getDb();
  const row = db
    .prepare("SELECT * FROM upgrade_log WHERE proposal_id = ?")
    .get(proposalId) as
    | { items_json: string; files_to_modify: string; summary: string; created_date: string }
    | undefined;
  if (!row) return null;

  return {
    id: proposalId,
    proposalDate: Date.now(),
    summary: row.summary,
    items: JSON.parse(row.items_json) as ProposalItem[],
    riskLevel: "low",
    estimatedEffort: "",
    rollbackPlan: "",
  };
}

function storeProposalInDb(proposal: UpgradeProposal): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO upgrade_log (proposal_id, summary, items_json, files_to_modify, status, created_date)
     VALUES (?, ?, ?, ?, 'pending', datetime('now'))`
  ).run(
    proposal.id,
    proposal.summary,
    JSON.stringify(proposal.items),
    JSON.stringify(proposal.items.flatMap((i) => i.filesToModify))
  );
}

export async function executeApprovedUpgrade(
  proposalId: string
): Promise<{ success: boolean; message: string; commitHash?: string }> {
  const workspace = validateWorkspace();
  logger.info(`[CTO] Executing approved upgrade ${proposalId} in workspace: ${workspace}`);

  const proposal = getProposal(proposalId);
  if (!proposal) {
    return { success: false, message: `Proposal not found: ${proposalId}` };
  }

  const allFilesToModify = new Set<string>(
    proposal.items.flatMap((item) => item.filesToModify)
  );
  const filesList = Array.from(allFilesToModify);

  const backups: BackupEntry[] = [];
  const appliedEdits: Array<{ file: string; oldString: string; newString: string }> = [];

  try {
    for (const item of proposal.items) {
      logger.info(`[CTO] Processing item: ${item.type} — ${item.title} (severity: ${item.severity})`);

      if ((item as ProposalItemWithEdits).edit_instructions && (item as ProposalItemWithEdits).edit_instructions!.length > 0) {
        for (const edit of (item as ProposalItemWithEdits).edit_instructions!) {
          const resolvedPath = resolveSafePath(edit.file, filesList, workspace);
          if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Target file does not exist: ${edit.file}`);
          }
          if (!backups.some((b) => b.filePath === resolvedPath)) {
            backups.push({
              filePath: resolvedPath,
              content: fs.readFileSync(resolvedPath, "utf-8"),
              existed: true,
            });
          }
          const result = performSurgicalEdit(resolvedPath, edit.old_string, edit.new_string);
          if (!result.success) {
            throw new Error(`Edit failed for ${edit.file}: ${result.message}`);
          }
          appliedEdits.push({ file: edit.file, oldString: edit.old_string, newString: edit.new_string });
          logger.info(`[CTO] ${result.message}`);
        }
      } else {
        for (const targetFile of item.filesToModify) {
          const resolvedPath = resolveSafePath(targetFile, filesList, workspace);
          if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Target file does not exist: ${targetFile}`);
          }
          if (!backups.some((b) => b.filePath === resolvedPath)) {
            backups.push({
              filePath: resolvedPath,
              content: fs.readFileSync(resolvedPath, "utf-8"),
              existed: true,
            });
          }
          const result = performSurgicalEdit(resolvedPath, item.current_state, item.proposed_state);
          if (!result.success) {
            throw new Error(`Edit failed for ${targetFile}: ${result.message}`);
          }
          appliedEdits.push({ file: targetFile, oldString: item.current_state, newString: item.proposed_state });
          logger.info(`[CTO] ${result.message}`);
        }
      }
    }

    const commitResult = gitCommit(workspace, proposalId, proposal.summary);
    if (!commitResult.success) {
      logger.error(`[CTO] Git commit failed, rolling back ${backups.length} file(s)`);
      rollback(backups);
      return { success: false, message: `Git commit failed: ${commitResult.message}` };
    }

    const db = getDb();
    db.prepare(
      `UPDATE upgrade_log SET status = 'completed', completion_date = datetime('now'), commit_hash = ? WHERE proposal_id = ?`
    ).run(commitResult.commitHash || null, proposalId);

    logger.info(`[CTO] Upgrade ${proposalId} completed successfully. Commit: ${commitResult.commitHash || "N/A"}`);
    return {
      success: true,
      message: `Upgrade ${proposalId} applied and committed. ${appliedEdits.length} edit(s) across ${backups.length} file(s).${commitResult.commitHash ? ` Commit: ${commitResult.commitHash}` : ""}`,
      commitHash: commitResult.commitHash,
    };
  } catch (err: any) {
    logger.error(`[CTO] Upgrade ${proposalId} failed: ${err.message}. Rolling back ${backups.length} file(s)...`);
    rollback(backups);
    try {
      const db = getDb();
      db.prepare(
        `UPDATE upgrade_log SET status = 'failed', error_message = ? WHERE proposal_id = ?`
      ).run(err.message, proposalId);
    } catch (dbErr: any) {
      logger.error(`[CTO] Failed to log error to DB: ${dbErr.message}`);
    }
    return {
      success: false,
      message: `Upgrade failed: ${err.message}. All changes have been rolled back.`,
    };
  }
}

export async function handleUpgradeApproval(
  proposalId: string,
  decision: "approved" | "rejected"
): Promise<{ success: boolean; message: string }> {
  logger.info(`[CTO] Processing ${decision} decision for proposal ${proposalId}`);

  try {
    validateWorkspace();
  } catch (err: any) {
    return { success: false, message: `Workspace validation failed: ${err.message}` };
  }

  const proposal = getProposal(proposalId);
  if (!proposal) {
    return { success: false, message: `Proposal not found: ${proposalId}` };
  }

  storeProposalInDb(proposal);
  const db = getDb();

  if (decision === "rejected") {
    db.prepare(
      `UPDATE upgrade_log SET status = 'rejected', approval_date = datetime('now') WHERE proposal_id = ?`
    ).run(proposalId);
    logger.info(`[CTO] Proposal ${proposalId} rejected`);
    return {
      success: true,
      message: `Proposal "${proposal.summary.slice(0, 60)}" has been rejected. No changes were made.`,
    };
  }

  db.prepare(
    `UPDATE upgrade_log SET status = 'approved', approval_date = datetime('now') WHERE proposal_id = ?`
  ).run(proposalId);
  logger.info(`[CTO] Proposal ${proposalId} approved. Executing upgrade...`);

  const result = await executeApprovedUpgrade(proposalId);
  if (result.success) {
    return {
      success: true,
      message: `Proposal "${proposal.summary.slice(0, 60)}" approved and applied. ${result.message}`,
    };
  }
  return {
    success: false,
    message: `Proposal "${proposal.summary.slice(0, 60)}" was approved but execution failed: ${result.message}`,
  };
}
