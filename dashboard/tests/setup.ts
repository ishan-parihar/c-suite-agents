/**
 * Test setup — global utilities for integration tests.
 *
 * Provides database helpers (truncate, seed), mock factories,
 * and automatic cleanup via beforeEach/afterEach hooks.
 */

/// <reference types="vitest/globals" />

import { afterEach, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { tasks } from '@/drizzle/schema/lifeos/tasks';
import { outboxEvents } from '@/drizzle/schema/operations/outbox';
import { kanbanCardActivity } from '@/drizzle/schema/operations/kanban';
import { kanbanCards, kanbanColumns, kanbanBoards } from '@/drizzle/schema/operations/kanban';

// ── Database helpers ────────────────────────────────────────────────────────

/**
 * Delete rows from tables in reverse FK order to avoid deadlocks.
 * Uses DELETE instead of TRUNCATE to prevent exclusive lock conflicts
 * when tests run in parallel.
 */
export async function cleanTestTables(): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE "transition_log", "outbox_events", "kanban_card_activity", "kanban_cards", "kanban_columns", "kanban_boards", "tasks" RESTART IDENTITY CASCADE`));
}

// ── Factory functions ───────────────────────────────────────────────────────

export function testUuid(): string {
  return crypto.randomUUID();
}

export interface TaskInput {
  id?: string;
  name?: string;
  status?: string;
  dataSourceId?: string;
  monitor?: string;
  updatedAt?: Date;
}

export async function createTask(input: TaskInput = {}): Promise<typeof tasks.$inferSelect> {
  const id = input.id ?? testUuid();
  const rows = await db
    .insert(tasks)
    .values({
      id,
      name: input.name ?? `Test Task ${id.slice(0, 8)}`,
      status: input.status ?? 'active',
      dataSourceId: input.dataSourceId ?? testUuid(),
      monitor: input.monitor ?? null,
      updatedAt: input.updatedAt ?? new Date(),
    })
    .returning() as typeof tasks.$inferSelect[];
  return rows[0];
}

export interface OutboxInput {
  id?: string;
  eventType?: string;
  entityId?: string;
  entityType?: string;
  payload?: Record<string, unknown>;
  published?: boolean;
  attempts?: number;
}

export async function createOutboxEvent(input: OutboxInput = {}): Promise<typeof outboxEvents.$inferSelect> {
  const id = input.id ?? testUuid();
  const rows = await db
    .insert(outboxEvents)
    .values({
      id,
      eventType: input.eventType ?? 'task.created',
      entityId: input.entityId ?? testUuid(),
      entityType: input.entityType ?? 'task',
      payload: input.payload ?? { test: true },
      published: input.published ?? false,
      attempts: input.attempts ?? 0,
    })
    .returning() as typeof outboxEvents.$inferSelect[];
  return rows[0];
}

export interface KanbanBoardInput {
  id?: string;
  agentId?: string;
  name?: string;
}

export async function createKanbanBoard(input: KanbanBoardInput = {}): Promise<typeof kanbanBoards.$inferSelect> {
  const id = input.id ?? testUuid();
  const rows = await db
    .insert(kanbanBoards)
    .values({
      id,
      agentId: input.agentId ?? 'test-agent',
      name: input.name ?? `Test Board ${id.slice(0, 8)}`,
    })
    .returning() as typeof kanbanBoards.$inferSelect[];
  return rows[0];
}

export interface KanbanColumnInput {
  id?: string;
  boardId: string;
  name?: string;
  ord?: number;
}

export async function createKanbanColumn(input: KanbanColumnInput): Promise<typeof kanbanColumns.$inferSelect> {
  const id = input.id ?? testUuid();
  const rows = await db
    .insert(kanbanColumns)
    .values({
      id,
      boardId: input.boardId,
      name: input.name ?? 'Test Column',
      ord: input.ord ?? 0,
    })
    .returning() as typeof kanbanColumns.$inferSelect[];
  return rows[0];
}

export interface KanbanCardInput {
  id?: string;
  boardId: string;
  columnId: string;
  title?: string;
}

export async function createKanbanCard(input: KanbanCardInput): Promise<typeof kanbanCards.$inferSelect> {
  const id = input.id ?? testUuid();
  const rows = await db
    .insert(kanbanCards)
    .values({
      id,
      boardId: input.boardId,
      columnId: input.columnId,
      title: input.title ?? `Test Card ${id.slice(0, 8)}`,
    })
    .returning() as typeof kanbanCards.$inferSelect[];
  return rows[0];
}

export interface KanbanActivityInput {
  cardId: string;
  ts?: Date;
  action: string;
  payload?: Record<string, unknown>;
}

export async function createKanbanActivity(input: KanbanActivityInput): Promise<typeof kanbanCardActivity.$inferSelect> {
  const id = testUuid();
  const rows = await db
    .insert(kanbanCardActivity)
    .values({
      id,
      cardId: input.cardId,
      ts: input.ts ?? new Date(),
      action: input.action,
      payload: input.payload ?? {},
    })
    .returning() as typeof kanbanCardActivity.$inferSelect[];
  return rows[0];
}

// ── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Mock the MessageBus module (used by scheduler for agent notifications).
 */
export function mockMessageBus() {
  const mockBus = {
    publish: vi.fn().mockReturnValue(true),
    isConnected: vi.fn().mockReturnValue(true),
  };

  vi.doMock('../../src/transport/message-bus', () => ({
    getMessageBus: () => mockBus,
  }));

  return mockBus;
}

/**
 * Mock the WebSocket gateway module.
 */
export function mockWsGateway() {
  const mockGateway = {
    broadcastOutboxEvent: vi.fn(),
    publish: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
  };

  vi.doMock('../../src/transport/ws-server', () => ({
    getWsGateway: () => mockGateway,
  }));

  return mockGateway;
}

/**
 * Mock the Telegram bot module.
 */
export function mockTelegramBot() {
  const mockBot = {
    telegram: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };

  vi.doMock('../../src/integrations/telegram', () => ({
    getTelegramBot: () => mockBot,
  }));

  return mockBot;
}

// ── Global hooks ─────────────────────────────────────────────────────────────

beforeEach(async () => {
  await cleanTestTables();
});

afterEach(async () => {
  await cleanTestTables();
  vi.restoreAllMocks();
  vi.resetModules();
});
