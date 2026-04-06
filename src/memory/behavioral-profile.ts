// Behavioral Profile — Per-agent learned preferences and adaptation
// Tracks interaction outcomes, user corrections, tone preferences,
// and proactivity effectiveness to evolve agent behavior over time.

import { logger } from "../logger.js";
import { getMemoryFacade } from "../memory/index.js";
import type { MemoryEntry } from "./types.js";

export interface InteractionOutcome {
  timestamp: number;
  agentId: string;
  trigger: string;
  outcome: "engaged" | "ignored" | "corrected" | "accepted";
  correction?: string;
  responseLength: number;
  hadToolCalls: boolean;
}

export interface BehavioralProfile {
  agentId: string;
  updatedAt: number;
  tonePreference: "concise" | "detailed" | "mixed";
  avgResponseLength: number;
  toolCallFrequency: number;
  engagementRate: number;
  corrections: Array<{ text: string; count: number; since: number }>;
  proactivityScore: number;
  lastSelfAssessment: number;
}

const DEFAULT_PROFILE: Omit<BehavioralProfile, "agentId"> = {
  updatedAt: 0,
  tonePreference: "mixed",
  avgResponseLength: 120,
  toolCallFrequency: 0.3,
  engagementRate: 0.5,
  corrections: [],
  proactivityScore: 0.5,
  lastSelfAssessment: 0,
};

async function findProfileEntry(agentId: string): Promise<MemoryEntry | null> {
  try {
    const mf = await getMemoryFacade();
    const results = await mf.searchByTag("personal", agentId, "behavioral-profile", 1);
    if (results.length > 0) return results[0];
  } catch { /* no profile yet */ }
  return null;
}

export async function getBehavioralProfile(agentId: string): Promise<BehavioralProfile> {
  try {
    const entry = await findProfileEntry(agentId);
    if (entry?.content) {
      const profile = JSON.parse(entry.content) as BehavioralProfile;
      if (profile.agentId === agentId) return profile;
    }
  } catch { /* corrupt entry, use default */ }
  return { ...DEFAULT_PROFILE, agentId };
}

export async function recordInteractionOutcome(outcome: InteractionOutcome): Promise<void> {
  try {
    const profile = await getBehavioralProfile(outcome.agentId);

    profile.updatedAt = outcome.timestamp;

    if (outcome.outcome === "corrected" && outcome.correction) {
      const existing = profile.corrections.find(c => c.text === outcome.correction);
      if (existing) {
        existing.count++;
      } else {
        profile.corrections.push({ text: outcome.correction, count: 1, since: outcome.timestamp });
      }
    }

    const recentWindow = 20;
    const outcomes: Array<{ outcome: string; timestamp: number }> = [];
    outcomes.push({ outcome: outcome.outcome, timestamp: outcome.timestamp });
    const recent = outcomes.slice(-recentWindow);
    const engagedCount = recent.filter((o) => o.outcome === "engaged" || o.outcome === "accepted").length;
    profile.engagementRate = recent.length > 0 ? engagedCount / recent.length : profile.engagementRate;

    profile.avgResponseLength = profile.avgResponseLength * 0.9 + outcome.responseLength * 0.1;
    profile.toolCallFrequency = profile.toolCallFrequency * 0.9 + (outcome.hadToolCalls ? 1 : 0) * 0.1;

    if (profile.avgResponseLength < 80) profile.tonePreference = "concise";
    else if (profile.avgResponseLength > 300) profile.tonePreference = "detailed";
    else profile.tonePreference = "mixed";

    const mf = await getMemoryFacade();
    await mf.upsert({
      agent_id: outcome.agentId,
      scope: "personal",
      kind: "semantic",
      type: "log",
      content: JSON.stringify(profile),
      importance: 0.4,
      tags: ["behavioral-profile"],
      source: "system",
    });

    logger.debug(
      { agentId: outcome.agentId, outcome: outcome.outcome, engagementRate: profile.engagementRate },
      "behavioral:outcome recorded",
    );
  } catch (err: any) {
    logger.error({ err: err.message }, "behavioral:outcome failed");
  }
}

export async function formatBehavioralPrompt(profile: BehavioralProfile): Promise<string> {
  if (profile.updatedAt === 0) return "";

  const lines: string[] = [];
  lines.push("## YOUR LEARNED BEHAVIOR");
  lines.push("Based on your past interactions, here's what you've learned about working effectively:");
  lines.push("");

  if (profile.tonePreference === "concise") {
    lines.push("- Your user prefers **short, focused responses**. Keep it brief.");
  } else if (profile.tonePreference === "detailed") {
    lines.push("- Your user appreciates **thorough explanations**. Provide context.");
  }

  const topCorrections = profile.corrections
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  if (topCorrections.length > 0) {
    lines.push("- Corrections you've received multiple times (adjust accordingly):");
    for (const c of topCorrections) {
      lines.push(`  • "${c.text}" (${c.count}x)`);
    }
  }

  if (profile.engagementRate < 0.3) {
    lines.push("- ⚠️ Your recent proactive messages have been largely ignored. Be more selective.");
  } else if (profile.engagementRate > 0.7) {
    lines.push("- ✅ Your proactive messages are well-received. Keep it up.");
  }

  lines.push("");
  return lines.join("\n");
}
