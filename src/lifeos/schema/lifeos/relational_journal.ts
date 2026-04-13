import { pgTable, uuid, text, boolean, timestamp, index, jsonb } from 'drizzle-orm/pg-core';
import { days } from './days';
import { people } from './people';

export const relationalJournal = pgTable('relational_journal', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  entryId: text('entry_id').unique(),
  date: timestamp('date', { withTimezone: true }),
  daysId: uuid('days_id').references(() => days.id),
  peopleId: uuid('people_id').references(() => people.id),
  interactionType: text('interaction_type'),
  sentiment: text('sentiment'),
  followUpNeeded: boolean('follow_up_needed'),
  relationshipStatus: text('relationship_status').array(),
  relationalJson: text('relational_json'),
  content: jsonb('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_relational_journal_date').on(table.date),
  index('idx_relational_journal_days_id').on(table.daysId),
  index('idx_relational_journal_people_id').on(table.peopleId),
  index('idx_relational_journal_interaction_type').on(table.interactionType),
  index('idx_relational_journal_sentiment').on(table.sentiment),
  index('idx_relational_journal_relationship_status').on(table.relationshipStatus),
]);
