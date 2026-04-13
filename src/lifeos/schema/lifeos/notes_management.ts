import { pgTable, uuid, text, timestamp, index, integer, boolean, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core';
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

  parentId: uuid('parent_id').references((): AnyPgColumn => notesManagement.id, { onDelete: 'set null' }),
  icon: text('icon'),
  coverImage: text('cover_image'),
  tags: text('tags').array(),
  content: jsonb('content'),
  ord: integer('ord').default(0),
  isFavorite: boolean('is_favorite').default(false),
  isArchived: boolean('is_archived').default(false),
}, (table) => [
  index('idx_notes_status').on(table.status),
  index('idx_notes_agent').on(table.agent),
  index('idx_notes_project_id').on(table.projectId),
  index('idx_notes_knowledge_categories').on(table.knowledgeCategories),
  index('idx_notes_created_time').on(table.createdTime),
  index('idx_notes_parent_id').on(table.parentId),
  index('idx_notes_is_archived').on(table.isArchived),
]);
