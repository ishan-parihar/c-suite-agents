import { pgTable, uuid, text, numeric, timestamp, index, jsonb } from 'drizzle-orm/pg-core';
import { days } from './days';

export const subjectiveJournal = pgTable('subjective_journal', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  entryId: text('entry_id').unique(),
  date: timestamp('date', { withTimezone: true }),
  daysId: uuid('days_id').references(() => days.id),
  sleepHours: numeric('sleep_hours', { precision: 4, scale: 1 }),
  stressLevel: text('stress_level'),
  energyLevel: text('energy_level'),
  moodTrigger: text('mood_trigger').array(),
  psychograph: text('psychograph'),
  subjectiveJson: text('subjective_json'),
  content: jsonb('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_subjective_journal_date').on(table.date),
  index('idx_subjective_journal_days_id').on(table.daysId),
  index('idx_subjective_journal_stress_level').on(table.stressLevel),
  index('idx_subjective_journal_energy_level').on(table.energyLevel),
  index('idx_subjective_journal_mood_trigger').on(table.moodTrigger),
]);
