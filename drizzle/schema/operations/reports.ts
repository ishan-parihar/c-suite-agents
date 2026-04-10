import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

// ── Ops Reports ────────────────────────────────────────────────────────────

export const opsReports = pgTable('ops_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: text('agent_id').notNull(),
  period: text('period'),
  summary: text('summary'),
  metrics: jsonb('metrics'),
  actions: jsonb('actions'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Ops Sessions ───────────────────────────────────────────────────────────

export const opsSessions = pgTable('ops_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: text('agent_id').notNull(),
  chatId: text('chat_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  lastActive: timestamp('last_active', { withTimezone: true }),
  status: text('status').default('active'),
});

// ── Session Steps ──────────────────────────────────────────────────────────

export const sessionSteps = pgTable('session_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => opsSessions.id)
    .notNull(),
  stepNum: integer('step_num').notNull(),
  stepType: text('step_type').notNull(),
  tool: text('tool'),
  argsHash: text('args_hash'),
  obsSummary: text('obs_summary'),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
});

// ── Tool Correlations ──────────────────────────────────────────────────────

export const toolCorrelations = pgTable('tool_correlations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tool: text('tool').notNull(),
  argsHash: text('args_hash').notNull(),
  result: text('result'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── OC Sessions ────────────────────────────────────────────────────────────

export const ocSessions = pgTable('oc_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: text('chat_id').notNull(),
  agentId: text('agent_id').notNull(),
  ocSessionId: text('oc_session_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
