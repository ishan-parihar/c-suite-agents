import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

export const years = pgTable('years', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  annualGoals: uuid('annual_goals').array(),
  quarters: uuid('quarters').array(),
  quarterlyGoals: uuid('quarterly_goals').array(),
  status: text('status'),
  yearRange: text('year_range'),
  yearReport: text('year_report'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_years_status').on(table.status),
  index('idx_years_annual_goals').on(table.annualGoals),
  index('idx_years_quarters').on(table.quarters),
  index('idx_years_quarterly_goals').on(table.quarterlyGoals),
]);
