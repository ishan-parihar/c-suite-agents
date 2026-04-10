import { pgTable, uuid, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { contentPipeline } from '../lifeos/content_pipeline';

export const content_platforms = pgTable('content_platforms', {
  contentId: uuid('content_id')
    .references(() => contentPipeline.id)
    .notNull(),
  platform: text('platform').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.contentId, table.platform], name: 'pk_content_platforms' }),
]);
