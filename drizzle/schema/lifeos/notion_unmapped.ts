import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

export const notionUnmapped = pgTable('notion_unmapped', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  databaseName: text('database_name').notNull(),
  notionId: text('notion_id').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_notion_unmapped_database').on(table.databaseName),
  index('idx_notion_unmapped_notion_id').on(table.notionId),
]);
