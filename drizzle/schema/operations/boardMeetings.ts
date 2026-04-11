import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

// ── Board Meetings ─────────────────────────────────────────────────────────

export const boardMeetings = pgTable('board_meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  status: text('status').default('scheduled'),
  objective: text('objective'),
  report: text('report'),
  userDecision: text('user_decision'),
  userFeedback: text('user_feedback'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  concludedAt: timestamp('concluded_at', { withTimezone: true }),
  content: jsonb('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Board Meeting Turns ────────────────────────────────────────────────────

export const boardMeetingTurns = pgTable('board_meeting_turns', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id')
    .references(() => boardMeetings.id)
    .notNull(),
  turnNumber: integer('turn_number').notNull(),
  ceoDirective: text('ceo_directive'),
  ceoResponse: text('ceo_response'),
  synthesis: text('synthesis'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Board Meeting Responses ────────────────────────────────────────────────

export const boardMeetingResponses = pgTable('board_meeting_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id')
    .references(() => boardMeetings.id)
    .notNull(),
  turnNumber: integer('turn_number').notNull(),
  agentId: text('agent_id').notNull(),
  content: text('content').notNull(),
  toolCallsMade: integer('tool_calls_made').default(0),
  toolCallsDetails: jsonb('tool_calls_details'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
});
