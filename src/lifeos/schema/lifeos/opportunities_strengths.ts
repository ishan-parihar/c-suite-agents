import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { quarterlyGoals } from './quarterly_goals';

export const opportunitiesStrengths = pgTable('opportunities_strengths', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  logType: text('log_type'),
  status: text('status').notNull().default('💡 Identified'),
  leverageScore: text('leverage_score'),
  opportunityType: text('opportunity_type'),
  description: text('description'),
  lastAssessed: timestamp('last_assessed', { withTimezone: true }),
  activationDate: timestamp('activation_date', { withTimezone: true }),
  projects: uuid('projects').array(),
  quarterlyGoalId: uuid('quarterly_goal_id').references(() => quarterlyGoals.id),
  systemicJournal: uuid('systemic_journal').array(),
  synergizesWith: uuid('synergizes_with').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_os_log_type').on(table.logType),
  index('idx_os_status').on(table.status),
  index('idx_os_leverage_score').on(table.leverageScore),
  index('idx_os_opportunity_type').on(table.opportunityType),
  index('idx_os_last_assessed').on(table.lastAssessed),
  index('idx_os_activation_date').on(table.activationDate),
  index('idx_os_quarterly_goal_id').on(table.quarterlyGoalId),
  index('idx_os_projects').on(table.projects),
  index('idx_os_systemic_journal').on(table.systemicJournal),
  index('idx_os_synergizes_with').on(table.synergizesWith),
]);
