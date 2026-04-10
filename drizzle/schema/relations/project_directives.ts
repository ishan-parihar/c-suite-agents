import { pgTable, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { projects } from '../lifeos/projects';
import { directivesRiskLog } from '../lifeos/directives_risk_log';

export const project_directives = pgTable('project_directives', {
  projectId: uuid('project_id')
    .references(() => projects.id)
    .notNull(),
  directiveId: uuid('directive_id')
    .references(() => directivesRiskLog.id)
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.directiveId], name: 'pk_project_directives' }),
]);
