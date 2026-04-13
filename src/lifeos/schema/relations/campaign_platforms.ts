import { pgTable, uuid, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { campaigns } from '../lifeos/campaigns';

export const campaign_platforms = pgTable('campaign_platforms', {
  campaignId: uuid('campaign_id')
    .references(() => campaigns.id)
    .notNull(),
  platform: text('platform').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.campaignId, table.platform], name: 'pk_campaign_platforms' }),
]);
