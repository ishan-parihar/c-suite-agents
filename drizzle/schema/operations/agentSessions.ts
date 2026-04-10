import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

// ── Agent Sessions ─────────────────────────────────────────────────────────

export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: text('agent_id').notNull(),
  chatId: text('chat_id').notNull(),
  sessionId: text('session_id').unique(),
  title: text('title'),
  workspacePath: text('workspace_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastUsed: timestamp('last_used', { withTimezone: true }),
  messageCount: integer('message_count').default(0),
  compactionCount: integer('compaction_count').default(0),
  previousSummary: text('previous_summary'),
  hasRealConversation: boolean('has_real_conversation').default(false),
});

// ── Session Messages ───────────────────────────────────────────────────────

export const sessionMessages = pgTable('session_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => agentSessions.id)
    .notNull(),
  messageIndex: integer('message_index').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  tokenEstimate: integer('token_estimate'),
  isSummary: boolean('is_summary').default(false),
  compacted: boolean('compacted').default(false),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
});

// ── Session Tool Calls ─────────────────────────────────────────────────────

export const sessionToolCalls = pgTable('session_tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => agentSessions.id)
    .notNull(),
  toolIndex: integer('tool_index').notNull(),
  callId: text('call_id'),
  name: text('name').notNull(),
  arguments: jsonb('arguments'),
  result: jsonb('result'),
  tokenEstimate: integer('token_estimate'),
  compacted: boolean('compacted').default(false),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
});
