import { pgTable, uuid, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

// ── Message Threads ────────────────────────────────────────────────────────

export const messageThreads = pgTable('message_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  participants: jsonb('participants').notNull(),
  subject: text('subject'),
  status: text('status').default('active'),
  tags: jsonb('tags'),
  summary: text('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ── Messages ───────────────────────────────────────────────────────────────

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id')
    .references(() => messageThreads.id)
    .notNull(),
  fromAgent: text('from_agent').notNull(),
  toAgent: text('to_agent').notNull(),
  content: text('content').notNull(),
  priority: text('priority').default('P3'),
  requiresResponse: boolean('requires_response').default(false),
  responded: boolean('responded').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  read: boolean('read').default(false),
  tags: jsonb('tags'),
  embedding: jsonb('embedding'),
});

// ── Message Escalations ────────────────────────────────────────────────────

export const messageEscalations = pgTable('message_escalations', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id')
    .references(() => messageThreads.id)
    .notNull(),
  fromAgent: text('from_agent').notNull(),
  toAgent: text('to_agent').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  status: text('status').default('pending'),
});
