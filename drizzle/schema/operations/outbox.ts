import { pgTable, uuid, text, jsonb, boolean, integer, timestamp, index } from 'drizzle-orm/pg-core';

// ── Transactional Outbox Events ─────────────────────────────────────────────
//
// Implements the Transactional Outbox pattern:
// 1. INSERT/UPDATE entity row within a Drizzle transaction
// 2. INSERT into outbox_events in the SAME transaction
// 3. COMMIT → both entity and outbox event are atomic
// 4. OutboxRelay worker (cron) polls for unpublished events
// 5. Publishes to SSE/WS → marks published=true
//
// This eliminates the dual-write problem where DB succeeds but event publish fails.

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: text('event_type').notNull(),        // e.g., 'goal.created', 'task.completed'
  entityId: uuid('entity_id').notNull(),           // UUID of the entity that changed
  entityType: text('entity_type').notNull(),       // 'goal', 'task', 'meeting', etc.
  payload: jsonb('payload').notNull(),             // Event-specific data
  published: boolean('published').notNull().default(false),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  lastError: text('last_error'),                   // Last error message if publish failed
}, (table) => [
  index('idx_outbox_published').on(table.published),
  index('idx_outbox_entity').on(table.entityType, table.entityId),
  index('idx_outbox_created').on(table.createdAt),
  index('idx_outbox_attempts').on(table.attempts),
]);
