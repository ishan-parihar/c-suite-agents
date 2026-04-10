import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const notesManagement = pgTable('notes_management', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataSourceId: uuid('data_source_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('New Note'),
  agent: text('agent'),
  agentSecondary: text('agent_secondary'),
  report: text('report'),
  reportExtra: text('report_extra'),
  projectId: uuid('project_id').references(() => projects.id),
  projectStatus: text('project_status'),
  knowledgeCategories: uuid('knowledge_categories').array(),
  createdTime: timestamp('created_time', { withTimezone: true }),
  lastEditedAt: timestamp('last_edited_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_notes_status').on(table.status),
  index('idx_notes_agent').on(table.agent),
  index('idx_notes_project_id').on(table.projectId),
  index('idx_notes_knowledge_categories').on(table.knowledgeCategories),
  index('idx_notes_created_time').on(table.createdTime),
]);
