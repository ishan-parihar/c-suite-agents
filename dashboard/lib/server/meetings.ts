import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface MeetingListItem {
  id: string;
  date: Date | null;
  status: string | null;
  objective: string | null;
  startedAt: Date | null;
  concludedAt: Date | null;
  turnCount: number;
}

export interface MeetingTurn {
  id: string;
  meetingId: string;
  turnNumber: number;
  ceoDirective: string | null;
  ceoResponse: string | null;
  synthesis: string | null;
  createdAt: Date | null;
  responses: MeetingResponse[];
}

export interface MeetingResponse {
  id: string;
  meetingId: string;
  turnNumber: number;
  agentId: string;
  content: string;
  toolCallsMade: number | null;
  toolCallsDetails: unknown;
  timestamp: Date | null;
}

export interface MeetingDetail {
  id: string;
  date: Date | null;
  status: string | null;
  objective: string | null;
  report: string | null;
  userDecision: string | null;
  userFeedback: string | null;
  startedAt: Date | null;
  concludedAt: Date | null;
  createdAt: Date | null;
  turns: MeetingTurn[];
}

export async function getMeetingsList(): Promise<MeetingListItem[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        m.id,
        m.date,
        m.status,
        m.objective,
        m.started_at,
        m.concluded_at,
        COALESCE(
          (SELECT COUNT(*) FROM board_meeting_turns t WHERE t.meeting_id = m.id),
          0
        ) AS turn_count
      FROM board_meetings m
      ORDER BY m.date DESC
    `);

    return result.rows.map((r: any) => ({
      id: r.id,
      date: r.date,
      status: r.status,
      objective: r.objective,
      startedAt: r.started_at,
      concludedAt: r.concluded_at,
      turnCount: Number(r.turn_count),
    }));
  } catch {
    return [];
  }
}

export async function getMeetingDetail(meetingId: string): Promise<MeetingDetail | null> {
  try {
    const meetingResult = await db.execute(sql`
      SELECT
        id,
        date,
        status,
        objective,
        report,
        user_decision,
        user_feedback,
        started_at,
        concluded_at,
        created_at
      FROM board_meetings
      WHERE id = ${meetingId}
    `);

    if (meetingResult.rows.length === 0) return null;

    const m = meetingResult.rows[0] as any;

    const turnsResult = await db.execute(sql`
      SELECT
        t.id,
        t.meeting_id,
        t.turn_number,
        t.ceo_directive,
        t.ceo_response,
        t.synthesis,
        t.created_at
      FROM board_meeting_turns t
      WHERE t.meeting_id = ${meetingId}
      ORDER BY t.turn_number ASC
    `);

    const turns: MeetingTurn[] = turnsResult.rows.map((t: any) => ({
      id: t.id,
      meetingId: t.meeting_id,
      turnNumber: t.turn_number,
      ceoDirective: t.ceo_directive,
      ceoResponse: t.ceo_response,
      synthesis: t.synthesis,
      createdAt: t.created_at,
      responses: [],
    }));

    if (turns.length > 0) {
      const responsesResult = await db.execute(sql`
        SELECT
          meeting_id,
          turn_number,
          id,
          agent_id,
          content,
          tool_calls_made,
          tool_calls_details,
          timestamp
        FROM board_meeting_responses
        WHERE meeting_id = ${meetingId}
        ORDER BY turn_number ASC, timestamp ASC
      `);

      const responseMap = new Map<number, MeetingResponse[]>();
      for (const r of responsesResult.rows) {
        const row = r as any;
        const turnNum = row.turn_number;
        if (!responseMap.has(turnNum)) {
          responseMap.set(turnNum, []);
        }
        responseMap.get(turnNum)!.push({
          id: row.id,
          meetingId: row.meeting_id,
          turnNumber: turnNum,
          agentId: row.agent_id,
          content: row.content,
          toolCallsMade: row.tool_calls_made,
          toolCallsDetails: row.tool_calls_details,
          timestamp: row.timestamp,
        });
      }

      for (const turn of turns) {
        turn.responses = responseMap.get(turn.turnNumber) || [];
      }
    }

    return {
      id: m.id,
      date: m.date,
      status: m.status,
      objective: m.objective,
      report: m.report,
      userDecision: m.user_decision,
      userFeedback: m.user_feedback,
      startedAt: m.started_at,
      concludedAt: m.concluded_at,
      createdAt: m.created_at,
      turns,
    };
  } catch {
    return null;
  }
}
