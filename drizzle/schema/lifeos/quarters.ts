import { pgTable, uuid, text, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { years } from './years';

export const quarters = pgTable('quarters', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  yearsId: uuid('years_id').references(() => years.id),
  months: uuid('months').array(),
  quarterlyGoals: uuid('quarterly_goals').array(),
  quarterNumber: integer('quarter_number'),
  quarterStart: timestamp('quarter_start', { withTimezone: true }),
  quarterEnd: timestamp('quarter_end', { withTimezone: true }),
  quarterRange: text('quarter_range'),
  quarterName: text('quarter_name'),
  quarterReport: text('quarter_report'),
  status: text('status'),
  totalIncome: numeric('total_income', { precision: 12, scale: 2 }),
  totalExpenses: numeric('total_expenses', { precision: 12, scale: 2 }),
  netCashflow: numeric('net_cashflow', { precision: 12, scale: 2 }),
  categorySummary: text('category_summary'),
  keyLearnings: text('key_learnings'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_quarters_status').on(table.status),
  index('idx_quarters_years_id').on(table.yearsId),
  index('idx_quarters_quarter_number').on(table.quarterNumber),
  index('idx_quarters_quarter_start').on(table.quarterStart),
  index('idx_quarters_quarter_end').on(table.quarterEnd),
  index('idx_quarters_months').on(table.months),
  index('idx_quarters_quarterly_goals').on(table.quarterlyGoals),
]);
