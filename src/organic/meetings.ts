// Meeting Governance — Organic Board Meeting System

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { getBoardMembers, getStaffById } from "../staff/core-staff.js";
import { getMessagingSystem, type MessagingSystem } from "./messaging.js";
import { validateAgentIdentity } from "../auth/session.js";
import { promises as fs } from "fs";
import { resolve } from "path";

function safeJsonParse<T>(raw: string | undefined | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export type MeetingUrgency = "P1" | "P2" | "P3" | "P4";
export type MeetingStatus = "proposing" | "voting" | "scheduled" | "in_progress" | "completed" | "cancelled" | "rejected";
export type Vote = "yes" | "no" | "abstain";

export interface MeetingProposal {
  id: string;
  proposer: string;
  title: string;
  reason: string;
  urgency: MeetingUrgency;
  status: MeetingStatus;
  votes: Record<string, Vote>;
  required_votes: number;
  voting_deadline: number;
  scheduled_time?: number;
  attendees?: string[];
  notification_failures?: string[];
  created_at: number;
}

export interface MeetingMinutes {
  meeting_id: string;
  decisions: string[];
  action_items: Array<{ description: string; assignee: string; due_date?: string; status: "open" | "in_progress" | "completed"; }>;
  attendees: string[];
  recorded_at: number;
  recorded_by: string;
}

const VOTE_THRESHOLDS: Record<MeetingUrgency, number> = { P1: 3, P2: 4, P3: 5, P4: 6 };
const VOTE_DEADLINES: Record<MeetingUrgency, number> = { P1: 60*60*1000, P2: 24*60*60*1000, P3: 72*60*60*1000, P4: 7*24*60*60*1000 };

export class MeetingGovernance {
  private proposals: Map<string, MeetingProposal> = new Map();
  private minutes: Map<string, MeetingMinutes> = new Map();
  private messaging: MessagingSystem | null = null;
  private db: any = null;
  private dbPath: string = "meetings.db";
  private persistLock = Promise.resolve();

  private async getMessaging(): Promise<MessagingSystem> {
    if (!this.messaging) this.messaging = await getMessagingSystem();
    return this.messaging;
  }

  private queryAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    try {
      if (params) stmt.bind(params.map(p => p === undefined ? null : p));
      const results: Record<string, unknown>[] = [];
      while (stmt.step()) results.push(stmt.getAsObject() as Record<string, unknown>);
      return results;
    } finally {
      stmt.free();
    }
  }

  private async initDB() {
    if (this.db) return;
    const SQL = await import("sql.js");
    const resolved = resolve(this.dbPath);
    let db: any;
    try {
      const buf = await fs.readFile(resolved);
      db = new SQL.default(new Uint8Array(buf));
    } catch {
      db = new SQL.default();
    }
    this.db = db;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS meeting_proposals (
        id TEXT PRIMARY KEY,
        proposer TEXT,
        title TEXT,
        reason TEXT,
        urgency TEXT,
        status TEXT,
        votes TEXT,
        required_votes INTEGER,
        voting_deadline INTEGER,
        scheduled_time INTEGER,
        attendees TEXT,
        notification_failures TEXT,
        created_at INTEGER
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS meeting_minutes (
        meeting_id TEXT PRIMARY KEY,
        decisions TEXT,
        action_items TEXT,
        attendees TEXT,
        recorded_at INTEGER,
        recorded_by TEXT
      )
    `);

    await this.loadProposals();
    await this.loadMinutes();
  }

  private async persist(): Promise<void> {
    if (!this.db) return;
    const prev = this.persistLock;
    let writeError: Error | null = null;
    this.persistLock = (async () => {
      try {
        await prev;
        const data = this.db.export();
        const tmpPath = `${this.dbPath}.tmp`;
        try {
          await fs.writeFile(tmpPath, Buffer.from(data));
          await fs.rename(tmpPath, this.dbPath);
        } catch (err) {
          try { await fs.unlink(tmpPath); } catch { /* tmp may not exist */ }
          throw err;
        }
      } catch (err) {
        writeError = err as Error;
      }
    })().finally(() => {
      this.persistLock = Promise.resolve();
    });
    await this.persistLock;
    if (writeError) throw writeError;
  }

  async close(): Promise<void> {
    await this.persist();
  }

  private async persistProposal(proposal: MeetingProposal) {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO meeting_proposals
      (id, proposer, title, reason, urgency, status, votes, required_votes, voting_deadline, scheduled_time, attendees, notification_failures, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run([
        proposal.id,
        proposal.proposer,
        proposal.title,
        proposal.reason,
        proposal.urgency,
        proposal.status,
        JSON.stringify(proposal.votes),
        proposal.required_votes,
        proposal.voting_deadline,
        proposal.scheduled_time || null,
        JSON.stringify(proposal.attendees || []),
        JSON.stringify(proposal.notification_failures || []),
        proposal.created_at
      ]);
    } finally {
      stmt.free();
    }
  }

  private async loadProposals() {
    if (!this.db) return;

    const rows = this.queryAll("SELECT * FROM meeting_proposals WHERE status NOT IN ('completed', 'cancelled', 'rejected')") as Record<string, unknown>[];
    if (!rows.length) return;

    for (const row of rows) {
      const proposal: MeetingProposal = {
        id: row.id as string,
        proposer: row.proposer as string,
        title: row.title as string,
        reason: row.reason as string,
        urgency: row.urgency as MeetingUrgency,
        status: row.status as MeetingStatus,
        votes: safeJsonParse(row.votes as string, {}),
        required_votes: row.required_votes as number,
        voting_deadline: row.voting_deadline as number,
        scheduled_time: row.scheduled_time as number | undefined,
        attendees: safeJsonParse(row.attendees as string, []),
        notification_failures: safeJsonParse(row.notification_failures as string, []),
        created_at: row.created_at as number
      };
      this.proposals.set(proposal.id, proposal);
    }

    logger.info({ count: this.proposals.size }, "Meeting proposals loaded from database");
  }

  private async persistMinutes(minutes: MeetingMinutes) {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO meeting_minutes
      (meeting_id, decisions, action_items, attendees, recorded_at, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run([
        minutes.meeting_id,
        JSON.stringify(minutes.decisions),
        JSON.stringify(minutes.action_items),
        JSON.stringify(minutes.attendees),
        minutes.recorded_at,
        minutes.recorded_by
      ]);
    } finally {
      stmt.free();
    }
  }

  private async loadMinutes() {
    if (!this.db) return;
    const rows = this.queryAll("SELECT * FROM meeting_minutes") as Record<string, unknown>[];
    if (!rows.length) return;
    for (const row of rows) {
      const minutes: MeetingMinutes = {
        meeting_id: row.meeting_id as string,
        decisions: safeJsonParse(row.decisions as string, []),
        action_items: safeJsonParse(row.action_items as string, []),
        attendees: safeJsonParse(row.attendees as string, []),
        recorded_at: row.recorded_at as number,
        recorded_by: row.recorded_by as string
      };
      this.minutes.set(minutes.meeting_id, minutes);
    }
    logger.info({ count: this.minutes.size }, "Meeting minutes loaded from database");
  }

  async propose({ proposer, title, reason, urgency = "P3" }: { proposer: string; title: string; reason: string; urgency?: MeetingUrgency; }): Promise<MeetingProposal> {
    await this.initDB();
    const proposal_id = uuidv4();
    const boardMembers = getBoardMembers();
    const required_votes = VOTE_THRESHOLDS[urgency];
    const proposal: MeetingProposal = { id: proposal_id, proposer, title, reason, urgency, status: "voting", votes: {}, required_votes, voting_deadline: Date.now() + VOTE_DEADLINES[urgency], notification_failures: [], created_at: Date.now() };
    this.proposals.set(proposal_id, proposal);
    await this.persistProposal(proposal);

    const messaging = await this.getMessaging();
    const targets = boardMembers.filter(m => m.id !== proposer);
    const notifyResults = await Promise.allSettled(targets.map(member =>
      messaging.send({ from: proposer, to: member.id, content: `🏛 BOARD MEETING: ${title}\nUrgency: ${urgency}\nReason: ${reason}\nVotes needed: ${required_votes}/${boardMembers.length}`, priority: urgency, requires_response: true, subject: `Board Meeting: ${title}` })
    ));
    const failedAgentIds = targets.filter((_, i) => notifyResults[i].status === "rejected").map(m => m.id);

    if (failedAgentIds.length > 0) {
      proposal.notification_failures = failedAgentIds;
      await this.persistProposal(proposal);
      await this.persist();
      logger.warn({ failed: failedAgentIds.length, failedAgents: failedAgentIds, total: targets.length }, "Meeting proposal: partial notification failure");
    }

    // If ALL notifications failed, auto-reject the proposal
    if (failedAgentIds.length === targets.length && targets.length > 0) {
      proposal.status = "rejected";
      await this.persistProposal(proposal);
      await this.persist();
      throw new Error(`Meeting proposed but ALL notifications failed (${failedAgentIds.join(", ")}). Messaging system may be down. Cannot proceed with quorum voting.`);
    }

    logger.info({ proposal_id, proposer, title, urgency, notificationFailures: failedAgentIds.length }, "Board meeting proposed");
    return proposal;
  }

  async vote({ meeting_id, voter, vote }: { meeting_id: string; voter: string; vote: Vote; }): Promise<MeetingProposal> {
    const proposal = this.proposals.get(meeting_id);
    if (!proposal) throw new Error(`Meeting ${meeting_id} not found`);
    if (proposal.status !== "voting") throw new Error(`Meeting not accepting votes (${proposal.status})`);
    if (Date.now() > proposal.voting_deadline) {
      throw new Error("Voting deadline passed");
    }

    await validateAgentIdentity(voter);

    const boardMembers = getBoardMembers();
    const isBoardMember = boardMembers.some(m => m.id === voter);
    if (!isBoardMember) throw new Error(`${voter} is not a board member and cannot vote`);

    if (proposal.votes[voter] !== undefined) {
      throw new Error(`${voter} has already voted on this meeting`);
    }

    proposal.votes[voter] = vote;
    this.proposals.set(meeting_id, proposal);
    await this.persistProposal(proposal);
    await this.persist();

    const yesVotes = Object.values(proposal.votes).filter(v => v === "yes").length;
    logger.info({ meeting_id, voter, vote, yesVotes, required: proposal.required_votes }, "Vote cast");

    const decisiveVotes = Object.values(proposal.votes).filter(v => v === "yes" || v === "no").length;
    if (yesVotes >= proposal.required_votes) await this.schedule(meeting_id);
    else if (decisiveVotes >= getBoardMembers().length - 1 && yesVotes < proposal.required_votes) {
      proposal.status = "rejected";
      this.proposals.set(meeting_id, proposal);
    await this.persistProposal(proposal);
    await this.persist();
    }
    return proposal;
  }

  async schedule(meeting_id: string, scheduled_time?: number): Promise<MeetingProposal> {
    await this.initDB();
    const proposal = this.proposals.get(meeting_id);
    if (!proposal) throw new Error(`Meeting ${meeting_id} not found`);
    const scheduledTime = scheduled_time || Date.now() + 2*60*60*1000;
    proposal.status = "scheduled"; proposal.scheduled_time = scheduledTime; proposal.attendees = getBoardMembers().map(m => m.id);
    this.proposals.set(meeting_id, proposal);
    await this.persistProposal(proposal);
    await this.persist();

    const messaging = await this.getMessaging();
    const scheduleResults = await Promise.allSettled(getBoardMembers().map(member =>
      messaging.send({ from: "system", to: member.id, content: `✅ MEETING SCHEDULED: ${proposal.title}\nTime: ${new Date(scheduledTime).toISOString()}`, priority: proposal.urgency, requires_response: false, subject: `Meeting: ${proposal.title}` })
    ));
    const failedSchedules = scheduleResults.filter(r => r.status === "rejected");
    if (failedSchedules.length > 0) {
      logger.warn({ failed: failedSchedules.length }, "Meeting scheduled: partial notification failure");
    }
    logger.info({ meeting_id, scheduled_time: scheduledTime }, "Meeting scheduled");
    return proposal;
  }

  async recordMinutes({ meeting_id, decisions, action_items, attendees, recorded_by }: { meeting_id: string; decisions: string[]; action_items: Array<{ description: string; assignee: string; due_date?: string; }>; attendees: string[]; recorded_by: string; }): Promise<MeetingMinutes> {
    await this.initDB();
    const proposal = this.proposals.get(meeting_id);
    if (!proposal) throw new Error(`Meeting ${meeting_id} not found`);
    const minutes: MeetingMinutes = { meeting_id, decisions, action_items: action_items.map(ai => ({ ...ai, status: "open" })), attendees, recorded_at: Date.now(), recorded_by };
    this.minutes.set(meeting_id, minutes);
    proposal.status = "completed";
    this.proposals.set(meeting_id, proposal);
    await this.persistProposal(proposal);
    await this.persistMinutes(minutes);
    await this.persist();

    const messaging = await this.getMessaging();
    const actionResults = await Promise.allSettled(action_items.map(ai =>
      messaging.send({ from: recorded_by, to: ai.assignee, content: `📋 ACTION ITEM: ${ai.description}${ai.due_date ? ` (Due: ${ai.due_date})` : ""}`, priority: "P3", requires_response: false, subject: `Action: ${ai.description.slice(0, 30)}` })
    ));
    const failedActions = actionResults.filter(r => r.status === "rejected");
    if (failedActions.length > 0) {
      logger.warn({ failed: failedActions.length }, "Action items: partial dispatch failure");
    }
    logger.info({ meeting_id, decisions: decisions.length, action_items: action_items.length }, "Minutes recorded");
    return minutes;
  }

  async executeMeeting(meeting_id: string): Promise<{ success: boolean; message?: string }> {
    const proposal = this.proposals.get(meeting_id);
    if (!proposal) throw new Error(`Meeting ${meeting_id} not found`);
    if (proposal.status !== "scheduled") throw new Error(`Meeting not ready (${proposal.status})`);
    if (proposal.scheduled_time && Date.now() < proposal.scheduled_time) {
      throw new Error(`Meeting scheduled for ${new Date(proposal.scheduled_time).toISOString()}`);
    }

    proposal.status = "in_progress";
    this.proposals.set(meeting_id, proposal);

    const messaging = await this.getMessaging();
    const boardMembers = getBoardMembers();

    await messaging.send({
      from: "system",
      to: "ceo-strategic",
      content: `🏛 BOARD MEETING STARTED: ${proposal.title}\n\nAgenda: ${proposal.reason}\n\nPlease facilitate the discussion. Invite input from other board members as needed.`,
      priority: proposal.urgency,
      requires_response: true,
      subject: `Meeting In Progress: ${proposal.title}`
    });

    for (const member of boardMembers.filter(m => m.id !== "ceo-strategic")) {
      await messaging.send({
        from: "system",
        to: member.id,
        content: `🏛 BOARD MEETING STARTED: ${proposal.title}\n\nYou're expected to participate. Operant will facilitate.`,
        priority: proposal.urgency,
        requires_response: false,
        subject: `Meeting Started: ${proposal.title}`
      });
    }

    logger.info({ meeting_id, title: proposal.title }, "Meeting execution started");
    return { success: true, message: "Meeting convened, Operant notified to facilitate" };
  }

  async checkAndExecuteMeetings(): Promise<number> {
    let executed = 0;
    for (const [id, proposal] of this.proposals.entries()) {
      if (proposal.status === "scheduled" && proposal.scheduled_time && Date.now() >= proposal.scheduled_time) {
        try {
          await this.executeMeeting(id);
          executed++;
        } catch (err: any) {
          logger.error({ meeting_id: id, err: err.message }, "Failed to execute meeting");
        }
      }
    }
    return executed;
  }

  async getProposal(meeting_id: string): Promise<MeetingProposal | null> { return this.proposals.get(meeting_id) || null; }
  async getActiveProposals(): Promise<MeetingProposal[]> { return Array.from(this.proposals.values()).filter(p => p.status === "voting" || p.status === "scheduled" || p.status === "in_progress").sort((a, b) => b.created_at - a.created_at); }
  async getMinutes(meeting_id: string): Promise<MeetingMinutes | null> { return this.minutes.get(meeting_id) || null; }

  cleanup(): void {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const terminalStatuses = new Set(["completed", "rejected", "cancelled"] as const);
    for (const [id, p] of this.proposals.entries()) {
      if (terminalStatuses.has(p.status as typeof terminalStatuses extends Set<infer T> ? T : never)) {
        const age = now - (p.voting_deadline || p.created_at);
        if (age > sevenDays) this.proposals.delete(id);
      }
    }
    for (const [id, m] of this.minutes.entries()) {
      if (now - m.recorded_at > sevenDays) this.minutes.delete(id);
    }
  }
}

let meetingGovernance: MeetingGovernance | null = null;
export function getMeetingGovernance(): MeetingGovernance {
  if (!meetingGovernance) meetingGovernance = new MeetingGovernance();
  return meetingGovernance;
}
