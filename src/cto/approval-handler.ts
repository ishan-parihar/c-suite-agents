import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import Database from "better-sqlite3";
import { logger } from "../logger.js";
import { AsyncMutex } from "../runtime/async-mutex.js";
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

const upgradeMutex = new AsyncMutex();

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
        edit_instructions_json TEXT DEFAULT NULL,
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
  const realResolved = fs.realpathSync(resolved);
  const realWorkspace = fs.realpathSync(workspace);
  if (realResolved !== realWorkspace && !realResolved.startsWith(realWorkspace + path.sep)) {
    throw new Error(
      `Path escapes workspace (symlink resolved): ${relativePath} resolves to ${realResolved}`
    );
  }
  const normalizedRelative = path.normalize(relativePath);
  if (!allowedFiles.includes(normalizedRelative) && !allowedFiles.includes(relativePath)) {
    throw new Error(
      `File not in proposal's filesToModify: ${relativePath}`
    );
  }
  return realResolved;
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
  const stat = fs.statSync(filePath);
  if (stat.size > 100 * 1024) {
    return {
      success: false,
      message: `File too large (max 100KB): ${filePath}`,
    };
  }
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

function rollback(backups: BackupEntry[]): { success: boolean; failedFiles: string[] } {
  const failedFiles: string[] = [];
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
      failedFiles.push(backup.filePath);
    }
  }
  return { success: failedFiles.length === 0, failedFiles };
}

const MAX_CACHE_SIZE = 50;
const proposalCache = new Map<string, UpgradeProposalWithAgent>();

export function cacheProposal(proposal: UpgradeProposalWithAgent): void {
  if (proposalCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = proposalCache.keys().next().value;
    if (oldestKey !== undefined) proposalCache.delete(oldestKey);
  }
  proposalCache.set(proposal.id, proposal);
}

interface UpgradeProposalWithAgent extends UpgradeProposal {
  agent_id: string;
}

function getProposal(proposalId: string): UpgradeProposalWithAgent | null {
  const cached = proposalCache.get(proposalId);
  if (cached) return cached;

  const db = getDb();
  const row = db
    .prepare("SELECT * FROM upgrade_log WHERE proposal_id = ?")
    .get(proposalId) as
    | { items_json: string; edit_instructions_json: string | null; files_to_modify: string; summary: string; created_date: string; agent_id: string; status: string }
    | undefined;
  if (!row) return null;

  const items = JSON.parse(row.items_json) as ProposalItemWithEdits[];
  const dbEditInstructions = row.edit_instructions_json ? JSON.parse(row.edit_instructions_json) as Array<{ file: string; old_string: string; new_string: string }> : [];

  // Validate items schema
  const validSeverities = ["critical", "high", "medium", "low", "info"];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`Invalid item at index ${i}: must be an object`);
    }
    if (typeof item.type !== "string") {
      throw new Error(`Invalid item at index ${i}: type must be a string, got ${typeof item.type}`);
    }
    if (typeof item.title !== "string") {
      throw new Error(`Invalid item at index ${i}: title must be a string, got ${typeof item.title}`);
    }
    if (!validSeverities.includes(item.severity)) {
      throw new Error(`Invalid item at index ${i}: severity must be one of ${validSeverities.join(", ")}, got "${item.severity}"`);
    }
    if (item.filesToModify !== undefined) {
      if (!Array.isArray(item.filesToModify)) {
        throw new Error(`Invalid item at index ${i}: filesToModify must be an array or undefined`);
      }
      for (let j = 0; j < item.filesToModify.length; j++) {
        if (typeof item.filesToModify[j] !== "string") {
          throw new Error(`Invalid item at index ${i}: filesToModify[${j}] must be a string`);
        }
      }
    }
  }

  // Validate edit_instructions schema
  if (!Array.isArray(dbEditInstructions)) {
    throw new Error(`Invalid dbEditInstructions: must be an array`);
  }
  for (let i = 0; i < dbEditInstructions.length; i++) {
    const edit = dbEditInstructions[i];
    if (typeof edit !== "object" || edit === null || Array.isArray(edit)) {
      throw new Error(`Invalid edit instruction at index ${i}: must be an object`);
    }
    if (typeof edit.file !== "string") {
      throw new Error(`Invalid edit instruction at index ${i}: file must be a string`);
    }
    if (typeof edit.old_string !== "string") {
      throw new Error(`Invalid edit instruction at index ${i}: old_string must be a string`);
    }
    if (typeof edit.new_string !== "string") {
      throw new Error(`Invalid edit instruction at index ${i}: new_string must be a string`);
    }
  }

  // Distribute edit_instructions from DB back to items by matching file paths
  if (dbEditInstructions.length > 0) {
    for (const item of items) {
      if (!item.edit_instructions || item.edit_instructions.length === 0) {
        const matching = dbEditInstructions.filter(
          (e) => item.filesToModify.includes(e.file)
        );
        if (matching.length > 0) {
          item.edit_instructions = matching;
        }
      }
    }
  }

  return {
    id: proposalId,
    proposalDate: Date.now(),
    summary: row.summary,
    items,
    riskLevel: "low",
    estimatedEffort: "",
    rollbackPlan: "",
    agent_id: row.agent_id,
  };
}

function storeProposalInDb(proposal: UpgradeProposalWithAgent): void {
  const db = getDb();
  const existing = db.prepare("SELECT status FROM upgrade_log WHERE proposal_id = ?").get(proposal.id) as { status: string } | undefined;
  if (existing && existing.status !== "pending") {
    logger.warn(`[CTO] Proposal ${proposal.id} already has status "${existing.status}", skipping insert to preserve history`);
    return;
  }
  db.prepare(
    `INSERT OR REPLACE INTO upgrade_log (proposal_id, summary, items_json, edit_instructions_json, files_to_modify, status, created_date)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`
  ).run(
    proposal.id,
    proposal.summary,
    JSON.stringify(proposal.items),
    JSON.stringify(proposal.items.flatMap((i) => (i as ProposalItemWithEdits).edit_instructions ?? []).flat()),
    JSON.stringify(proposal.items.flatMap((i) => i.filesToModify))
  );
}

export async function executeApprovedUpgrade(
  proposalId: string
): Promise<{ success: boolean; message: string; commitHash?: string }> {
  const release = await upgradeMutex.acquire("upgrade-execution");
  try {
    return await executeUpgrade(proposalId);
  } finally {
    release();
  }
}

async function executeUpgrade(
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
  let filesList = Array.from(allFilesToModify);

  if (filesList.length === 0) {
    const editFiles = proposal.items.flatMap(
      (item) => (item as ProposalItemWithEdits).edit_instructions?.map((e) => e.file) ?? []
    );
    if (editFiles.length > 0) {
      filesList = [...new Set(editFiles)];
      allFilesToModify.clear();
      for (const f of filesList) allFilesToModify.add(f);
    }
  }

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
            const fileStat = fs.statSync(resolvedPath);
            if (fileStat.size > 100 * 1024) {
              logger.warn({ path: resolvedPath, size: fileStat.size }, "File too large, skipping backup");
            } else {
              backups.push({
                filePath: resolvedPath,
                content: fs.readFileSync(resolvedPath, "utf-8"),
                existed: true,
              });
            }
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
            const fileStat = fs.statSync(resolvedPath);
            if (fileStat.size > 100 * 1024) {
              logger.warn({ path: resolvedPath, size: fileStat.size }, "File too large, skipping backup");
            } else {
              backups.push({
                filePath: resolvedPath,
                content: fs.readFileSync(resolvedPath, "utf-8"),
                existed: true,
              });
            }
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
      const rollbackResult = rollback(backups);
      const rollbackDetail = rollbackResult.success ? "" : ` Rollback partially failed: ${rollbackResult.failedFiles.join(", ")}.`;
      return { success: false, message: `Git commit failed: ${commitResult.message}.${rollbackDetail}` };
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
    const rollbackResult = rollback(backups);
    const rollbackDetail = rollbackResult.success ? "" : ` Rollback partially failed: ${rollbackResult.failedFiles.join(", ")}.`;
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
      message: `Upgrade failed: ${err.message}. All changes have been rolled back.${rollbackDetail}`,
    };
  }
}

export async function handleUpgradeApproval(
  proposalId: string,
  decision: "approved" | "rejected",
  callerAgentId?: string
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

  if (proposal.agent_id !== CTO_AGENT_ID) {
    return { success: false, message: "Unauthorized: proposal was not created by CTO agent" };
  }

  if (callerAgentId !== undefined) {
    if (callerAgentId !== CTO_AGENT_ID) {
      return { success: false, message: "Unauthorized: caller is not the CTO agent" };
    }
  } else {
    logger.warn(`[CTO] handleUpgradeApproval called without callerAgentId — allowing for backwards compatibility`);
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
    `UPDATE upgrade_log SET status = 'executing', approval_date = datetime('now') WHERE proposal_id = ?`
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
