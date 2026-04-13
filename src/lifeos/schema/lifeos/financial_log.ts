import { pgTable, uuid, text, numeric, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { weeks } from './weeks';
import { months } from './months';
import { projects } from './projects';
import { financialAccounts } from './financial_accounts';

export const financialLog = pgTable('financial_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  transactionId: text('transaction_id').unique(),
  date: timestamp('date', { withTimezone: true }),
  signedAmount: numeric('signed_amount', { precision: 12, scale: 2 }),
  category: text('category'),
  capitalEngine: text('capital_engine'),
  isRecurring: boolean('is_recurring'),
  receiptFiles: jsonb('receipt_files'),
  receiptUrl: text('receipt_url'),
  notes: text('notes'),
  isFinancial: boolean('is_financial'),
  legacyAmount: text('legacy_amount'),
  financialElater: text('financial_elater'),
  transactionType: text('transaction_type'),
  financialJson: text('financial_json'),
  weekId: uuid('week_id').references(() => weeks.id),
  monthId: uuid('month_id').references(() => months.id),
  projectId: uuid('project_id').references(() => projects.id),
  accountId: uuid('account_id').references(() => financialAccounts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_financial_log_transaction_id').on(table.transactionId),
  index('idx_financial_log_date').on(table.date),
  index('idx_financial_log_category').on(table.category),
  index('idx_financial_log_capital_engine').on(table.capitalEngine),
  index('idx_financial_log_signed_amount').on(table.signedAmount),
  index('idx_financial_log_is_recurring').on(table.isRecurring),
  index('idx_financial_log_week_id').on(table.weekId),
  index('idx_financial_log_month_id').on(table.monthId),
  index('idx_financial_log_project_id').on(table.projectId),
  index('idx_financial_log_account_id').on(table.accountId),
  index('idx_financial_log_transaction_type').on(table.transactionType),
]);
