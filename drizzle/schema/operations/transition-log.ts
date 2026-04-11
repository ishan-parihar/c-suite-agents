import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

export const transitionLog = pgTable('transition_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  reason: text('reason').notNull(),
  agentId: text('agent_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_transition_log_task').on(table.taskId),
  index('idx_transition_log_occurred').on(table.occurredAt),
]);
