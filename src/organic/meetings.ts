// Meeting Governance — Organic Board Meeting System

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { getBoardMembers, getStaffById } from "../staff/core-staff.js";
import { getMessagingSystem, type MessagingSystem } from "./messaging.js";
import { validateAgentIdentity } from "../auth/session.js";

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

  private async getMessaging(): Promise<MessagingSystem> {
    if (!this.messaging) this.messaging = await getMessagingSystem();
    return this.messaging;
  }

  private async initDB() {
    if (this.db) return;
    const messaging = await this.getMessaging();
    this.db = (messaging as any).db;
    
    if (!this.db) return;
    
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
  }

  private async persistProposal(proposal: MeetingProposal) {
    if (!this.db) return;
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO meeting_proposals 
      (id, proposer, title, reason, urgency, status, votes, required_votes, voting_deadline, scheduled_time, attendees, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
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
      proposal.created_at
    ]);
    stmt.free();
  }

  private async loadProposals() {
    if (!this.db) return;
    
    const rows = this.db.exec("SELECT * FROM meeting_proposals WHERE status NOT IN ('completed', 'cancelled', 'rejected')");
    if (!rows.length) return;
    
    for (const row of rows[0].values) {
      const proposal: MeetingProposal = {
        id: row[0],
        proposer: row[1],
        title: row[2],
        reason: row[3],
        urgency: row[4],
        status: row[5],
        votes: JSON.parse(row[6]),
        required_votes: row[7],
        voting_deadline: row[8],
        scheduled_time: row[9],
        attendees: JSON.parse(row[10]),
        created_at: row[11]
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
    
    stmt.run([
      minutes.meeting_id,
      JSON.stringify(minutes.decisions),
      JSON.stringify(minutes.action_items),
      JSON.stringify(minutes.attendees),
      minutes.recorded_at,
      minutes.recorded_by
    ]);
    stmt.free();
  }

  async propose({ proposer, title, reason, urgency = "P3" }: { proposer: string; title: string; reason: string; urgency?: MeetingUrgency; }): Promise<MeetingProposal> {
    await this.initDB();
    const proposal_id = uuidv4();
    const boardMembers = getBoardMembers();
    const required_votes = VOTE_THRESHOLDS[urgency];
    const proposal: MeetingProposal = { id: proposal_id, proposer, title, reason, urgency, status: "voting", votes: {}, required_votes, voting_deadline: Date.now() + VOTE_DEADLINES[urgency], created_at: Date.now() };
    this.proposals.set(proposal_id, proposal);
    await this.persistProposal(proposal);

    const messaging = await this.getMessaging();
    await Promise.all(boardMembers.filter(m => m.id !== proposer).map(member =>
      messaging.send({ from: proposer, to: member.id, content: `🏛 BOARD MEETING: ${title}\nUrgency: ${urgency}\nReason: ${reason}\nVotes needed: ${required_votes}/${boardMembers.length}`, priority: urgency, requires_response: true, subject: `Board Meeting: ${title}` })
    ));

    logger.info({ proposal_id, proposer, title, urgency }, "Board meeting proposed");
    return proposal;
  }

  async vote({ meeting_id, voter, vote }: { meeting_id: string; voter: string; vote: Vote; }): Promise<MeetingProposal> {
    const proposal = this.proposals.get(meeting_id);
    if (!proposal) throw new Error(`Meeting ${meeting_id} not found`);
    if (proposal.status !== "voting") throw new Error(`Meeting not accepting votes (${proposal.status})`);
    if (Date.now() > proposal.voting_deadline) { proposal.status = "rejected"; this.proposals.set(meeting_id, proposal); throw new Error("Voting deadline passed"); }

    const voterValidation = await validateAgentIdentity(voter);
    if (!voterValidation.valid) throw new Error(`Invalid voter: ${voter}`);
    
    const boardMembers = getBoardMembers();
    const isBoardMember = boardMembers.some(m => m.id === voter);
    if (!isBoardMember) throw new Error(`${voter} is not a board member and cannot vote`);

    proposal.votes[voter] = vote;
    this.proposals.set(meeting_id, proposal);
    await this.persistProposal(proposal);
    
    const yesVotes = Object.values(proposal.votes).filter(v => v === "yes").length;
    logger.info({ meeting_id, voter, vote, yesVotes, required: proposal.required_votes }, "Vote cast");

    if (yesVotes >= proposal.required_votes) await this.schedule(meeting_id);
    else if (Object.keys(proposal.votes).length >= getBoardMembers().length - 1 && yesVotes < proposal.required_votes) {
      proposal.status = "rejected"; 
      this.proposals.set(meeting_id, proposal);
      await this.persistProposal(proposal);
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

    const messaging = await this.getMessaging();
    await Promise.all(getBoardMembers().map(member =>
      messaging.send({ from: "system", to: member.id, content: `✅ MEETING SCHEDULED: ${proposal.title}\nTime: ${new Date(scheduledTime).toISOString()}`, priority: proposal.urgency, requires_response: false, subject: `Meeting: ${proposal.title}` })
    ));
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

    const messaging = await this.getMessaging();
    await Promise.all(action_items.map(ai =>
      messaging.send({ from: recorded_by, to: ai.assignee, content: `📋 ACTION ITEM: ${ai.description}${ai.due_date ? ` (Due: ${ai.due_date})` : ""}`, priority: "P3", requires_response: false, subject: `Action: ${ai.description.slice(0, 30)}` })
    ));
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
      to: "strategos",
      content: `🏛 BOARD MEETING STARTED: ${proposal.title}\n\nAgenda: ${proposal.reason}\n\nPlease facilitate the discussion. Invite input from other board members as needed.`,
      priority: proposal.urgency,
      requires_response: true,
      subject: `Meeting In Progress: ${proposal.title}`
    });

    for (const member of boardMembers.filter(m => m.id !== "strategos")) {
      await messaging.send({
        from: "system",
        to: member.id,
        content: `🏛 BOARD MEETING STARTED: ${proposal.title}\n\nYou're expected to participate. Strategos will facilitate.`,
        priority: proposal.urgency,
        requires_response: false,
        subject: `Meeting Started: ${proposal.title}`
      });
    }

    logger.info({ meeting_id, title: proposal.title }, "Meeting execution started");
    return { success: true, message: "Meeting convened, Strategos notified to facilitate" };
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
}

let meetingGovernance: MeetingGovernance | null = null;
export function getMeetingGovernance(): MeetingGovernance {
  if (!meetingGovernance) meetingGovernance = new MeetingGovernance();
  return meetingGovernance;
}
