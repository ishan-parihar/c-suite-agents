import { pgTable, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { projects } from '../lifeos/projects';
import { opportunitiesStrengths } from '../lifeos/opportunities_strengths';

export const project_opportunities = pgTable('project_opportunities', {
  projectId: uuid('project_id')
    .references(() => projects.id)
    .notNull(),
  opportunityId: uuid('opportunity_id')
    .references(() => opportunitiesStrengths.id)
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.opportunityId], name: 'pk_project_opportunities' }),
]);
