// Upgrade Proposer — Daily technical debt, system health, and upgrade proposals
// Consumed by CTO agent for Telegram delivery to the Board Chair

import { logger } from "../logger.js";
import { LifeOSClient, lifeos } from "../lifeos/client.js";
import { v4 as uuidv4 } from "uuid";

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ProposalItem {
  type: "tech_debt_fix" | "system_upgrade" | "new_feature" | "security_patch";
  title: string;
  description: string;
  filesToModify: string[];
  severity: "P1" | "P2" | "P3" | "P4";
  current_state: string;
  proposed_state: string;
}

export interface UpgradeProposal {
  id: string;
  proposalDate: number; // timestamp
  items: ProposalItem[];
  riskLevel: "low" | "medium" | "high";
  estimatedEffort: string;
  rollbackPlan: string;
  summary: string;
}

// ── Database field type maps ────────────────────────────────────────────────

// Notion property names as they appear in LifeOS databases
interface TechDebtRecord {
  category?: string;
  severity?: string;
  impact_score?: string | number;
  effort_estimate?: string;
  status?: string;
  discovered_date?: string;
  owner_agent?: string;
  resolution_plan?: string;
  title?: string;
  Name?: string;
  // generic fallback
  [key: string]: unknown;
}

interface SystemHealthRecord {
  component_name?: string;
  health_score?: string | number;
  uptime_pct?: string | number;
  error_rate?: string | number;
  last_incident?: string;
  recovery_time_ms?: string | number;
  circuit_breaker_state?: string;
  Name?: string;
  title?: string;
  [key: string]: unknown;
}

interface UpgradeLogRecord {
  upgrade_type?: string;
  current_version?: string;
  proposed_version?: string;
  risk_assessment?: string;
  rollback_plan?: string;
  status?: string;
  Name?: string;
  title?: string;
  [key: string]: unknown;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeStr(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val);
}

function safeNum(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/**
 * Extract a human-readable title from a Notion page record.
 * Notion returns titles under various keys depending on DB schema.
 */
function extractTitle(record: Record<string, unknown>): string {
  return (
    safeStr(record.title) ||
    safeStr(record.Name) ||
    safeStr(record.Title) ||
    safeStr(record.name) ||
    "Unnamed"
  );
}

/**
 * Map LifeOS severity strings to our P1-P4 scale.
 */
function mapSeverity(raw: string): "P1" | "P2" | "P3" | "P4" {
  const lower = raw.toLowerCase();
  if (lower.includes("critical") || lower.includes("p1")) return "P1";
  if (lower.includes("high") || lower.includes("p2")) return "P2";
  if (lower.includes("medium") || lower.includes("p3")) return "P3";
  return "P4";
}

/**
 * Determine overall risk level from the highest-severity item.
 */
function calculateRiskLevel(items: ProposalItem[]): "low" | "medium" | "high" {
  if (items.length === 0) return "low";

  const hasP1 = items.some((i) => i.severity === "P1");
  const hasP2 = items.some((i) => i.severity === "P2");

  if (hasP1 || hasP2) return "high";

  const hasP3 = items.some((i) => i.severity === "P3");
  if (hasP3) return "medium";

  return "low";
}

/**
 * Estimate effort based on item count and types.
 */
function estimateEffort(items: ProposalItem[]): string {
  if (items.length === 0) return "No effort required";

  const securityPatches = items.filter((i) => i.type === "security_patch").length;
  const upgrades = items.filter((i) => i.type === "system_upgrade").length;
  const techDebt = items.filter((i) => i.type === "tech_debt_fix").length;
  const newFeatures = items.filter((i) => i.type === "new_feature").length;

  const total = items.length;
  const complexityScore =
    securityPatches * 2 + // security patches are higher complexity
    upgrades * 3 + // upgrades are most complex
    techDebt * 1 +
    newFeatures * 2;

  if (complexityScore <= 3) {
    return `${total} item(s), low complexity — estimated 1-2 hours`;
  } else if (complexityScore <= 8) {
    return `${total} item(s), moderate complexity — estimated half-day (3-4 hours)`;
  } else if (complexityScore <= 15) {
    return `${total} item(s), significant complexity — estimated 1-2 days`;
  } else {
    return `${total} item(s), high complexity — recommended phased approach over 3-5 days`;
  }
}

/**
 * Generate a consolidated rollback plan from all items.
 */
function generateRollbackPlan(items: ProposalItem[]): string {
  if (items.length === 0) return "No rollback needed — no changes proposed.";

  const plans: string[] = [];

  for (const item of items) {
    if (item.type === "system_upgrade" && item.current_state && item.proposed_state) {
      plans.push(
        `Revert ${item.title}: downgrade from ${item.proposed_state} to ${item.current_state}`
      );
    } else if (item.type === "tech_debt_fix") {
      plans.push(
        `Rollback ${item.title}: restore previous version of modified files via git revert`
      );
    } else if (item.type === "security_patch") {
      plans.push(
        `Rollback ${item.title}: apply previous security baseline and re-test`
      );
    } else {
      plans.push(`Revert ${item.title} via git revert on affected files`);
    }
  }

  return plans.join("; ");
}

/**
 * Build a human-readable summary of all proposal items.
 */
function buildSummary(items: ProposalItem[]): string {
  if (items.length === 0) {
    return "No technical debt, system health issues, or upgrades detected. System is healthy.";
  }

  const byType = new Map<string, number>();
  const bySeverity = new Map<string, number>();

  for (const item of items) {
    byType.set(item.type, (byType.get(item.type) || 0) + 1);
    bySeverity.set(item.severity, (bySeverity.get(item.severity) || 0) + 1);
  }

  const parts: string[] = [];
  parts.push(`Detected ${items.length} item(s) requiring attention:`);

  for (const [type, count] of byType) {
    const label = type
      .replace("_", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    parts.push(`  • ${count}x ${label}`);
  }

  for (const [sev, count] of bySeverity) {
    parts.push(`  • ${count}x severity ${sev}`);
  }

  return parts.join("\n");
}

// ── Data Gathering ──────────────────────────────────────────────────────────

/**
 * Query tech_debt database for detected or analyzed items.
 */
async function gatherTechDebt(client: LifeOSClient): Promise<ProposalItem[]> {
  const items: ProposalItem[] = [];

  try {
    const detected = await client.query({
      database: "tech_debt",
      filter_property: "status",
      filter_value: "detected",
      limit: 50,
    });

    const analyzed = await client.query({
      database: "tech_debt",
      filter_property: "status",
      filter_value: "analyzed",
      limit: 50,
    });

    const allRecords = [...(detected || []), ...(analyzed || [])];

    for (const raw of allRecords) {
      const record = raw as TechDebtRecord;
      const title = extractTitle(record as Record<string, unknown>);
      const severity = mapSeverity(safeStr(record.severity));
      const category = safeStr(record.category) || "general";
      const effort = safeStr(record.effort_estimate) || "unknown";
      const resolutionPlan = safeStr(record.resolution_plan);

      items.push({
        type: "tech_debt_fix",
        title,
        description: `[${category}] Technical debt — severity: ${severity}, effort: ${effort}${resolutionPlan ? `. Resolution: ${resolutionPlan}` : ""}`,
        filesToModify: [], // Will be populated by CTO agent during review
        severity,
        current_state: `Status: ${safeStr(record.status)} | Discovered: ${safeStr(record.discovered_date)} | Owner: ${safeStr(record.owner_agent)}`,
        proposed_state: resolutionPlan || "Resolve technical debt as per resolution plan",
      });
    }
  } catch (err) {
    logger.warn({ err }, "Failed to query tech_debt database");
  }

  return items;
}

/**
 * Query upgrade_log database for pending upgrades.
 */
async function gatherPendingUpgrades(client: LifeOSClient): Promise<ProposalItem[]> {
  const items: ProposalItem[] = [];

  try {
    const pending = await client.query({
      database: "upgrade_log",
      filter_property: "status",
      filter_value: "pending",
      limit: 50,
    });

    for (const raw of pending || []) {
      const record = raw as UpgradeLogRecord;
      const title = extractTitle(record as Record<string, unknown>);
      const upgradeType = safeStr(record.upgrade_type) || "unknown";
      const currentVersion = safeStr(record.current_version);
      const proposedVersion = safeStr(record.proposed_version);
      const riskAssessment = safeStr(record.risk_assessment);
      const rollbackPlan = safeStr(record.rollback_plan);

      // Map upgrade risk to severity
      const severity = riskAssessment.toLowerCase().includes("high")
        ? "P2"
        : riskAssessment.toLowerCase().includes("critical")
          ? "P1"
          : "P3";

      items.push({
        type: "system_upgrade",
        title,
        description: `Upgrade ${upgradeType} from ${currentVersion || "unknown"} to ${proposedVersion || "unknown"}${riskAssessment ? `. Risk: ${riskAssessment}` : ""}`,
        filesToModify: [], // Will be populated during review
        severity,
        current_state: `Current version: ${currentVersion || "unknown"}`,
        proposed_state: `Proposed version: ${proposedVersion || "unknown"}${rollbackPlan ? `. Rollback: ${rollbackPlan}` : ""}`,
      });
    }
  } catch (err) {
    logger.warn({ err }, "Failed to query upgrade_log database");
  }

  return items;
}

/**
 * Query system_health for recent entries with degraded health.
 */
async function gatherSystemHealth(client: LifeOSClient): Promise<ProposalItem[]> {
  const items: ProposalItem[] = [];

  try {
    const healthEntries = await client.query({
      database: "system_health",
      limit: 100,
      sort_property: "health_score",
      sort_direction: "ascending",
    });

    for (const raw of healthEntries || []) {
      const record = raw as SystemHealthRecord;
      const componentName =
        safeStr(record.component_name) ||
        extractTitle(record as Record<string, unknown>);
      const healthScore = safeNum(record.health_score);
      const uptimePct = safeNum(record.uptime_pct);
      const errorRate = safeNum(record.error_rate);
      const lastIncident = safeStr(record.last_incident);
      const recoveryTimeMs = safeNum(record.recovery_time_ms);
      const circuitBreakerState = safeStr(record.circuit_breaker_state);

      // Only flag components with health issues
      const hasIssue =
        healthScore < 80 ||
        uptimePct < 99.9 ||
        errorRate > 1 ||
        circuitBreakerState.toLowerCase().includes("open") ||
        circuitBreakerState.toLowerCase().includes("half-open");

      if (!hasIssue) continue;

      // Determine severity based on health score
      let severity: "P1" | "P2" | "P3" | "P4" = "P4";
      if (healthScore < 30) severity = "P1";
      else if (healthScore < 60) severity = "P2";
      else if (healthScore < 80) severity = "P3";

      // Upgrade to P1 if circuit breaker is open
      if (circuitBreakerState.toLowerCase().includes("open")) {
        severity = "P1";
      }

      items.push({
        type: "system_upgrade",
        title: `System health: ${componentName}`,
        description: `Component "${componentName}" health score: ${healthScore}/100${errorRate > 0 ? `, error rate: ${errorRate}%` : ""}${uptimePct > 0 ? `, uptime: ${uptimePct}%` : ""}`,
        filesToModify: [], // Will be populated during review
        severity,
        current_state: `Health: ${healthScore}/100 | Uptime: ${uptimePct}% | Error rate: ${errorRate}% | Circuit breaker: ${circuitBreakerState || "unknown"} | Last incident: ${lastIncident || "none"} | Recovery: ${recoveryTimeMs}ms`,
        proposed_state: `Restore health score to >90, reduce error rate to <0.1%, ensure circuit breaker is closed`,
      });
    }
  } catch (err) {
    logger.warn({ err }, "Failed to query system_health database");
  }

  return items;
}

// ── Main Export ─────────────────────────────────────────────────────────────

/**
 * Generate a daily upgrade proposal by querying LifeOS databases.
 *
 * Queries tech_debt (detected/analyzed), upgrade_log (pending), and
 * system_health (recent entries with degraded health).
 *
 * If LifeOS is unavailable, returns a minimal proposal with empty items.
 */
export async function generateDailyUpgradeProposal(): Promise<UpgradeProposal> {
  const proposalId = uuidv4();
  const proposalDate = Date.now();

  let techDebtItems: ProposalItem[] = [];
  let upgradeItems: ProposalItem[] = [];
  let healthItems: ProposalItem[] = [];

  try {
    techDebtItems = await gatherTechDebt(lifeos);
    upgradeItems = await gatherPendingUpgrades(lifeos);
    healthItems = await gatherSystemHealth(lifeos);
  } catch (err) {
    logger.error({ err }, "Failed to gather upgrade proposal data from LifeOS");
  }

  const allItems = [...techDebtItems, ...upgradeItems, ...healthItems];
  const riskLevel = calculateRiskLevel(allItems);
  const estimatedEffort = estimateEffort(allItems);
  const rollbackPlan = generateRollbackPlan(allItems);
  const summary = buildSummary(allItems);

  logger.info(
    {
      proposalId,
      itemCount: allItems.length,
      riskLevel,
      techDebtCount: techDebtItems.length,
      upgradeCount: upgradeItems.length,
      healthCount: healthItems.length,
    },
    "Generated daily upgrade proposal"
  );

  return {
    id: proposalId,
    proposalDate,
    items: allItems,
    riskLevel,
    estimatedEffort,
    rollbackPlan,
    summary,
  };
}

/**
 * Format an UpgradeProposal as HTML suitable for Telegram.
 * Uses <b>, <code>, <pre> tags for formatting.
 */
export function formatProposalForTelegram(proposal: UpgradeProposal): string {
  const date = new Date(proposal.proposalDate);
  const dateStr = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const riskEmoji =
    proposal.riskLevel === "high"
      ? "🔴"
      : proposal.riskLevel === "medium"
        ? "🟡"
        : "🟢";

  let html = `<b>📋 Daily Upgrade Proposal</b>\n`;
  html += `<b>Date:</b> ${dateStr}\n`;
  html += `<b>ID:</b> <code>${proposal.id}</code>\n`;
  html += `<b>Risk Level:</b> ${riskEmoji} ${proposal.riskLevel.toUpperCase()}\n`;
  html += `<b>Estimated Effort:</b> ${proposal.estimatedEffort}\n`;
  html += `\n`;

  if (proposal.items.length === 0) {
    html += `<b>Summary:</b> No items requiring attention. System is healthy.\n`;
  } else {
    html += `<b>Summary:</b>\n`;
    html += `<pre>${escapeHtmlForTelegram(proposal.summary)}</pre>\n`;
    html += `\n`;

    html += `<b>Details:</b>\n`;
    html += `━━━━━━━━━━━━━━━━━━━━\n`;

    for (let i = 0; i < proposal.items.length; i++) {
      const item = proposal.items[i];
      const sevEmoji =
        item.severity === "P1"
          ? "🔴"
          : item.severity === "P2"
            ? "🟠"
            : item.severity === "P3"
              ? "🟡"
              : "🔵";

      html += `\n<b>${i + 1}. ${item.title}</b>\n`;
      html += `${sevEmoji} <b>Severity:</b> ${item.severity}\n`;
      html += `<b>Type:</b> ${item.type.replace(/_/g, " ")}\n`;
      html += `<b>Description:</b> ${escapeHtmlForTelegram(item.description)}\n`;
      html += `<b>Current:</b> ${escapeHtmlForTelegram(item.current_state)}\n`;
      html += `<b>Proposed:</b> ${escapeHtmlForTelegram(item.proposed_state)}\n`;

      if (item.filesToModify.length > 0) {
        html += `<b>Files:</b>\n`;
        for (const f of item.filesToModify) {
          html += `  <code>${escapeHtmlForTelegram(f)}</code>\n`;
        }
      }

      if (i < proposal.items.length - 1) {
        html += `────────────────────\n`;
      }
    }

    html += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  }

  html += `\n<b>Rollback Plan:</b>\n`;
  html += `<pre>${escapeHtmlForTelegram(proposal.rollbackPlan)}</pre>\n`;

  return html;
}

/**
 * Escape HTML entities that could break Telegram formatting.
 * Telegram supports: b, i, u, s, spoiler, code, pre, a, emoji, custom_emoji
 */
function escapeHtmlForTelegram(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
