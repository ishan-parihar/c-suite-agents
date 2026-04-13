import { pgTable, uuid, text, timestamp, index, jsonb } from 'drizzle-orm/pg-core';
import { days } from './days';

export const systemicJournal = pgTable('systemic_journal', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  entryId: text('entry_id').unique(),
  date: timestamp('date', { withTimezone: true }),
  createdTime: timestamp('created_time', { withTimezone: true }),
  daysId: uuid('days_id').references(() => days.id),
  impact: text('impact'),
  projects: uuid('projects').array(),
  directivesRiskLog: uuid('directives_risk_log').array(),
  opportunitiesStrengths: uuid('opportunities_strengths').array(),
  aiGeneratedReport: text('ai_generated_report'),
  systemicJson: text('systemic_json'),
  content: jsonb('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_systemic_journal_date').on(table.date),
  index('idx_systemic_journal_created_time').on(table.createdTime),
  index('idx_systemic_journal_days_id').on(table.daysId),
  index('idx_systemic_journal_impact').on(table.impact),
  index('idx_systemic_journal_projects').on(table.projects),
  index('idx_systemic_journal_directives_risk_log').on(table.directivesRiskLog),
  index('idx_systemic_journal_opportunities_strengths').on(table.opportunitiesStrengths),
]);
