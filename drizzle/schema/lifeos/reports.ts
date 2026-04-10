import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  reportId: text('report_id').unique(),
  agent: text('agent'),
  reportType: text('report_type'),
  periodCovered: timestamp('period_covered', { withTimezone: true }),
  report: text('report'),
  createdTime: timestamp('created_time', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_reports_report_id').on(table.reportId),
  index('idx_reports_agent').on(table.agent),
  index('idx_reports_report_type').on(table.reportType),
  index('idx_reports_period_covered').on(table.periodCovered),
]);
