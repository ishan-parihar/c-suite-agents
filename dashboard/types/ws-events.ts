// ── Outbox Event Type Registry ───────────────────────────────────────────────
// All event types that flow through the outbox → WS pipeline.

export const OUTBOX_EVENTS = {
  // Tasks
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_COMPLETED: 'task.completed',
  TASK_TRANSITIONED: 'task.transitioned',
  TASK_ESCALATED: 'task.escalated',

  // Sessions
  SESSION_STARTED: 'session.started',
  SESSION_ENDED: 'session.ended',
  SESSION_MESSAGE: 'session.message',
  SESSION_TOOL_CALL: 'session.tool_call',

  // Messages
  MESSAGE_SENT: 'message.sent',
  MESSAGE_ESCALATED: 'message.escalated',

  // Kanban
  KANBAN_CARD_MOVED: 'kanban.card_moved',
  KANBAN_CARD_CREATED: 'kanban.card_created',

  // Meetings
  MEETING_STARTED: 'meeting.started',
  MEETING_ENDED: 'meeting.ended',
  MEETING_RESPONSE: 'meeting.response',

  // Agent
  AGENT_HEARTBEAT: 'agent.heartbeat',
  AGENT_STATUS_CHANGED: 'agent.status_changed',

  // Financial
  TRANSACTION_CREATED: 'transaction.created',

  // Content
  CONTENT_PUBLISHED: 'content.published',
} as const;

export type OutboxEventType = typeof OUTBOX_EVENTS[keyof typeof OUTBOX_EVENTS];

// ── Event Categories (for subscription filtering) ───────────────────────────

export const EVENT_CATEGORIES = {
  TASKS: ['task.*'],
  SESSIONS: ['session.*'],
  MESSAGES: ['message.*'],
  KANBAN: ['kanban.*'],
  MEETINGS: ['meeting.*'],
  AGENT: ['agent.*'],
  ALL: ['*'],
} as const;
