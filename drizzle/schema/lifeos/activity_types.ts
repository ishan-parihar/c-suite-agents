import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const activityTypes = pgTable('activity_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  activityLog: uuid('activity_log').array(),
  frequency: text('frequency'),
  durationHrs: numeric('duration_hrs', { precision: 4, scale: 1 }),
  targetPerWeek: integer('target_per_week'),
  isHabit: boolean('is_habit'),
  isHealthTracked: boolean('is_health_tracked'),
  category: text('category'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_activity_types_category').on(table.category),
  index('idx_activity_types_frequency').on(table.frequency),
  index('idx_activity_types_activity_log').on(table.activityLog),
]);
