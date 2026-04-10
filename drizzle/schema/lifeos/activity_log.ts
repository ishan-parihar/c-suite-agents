import { pgTable, uuid, text, numeric, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { activityTypes } from './activity_types';
import { days } from './days';

export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  activityId: text('activity_id').unique(),
  activityTypeId: uuid('activity_type_id').references(() => activityTypes.id),
  daysId: uuid('days_id').references(() => days.id),
  projects: uuid('projects').array(),
  energy: text('energy'),
  moodDelta: text('mood_delta'),
  dateRange: timestamp('date_range', { withTimezone: true }),
  dateEnd: timestamp('date_end', { withTimezone: true }),
  durationHrs: numeric('duration_hrs', { precision: 4, scale: 2 }),
  activityType: text('activity_type'),
  activityNotes: text('activity_notes'),
  activityJson: text('activity_json'),
  isHabitActivity: boolean('is_habit_activity'),
  isLogged: boolean('is_logged'),
  notesBody: text('notes_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_activity_log_energy').on(table.energy),
  index('idx_activity_log_mood_delta').on(table.moodDelta),
  index('idx_activity_log_activity_type').on(table.activityType),
  index('idx_activity_log_activity_type_id').on(table.activityTypeId),
  index('idx_activity_log_days_id').on(table.daysId),
  index('idx_activity_log_projects').on(table.projects),
]);
