// Operational domain schema re-exports

// Kanban (5 tables)
export {
  kanbanBoards,
  kanbanColumns,
  kanbanCards,
  kanbanCardActivity,
  kanbanReportingLines,
} from './kanban';

// Messaging (3 tables)
export {
  messageThreads,
  messages,
  messageEscalations,
} from './messaging';

// Board Meetings (3 tables)
export {
  boardMeetings,
  boardMeetingTurns,
  boardMeetingResponses,
} from './boardMeetings';

// Agent Sessions (3 tables)
export {
  agentSessions,
  sessionMessages,
  sessionToolCalls,
} from './agentSessions';

// Outbox Events (Transactional Outbox Pattern)
export {
  outboxEvents,
} from './outbox';

// Reports (5 tables)
export {
  opsReports,
  opsSessions,
  sessionSteps,
  toolCorrelations,
  ocSessions,
} from './reports';
