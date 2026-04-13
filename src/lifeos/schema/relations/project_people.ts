import { pgTable, uuid, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { projects } from '../lifeos/projects';
import { people } from '../lifeos/people';

export const project_people = pgTable('project_people', {
  projectId: uuid('project_id')
    .references(() => projects.id)
    .notNull(),
  peopleId: uuid('people_id')
    .references(() => people.id)
    .notNull(),
  role: text('role'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.peopleId], name: 'pk_project_people' }),
]);
