import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { projects } from '../lifeos/projects';

// ── Kanban Boards ──────────────────────────────────────────────────────────

export const kanbanBoards = pgTable('kanban_boards', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: text('agent_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Kanban Columns ─────────────────────────────────────────────────────────

export const kanbanColumns = pgTable('kanban_columns', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id')
    .references(() => kanbanBoards.id)
    .notNull(),
  name: text('name').notNull(),
  ord: integer('ord').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Kanban Cards ───────────────────────────────────────────────────────────

export const kanbanCards = pgTable('kanban_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id')
    .references(() => kanbanBoards.id)
    .notNull(),
  columnId: uuid('column_id')
    .references(() => kanbanColumns.id)
    .notNull(),
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority'),
  due: timestamp('due', { withTimezone: true }),
  tags: jsonb('tags'),
  assigneeAgentId: text('assignee_agent_id'),
  projectId: uuid('project_id').references(() => projects.id),
  lastUpdate: timestamp('last_update', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Kanban Card Activity ───────────────────────────────────────────────────

export const kanbanCardActivity = pgTable('kanban_card_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id')
    .references(() => kanbanCards.id)
    .notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  action: text('action').notNull(),
  payload: jsonb('payload'),
});

// ── Kanban Reporting Lines ─────────────────────────────────────────────────

export const kanbanReportingLines = pgTable('kanban_reporting_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  managerId: text('manager_id').notNull(),
  reportId: text('report_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
