import {
  tasks,
  annualGoals,
  quarterlyGoals,
  projects,
  campaigns,
  people,
  kanbanCards,
  kanbanBoards,
  kanbanColumns,
  messageThreads,
  messages,
  boardMeetings,
  outboxEvents,
  opsReports,
  subjectiveJournal,
  relationalJournal,
  systemicJournal,
  financialLog,
  financialAccounts,
  contentPipeline,
  dietLog,
  notesManagement,
} from '@/drizzle/schema';

/**
 * Entity configuration for the generic CRUD handler.
 * Each entity maps to a Drizzle table with metadata for list/filter/sort operations.
 */
import { type EntityType } from '@/lib/agent-permissions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EntityConfig {
  /** The Drizzle table definition */
  table: any;
  /** The column used as the primary key (typically `id`) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  idColumn: any;
  /** Fields to include in list responses (first N columns for brevity) */
  listFields: string[];
  /** Fields that can be used in `?sort=` query parameter */
  sortableFields: string[];
  /** Fields that can be used in `?filter=<field>=<value>` query parameter */
  filterableFields: string[];
  /**
   * The agent-permission EntityType for authorization checks.
   * null = system entity (skip agent auth, e.g. outbox, ops-reports).
   */
  entityType: EntityType | null;
}

/**
 * Registry of all entities exposed via the generic CRUD API.
 * Keys are URL-safe slugs used in `/api/crud/{entity}`.
 */
export const entityRegistry: Record<string, EntityConfig> = {
  // ── LifeOS: Productivity ─────────────────────────────────────────────
  tasks: {
    table: tasks,
    idColumn: tasks.id,
    listFields: ['id', 'name', 'status', 'priority', 'assignee', 'action_date', 'created_at'],
    sortableFields: ['created_at', 'updated_at', 'action_date', 'priority', 'status', 'name'],
    filterableFields: ['status', 'priority', 'assignee', 'project_id', 'week_id', 'tags'],
    entityType: 'task',
  },

  // ── LifeOS: Strategic Goals ──────────────────────────────────────────
  'goals-annual': {
    table: annualGoals,
    idColumn: annualGoals.id,
    listFields: ['id', 'name', 'status', 'goal_archetype', 'goal_progress', 'created_at'],
    sortableFields: ['created_at', 'updated_at', 'status', 'name'],
    filterableFields: ['status', 'goal_archetype', 'is_current_goal', 'years_id'],
    entityType: 'goal',
  },

  'goals-quarterly': {
    table: quarterlyGoals,
    idColumn: quarterlyGoals.id,
    listFields: ['id', 'name', 'status', 'progress', 'health', 'created_at'],
    sortableFields: ['created_at', 'updated_at', 'status', 'progress', 'health'],
    filterableFields: ['status', 'is_current_goal', 'annual_goal_id', 'health'],
    entityType: 'goal',
  },

  projects: {
    table: projects,
    idColumn: projects.id,
    listFields: ['id', 'name', 'status', 'phase', 'priority', 'progress', 'deadline', 'created_at'],
    sortableFields: ['created_at', 'updated_at', 'status', 'priority', 'progress', 'deadline', 'name'],
    filterableFields: ['status', 'phase', 'priority', 'health', 'quarterly_goal_id', 'team'],
    entityType: 'project',
  },

  campaigns: {
    table: campaigns,
    idColumn: campaigns.id,
    listFields: ['id', 'name', 'status', 'start_date', 'end_date', 'theme', 'created_at'],
    sortableFields: ['created_at', 'updated_at', 'status', 'start_date', 'end_date', 'name'],
    filterableFields: ['status', 'theme', 'content_frequency', 'platforms'],
    entityType: 'campaign',
  },

  people: {
    table: people,
    idColumn: people.id,
    listFields: ['id', 'name', 'email', 'city', 'relationship_status', 'last_connected_date', 'created_at'],
    sortableFields: ['created_at', 'updated_at', 'name', 'last_connected_date', 'city'],
    filterableFields: ['relationship_status', 'city', 'timezone', 'community_id'],
    entityType: 'person',
  },

  // ── Operations: Kanban ───────────────────────────────────────────────
  'kanban-cards': {
    table: kanbanCards,
    idColumn: kanbanCards.id,
    listFields: ['id', 'title', 'priority', 'due', 'assignee_agent_id', 'created_at'],
    sortableFields: ['created_at', 'priority', 'due', 'title'],
    filterableFields: ['board_id', 'column_id', 'priority', 'assignee_agent_id', 'project_id'],
    entityType: 'kanban',
  },

  'kanban-boards': {
    table: kanbanBoards,
    idColumn: kanbanBoards.id,
    listFields: ['id', 'agent_id', 'name', 'created_at'],
    sortableFields: ['created_at', 'name', 'agent_id'],
    filterableFields: ['agent_id'],
    entityType: 'kanban',
  },

  'kanban-columns': {
    table: kanbanColumns,
    idColumn: kanbanColumns.id,
    listFields: ['id', 'board_id', 'name', 'ord', 'created_at'],
    sortableFields: ['ord', 'created_at', 'name'],
    filterableFields: ['board_id'],
    entityType: 'kanban',
  },

  // ── Operations: Messaging ────────────────────────────────────────────
  'message-threads': {
    table: messageThreads,
    idColumn: messageThreads.id,
    listFields: ['id', 'subject', 'status', 'summary', 'created_at', 'updated_at'],
    sortableFields: ['created_at', 'updated_at', 'status', 'subject'],
    filterableFields: ['status', 'tags'],
    entityType: 'message',
  },

  messages: {
    table: messages,
    idColumn: messages.id,
    listFields: ['id', 'thread_id', 'from_agent', 'to_agent', 'priority', 'read', 'created_at'],
    sortableFields: ['created_at', 'priority', 'read'],
    filterableFields: ['thread_id', 'from_agent', 'to_agent', 'priority', 'read', 'responded'],
    entityType: 'message',
  },

  // ── Operations: Board Meetings ───────────────────────────────────────
  meetings: {
    table: boardMeetings,
    idColumn: boardMeetings.id,
    listFields: ['id', 'date', 'status', 'objective', 'created_at'],
    sortableFields: ['created_at', 'date', 'status'],
    filterableFields: ['status', 'date'],
    entityType: 'meeting',
  },

  // ── Operations: Outbox ───────────────────────────────────────────────
  outbox: {
    table: outboxEvents,
    idColumn: outboxEvents.id,
    listFields: ['id', 'event_type', 'entity_type', 'entity_id', 'published', 'attempts', 'created_at'],
    sortableFields: ['created_at', 'published_at', 'attempts', 'event_type'],
    filterableFields: ['published', 'entity_type', 'event_type', 'attempts'],
    entityType: null,
  },

  // ── Operations: Reports ──────────────────────────────────────────────
  'ops-reports': {
    table: opsReports,
    idColumn: opsReports.id,
    listFields: ['id', 'agent_id', 'period', 'summary', 'created_at'],
    sortableFields: ['created_at', 'agent_id', 'period'],
    filterableFields: ['agent_id', 'period'],
    entityType: null,
  },

  // ── LifeOS: Journals ─────────────────────────────────────────────────
  'journal-subjective': {
    table: subjectiveJournal,
    idColumn: subjectiveJournal.id,
    listFields: ['id', 'date', 'mood', 'energy', 'created_at'],
    sortableFields: ['created_at', 'date', 'mood', 'energy'],
    filterableFields: ['date', 'mood'],
    entityType: 'journal',
  },

  'journal-relational': {
    table: relationalJournal,
    idColumn: relationalJournal.id,
    listFields: ['id', 'date', 'person_id', 'interaction_type', 'created_at'],
    sortableFields: ['created_at', 'date'],
    filterableFields: ['person_id', 'interaction_type', 'date'],
    entityType: 'journal',
  },

  'journal-systemic': {
    table: systemicJournal,
    idColumn: systemicJournal.id,
    listFields: ['id', 'date', 'domain', 'created_at'],
    sortableFields: ['created_at', 'date', 'domain'],
    filterableFields: ['date', 'domain'],
    entityType: 'journal',
  },

  // ── LifeOS: Financial ────────────────────────────────────────────────
  'financial-log': {
    table: financialLog,
    idColumn: financialLog.id,
    listFields: ['id', 'amount', 'category', 'type', 'date', 'created_at'],
    sortableFields: ['created_at', 'date', 'amount', 'category', 'type'],
    filterableFields: ['category', 'type', 'date', 'account_id'],
    entityType: 'financial',
  },

  'financial-accounts': {
    table: financialAccounts,
    idColumn: financialAccounts.id,
    listFields: ['id', 'name', 'type', 'balance', 'created_at'],
    sortableFields: ['created_at', 'name', 'type', 'balance'],
    filterableFields: ['type'],
    entityType: 'financial',
  },

  // ── LifeOS: Diet Journal ───────────────────────────────────────────────
  'journal-diet': {
    table: dietLog,
    idColumn: dietLog.id,
    listFields: ['id', 'date', 'name', 'mealType', 'calories', 'mood', 'created_at'],
    sortableFields: ['created_at', 'date', 'mood', 'mealType'],
    filterableFields: ['date', 'mood', 'mealType'],
    entityType: 'journal',
  },

  // ── LifeOS: Content Pipeline ─────────────────────────────────────────
  'content-pipeline': {
    table: contentPipeline,
    idColumn: contentPipeline.id,
    listFields: ['id', 'title', 'status', 'content_type', 'publish_date', 'created_at'],
    sortableFields: ['created_at', 'updated_at', 'publish_date', 'status', 'title'],
    filterableFields: ['status', 'content_type', 'campaign_id', 'platform'],
    entityType: 'content',
  },

  // ── LifeOS: Notes ────────────────────────────────────────────────────
  notes: {
    table: notesManagement,
    idColumn: notesManagement.id,
    listFields: ['id', 'name', 'status', 'parent_id', 'icon', 'is_favorite', 'ord', 'created_at'],
    sortableFields: ['created_at', 'updated_at', 'name', 'ord', 'status'],
    filterableFields: ['status', 'parent_id', 'is_favorite', 'is_archived', 'agent', 'tags', 'project_id'],
    entityType: 'note',
  },
};

/**
 * Type-level mapping from entity slug to its table type.
 * Usage: `EntityTable<'tasks'>` returns the type of the `tasks` table.
 */
export type EntityTable<T extends keyof typeof entityRegistry> =
  (typeof entityRegistry)[T]['table'];

/**
 * All valid entity slugs.
 */
export type EntitySlug = keyof typeof entityRegistry;

/**
 * Get the entity config for a slug, or undefined if not found.
 */
export function getEntityConfig(slug: string): EntityConfig | undefined {
  return entityRegistry[slug];
}

/**
 * Check if a slug is a valid entity.
 */
export function isValidEntity(slug: string): slug is EntitySlug {
  return slug in entityRegistry;
}
