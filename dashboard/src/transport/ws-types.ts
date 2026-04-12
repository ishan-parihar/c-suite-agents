// ── WebSocket Message Types ──────────────────────────────────────────────────

export type WsMessageType =
  | 'event'        // Server → Client: outbox event broadcast
  | 'ping'         // Server → Client: heartbeat ping
  | 'pong'         // Client → Server: heartbeat pong
  | 'subscribe'    // Client → Server: subscribe to event types
  | 'unsubscribe'  // Client → Server: unsubscribe from event types
  | 'auth'         // Client → Server: authenticate connection
  | 'auth_ok'      // Server → Client: auth successful
  | 'auth_fail'    // Server → Client: auth failed
  | 'chat_message'  // Client → Server: send chat message
  | 'chat_stream'   // Server → Client: streaming chat response
  | 'session_update' // Server → Client: session state change
  | 'notification'  // Server → Client: user notification
  | 'error';        // Server → Client: error message

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  payload?: T;
  timestamp: number;
  id?: string;
}

export interface WsEventPayload {
  eventType: string;      // e.g., 'task.created', 'session.ended'
  entityId: string;
  entityType: string;
  payload: Record<string, unknown>;
}

export interface WsAuthPayload {
  token?: string;         // HMAC auth token
  agentId?: string;       // Agent identity header
  cookie?: string;        // Dashboard cookie for browser clients
}

export interface WsSubscribePayload {
  eventTypes: string[];   // Event types to subscribe to (empty = all)
  agentIds?: string[];    // Filter by specific agents
}

export interface WsChatMessagePayload {
  threadId: string;
  content: string;
  agentId?: string;       // Sender agent ID
  mentions?: string[];    // @mentioned agent IDs
}

export interface WsNotificationPayload {
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  action?: {
    label: string;
    href: string;
  };
}

// ── Client State ─────────────────────────────────────────────────────────────

export interface WsClientInfo {
  id: string;
  agentId?: string;
  isAuthenticated: boolean;
  subscriptions: Set<string>;  // Event types
  connectedAt: Date;
  lastPong: Date;
}
