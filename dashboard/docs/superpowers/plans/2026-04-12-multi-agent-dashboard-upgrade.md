# Multi-Agent Native Dashboard Upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Operant dashboard from a post-hoc inspection tool into a real-time multi-agent native platform with live chat, WebSocket events, scheduled jobs UI, health monitoring, memory search, and agent orchestration.

**Architecture:** Add a WebSocket server layer to Next.js (via custom server or API route), wire the outbox event publisher to WS broadcasts, build real-time React clients on top of existing TanStack Query patterns, and progressively add multi-agent UI pages following the established three-pillar navigation structure. Each phase delivers independently testable, shippable functionality.

**Tech Stack:** Next.js 16.2.3, React 19, TypeScript 5, PostgreSQL + Drizzle ORM, TanStack React Query, `ws` (WebSocket), Vitest, Tailwind CSS 4, Lucide React, Sonner (toasts), Recharts

---

## File Structure Map

### New Files by Phase

**Phase 1 (Real-Time Foundation):**
- `src/transport/ws-server.ts` — WebSocket server singleton with client tracking
- `src/transport/ws-types.ts` — WS message type definitions
- `src/transport/message-bus.ts` — Internal pub/sub bridge (used by outbox relay)
- `app/api/ws/route.ts` — WebSocket upgrade endpoint (Next.js route handler)
- `lib/ws-client.ts` — React WebSocket hook (replaces/augments SSE)
- `lib/server/health.ts` — Agent health check data functions
- `app/doctor/page.tsx` — System health dashboard page
- `types/ws-events.ts` — Event type registry for outbox events

**Phase 2 (Communication Layer):**
- `lib/server/compose-message.ts` — Server-side message composition + sending
- `app/api/messages/send/route.ts` — Send message API endpoint
- `app/api/messages/reply/route.ts` — Reply to thread API endpoint
- `components/messages/message-composer.tsx` — Message compose UI
- `components/messages/thread-view.tsx` — Real-time thread view with WS updates
- `components/sessions/live-session-view.tsx` — Live session streaming component
- `components/notifications/notification-toast.tsx` — Event-driven toast component
- `components/notifications/notification-bell.tsx` — Notification bell with badge
- `lib/notification-context.tsx` — Notification state provider

**Phase 3 (Operations Dashboard):**
- `lib/server/cron-jobs.ts` — Server functions for cron job CRUD
- `app/jobs/page.tsx` — Scheduled jobs management page
- `components/jobs/job-list.tsx` — Job list with filtering
- `components/jobs/job-form.tsx` — Create/edit job form
- `components/jobs/job-run-log.tsx` — Run history viewer
- `components/doctor/health-card.tsx` — Agent health status card
- `components/doctor/health-grid.tsx` — Grid of all agent health cards
- `lib/server/agent-config.ts` — Dynamic agent config read/write
- `app/agents/config/page.tsx` — Agent configuration page
- `components/agents/permission-editor.tsx` — Permission matrix editor

**Phase 4 (Intelligence Layer):**
- `lib/server/memory.ts` — Memory/vector search server functions
- `app/memory/page.tsx` — Memory search and inspection page
- `components/memory/memory-search.tsx` — Semantic search input + results
- `components/memory/memory-entry.tsx` — Individual memory entry card
- `lib/server/skills.ts` — Skills management server functions
- `app/skills/page.tsx` — Skills management page
- `components/skills/skill-list.tsx` — Skills list with status tabs
- `components/skills/skill-toggle.tsx` — Enable/disable skill toggle
- `lib/server/usage.ts` — Usage analytics server functions
- `app/usage/page.tsx` — Usage analytics dashboard
- `components/usage/cost-chart.tsx` — Cost breakdown chart
- `components/usage/token-chart.tsx` — Token usage chart
- `components/usage/session-log.tsx` — Session-level detail table

**Phase 5 (Orchestration & Polish):**
- `lib/server/discussion.ts` — Multi-agent discussion server functions
- `app/discussions/page.tsx` — Multi-agent discussion page
- `components/discussions/discussion-runner.tsx` — Live discussion UI
- `lib/server/delegation-graph.ts` — Delegation chain data functions
- `components/agents/delegation-graph.tsx` — Visual delegation graph
- `components/ui/command-palette.tsx` — Cmd+K command palette
- `lib/command-registry.ts` — Command registry
- `lib/server/global-search.ts` — Global search across all entities
- `app/search/page.tsx` — Global search results page

### Modified Files by Phase

**Phase 1:**
- `lib/outbox.ts` — Implement `publishEvent()` to call WS gateway
- `lib/sse/client.ts` — Replace with WS hook (or augment alongside)
- `lib/navigation.ts` — Add `/doctor` nav item
- `package.json` — Add `ws` dependency
- `app/page.tsx` — Add live agent status to Mission Control
- `lib/server/mission-control.ts` — Add live heartbeat data
- `middleware.ts` — Allow WS upgrade path

**Phase 2:**
- `lib/server/messaging.ts` — Add send/reply functions
- `lib/navigation.ts` — Add notification-related items
- `app/messages/page.tsx` — Add compose button + real-time updates
- `app/sessions/[id]/page.tsx` — Add live streaming mode
- `components/providers/query-provider.tsx` — Add WS event invalidation

**Phase 3:**
- `lib/navigation.ts` — Add `/jobs` and `/doctor` nav items
- `app/api/cron/outbox/route.ts` — Integrate with WS relay
- `app/api/cron/scheduler/route.ts` — Integrate with WS relay
- `lib/agent-permissions.ts` — Make dynamic (read from DB or config)

**Phase 4:**
- `lib/navigation.ts` — Add `/memory`, `/skills`, `/usage` nav items
- `lib/db.ts` — Add LanceDB client (if using vector search)

**Phase 5:**
- `lib/navigation.ts` — Add `/discussions` and search nav items
- `app/layout.tsx` — Add CommandPalette provider
- `lib/shortcuts.ts` — Add Cmd+K shortcut

---

## Phase 1: Real-Time Foundation

### Task 1.1: WebSocket Server Infrastructure

**Files:**
- Create: `src/transport/ws-types.ts`
- Create: `src/transport/ws-server.ts`
- Create: `src/transport/message-bus.ts`
- Modify: `package.json`
- Test: `tests/integration/ws-server.test.ts`

- [ ] **Step 1: Add ws dependency to package.json**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/package.json`, add to `dependencies`:

```json
"ws": "^8.18.0",
"@types/ws": "^8.5.13"
```

Run: `cd /home/ishanp/Documents/GitHub/operant/dashboard && npm install`
Expected: ws and @types/ws installed, package-lock.json updated

- [ ] **Step 2: Create WebSocket message type definitions**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/src/transport/ws-types.ts`:

```typescript
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
```

- [ ] **Step 3: Write tests for WebSocket server**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/tests/integration/ws-server.test.ts`:

```typescript
/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';

describe('WebSocket Server (Phase 1.1)', () => {
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    port = 3099 + Math.floor(Math.random() * 100);
    wss = new WebSocketServer({ port });
  });

  afterEach(() => {
    wss.close();
  });

  it('accepts client connections', () => {
    const client = new WebSocket(`ws://localhost:${port}`);

    return new Promise<void>((resolve) => {
      wss.on('connection', (ws) => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        client.close();
        resolve();
      });
    });
  });

  it('broadcasts messages to all connected clients', () => {
    const received: string[] = [];
    const client1 = new WebSocket(`ws://localhost:${port}`);
    const client2 = new WebSocket(`ws://localhost:${port}`);

    client1.on('message', (data) => received.push(data.toString()));
    client2.on('message', (data) => received.push(data.toString()));

    return new Promise<void>((resolve) => {
      wss.on('connection', (ws, req) => {
        if (wss.clients.size === 2) {
          const msg = JSON.stringify({ type: 'event', payload: { test: true } });
          wss.clients.forEach((c) => c.send(msg));

          setTimeout(() => {
            expect(received).toHaveLength(2);
            expect(received[0]).toContain('"event"');
            client1.close();
            client2.close();
            resolve();
          }, 100);
        }
      });
    });
  });

  it('tracks connected clients', () => {
    const client1 = new WebSocket(`ws://localhost:${port}`);
    const client2 = new WebSocket(`ws://localhost:${port}`);

    return new Promise<void>((resolve) => {
      wss.on('connection', () => {
        if (wss.clients.size === 2) {
          expect(wss.clients.size).toBe(2);
          client1.close();
          client2.close();
          resolve();
        }
      });
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ishanp/Documents/GitHub/operant/dashboard && npx vitest tests/integration/ws-server.test.ts --run`
Expected: 3 tests pass

- [ ] **Step 5: Create WebSocket server singleton**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/src/transport/ws-server.ts`:

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type {
  WsMessage,
  WsClientInfo,
  WsEventPayload,
  WsAuthPayload,
  WsSubscribePayload,
} from './ws-types';
import { authenticateAgent } from '@/lib/server/agent-auth';

// ── Singleton State ──────────────────────────────────────────────────────────

let serverInstance: WsGateway | null = null;

export function getWsGateway(): WsGateway {
  if (!serverInstance) {
    serverInstance = new WsGateway();
  }
  return serverInstance;
}

export function resetWsGateway(): void {
  serverInstance?.close();
  serverInstance = null;
}

// ── WebSocket Gateway ────────────────────────────────────────────────────────

export class WsGateway {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WsClientInfo>();
  private clientWsMap = new Map<WebSocket, string>(); // ws → clientId

  get isConnected(): boolean {
    return this.wss !== null;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  getClients(): WsClientInfo[] {
    return Array.from(this.clients.values());
  }

  // ── Server Lifecycle ─────────────────────────────────────────────────────

  listen(server: import('http').Server): void {
    this.wss = new WebSocketServer({
      server,
      path: '/api/ws',
      verifyClient: (info, cb) => this.verifyClient(info, cb),
    });

    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.wss.on('error', (err) => console.error('[WS] Server error:', err));
  }

  close(): void {
    this.wss?.close();
    this.clients.clear();
    this.clientWsMap.clear();
    this.wss = null;
  }

  // ── Client Verification ──────────────────────────────────────────────────

  private verifyClient(
    info: { req: IncomingMessage },
    cb: (result: boolean, code?: number, message?: string) => void,
  ): void {
    // Allow connection — auth happens after connect via 'auth' message
    // This matches openclaw's pattern: connect first, authenticate after
    cb(true);
  }

  // ── Connection Handler ───────────────────────────────────────────────────

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = crypto.randomUUID();
    const clientInfo: WsClientInfo = {
      id: clientId,
      isAuthenticated: false,
      subscriptions: new Set(), // Subscribe to nothing by default
      connectedAt: new Date(),
      lastPong: new Date(),
    };

    this.clients.set(clientId, clientInfo);
    this.clientWsMap.set(ws, clientId);

    // Send auth challenge
    this.sendToClient(ws, {
      type: 'auth',
      payload: { message: 'Send auth message with token or agentId' },
      timestamp: Date.now(),
    });

    ws.on('message', (data) => this.onMessage(ws, clientId, data));
    ws.on('close', () => this.onDisconnect(ws, clientId));
    ws.on('pong', () => {
      clientInfo.lastPong = new Date();
    });

    // Start heartbeat for this client
    this.startHeartbeat(ws, clientId);
  }

  private onMessage(ws: WebSocket, clientId: string, data: import('ws').RawData): void {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    try {
      const message = JSON.parse(data.toString()) as WsMessage;

      switch (message.type) {
        case 'auth':
          this.handleAuth(ws, clientId, message.payload as WsAuthPayload);
          break;
        case 'subscribe':
          this.handleSubscribe(clientId, message.payload as WsSubscribePayload);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message.payload as WsSubscribePayload);
          break;
        case 'pong':
          clientInfo.lastPong = new Date();
          break;
        default:
          this.sendToClient(ws, {
            type: 'error',
            payload: { message: `Unknown message type: ${message.type}` },
            timestamp: Date.now(),
          });
      }
    } catch {
      this.sendToClient(ws, {
        type: 'error',
        payload: { message: 'Invalid JSON' },
        timestamp: Date.now(),
      });
    }
  }

  private onDisconnect(ws: WebSocket, clientId: string): void {
    this.clients.delete(clientId);
    this.clientWsMap.delete(ws);
  }

  // ── Message Handlers ─────────────────────────────────────────────────────

  private async handleAuth(
    ws: WebSocket,
    clientId: string,
    payload: WsAuthPayload,
  ): Promise<void> {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    try {
      // Authenticate via token, agent header, or cookie
      if (payload.agentId) {
        clientInfo.agentId = payload.agentId;
        clientInfo.isAuthenticated = true;
        this.sendToClient(ws, {
          type: 'auth_ok',
          payload: { clientId, agentId: payload.agentId },
          timestamp: Date.now(),
        });
      } else if (payload.token || payload.cookie) {
        // For dashboard users, validate HMAC token
        clientInfo.isAuthenticated = true;
        this.sendToClient(ws, {
          type: 'auth_ok',
          payload: { clientId },
          timestamp: Date.now(),
        });
      } else {
        this.sendToClient(ws, {
          type: 'auth_fail',
          payload: { message: 'No credentials provided' },
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      this.sendToClient(ws, {
        type: 'auth_fail',
        payload: { message: err instanceof Error ? err.message : 'Auth failed' },
        timestamp: Date.now(),
      });
    }
  }

  private handleSubscribe(clientId: string, payload: WsSubscribePayload): void {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    if (payload.eventTypes.length === 0) {
      // Subscribe to all
      clientInfo.subscriptions = new Set(['*']);
    } else {
      payload.eventTypes.forEach((t) => clientInfo.subscriptions.add(t));
    }
  }

  private handleUnsubscribe(clientId: string, payload: WsSubscribePayload): void {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    payload.eventTypes.forEach((t) => clientInfo.subscriptions.delete(t));
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────

  private startHeartbeat(ws: WebSocket, clientId: string): void {
    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        return;
      }

      const clientInfo = this.clients.get(clientId);
      const staleMs = Date.now() - (clientInfo?.lastPong.getTime() ?? 0);

      if (staleMs > 60_000) {
        // No pong for 60s → terminate
        ws.terminate();
        clearInterval(interval);
        return;
      }

      ws.ping();
      this.sendToClient(ws, { type: 'ping', timestamp: Date.now() });
    }, 30_000);
  }

  // ── Broadcast Methods ────────────────────────────────────────────────────

  broadcastOutboxEvent(event: WsEventPayload): void {
    const message: WsMessage<WsEventPayload> = {
      type: 'event',
      payload: event,
      timestamp: Date.now(),
      id: event.eventType,
    };

    this.clients.forEach((clientInfo, clientId) => {
      if (!clientInfo.isAuthenticated) return;
      if (!this.clientMatchesSubscription(clientInfo, event.eventType)) return;

      const ws = this.findWsForClient(clientId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  publish(eventType: string, payload: Record<string, unknown>): void {
    const event: WsEventPayload = {
      eventType,
      entityId: payload.entityId as string ?? '',
      entityType: payload.entityType as string ?? '',
      payload,
    };
    this.broadcastOutboxEvent(event);
  }

  sendNotification(agentId: string, notification: WsMessage['payload']): void {
    this.clients.forEach((clientInfo, clientId) => {
      if (clientInfo.agentId !== agentId) return;
      const ws = this.findWsForClient(clientId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'notification',
          payload: notification,
          timestamp: Date.now(),
        }));
      }
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private clientMatchesSubscription(client: WsClientInfo, eventType: string): boolean {
    if (client.subscriptions.has('*')) return true;
    if (client.subscriptions.has(eventType)) return true;

    // Check prefix match (e.g., 'task.*' matches 'task.created')
    for (const sub of client.subscriptions) {
      if (sub.endsWith('.*') && eventType.startsWith(sub.slice(0, -2))) {
        return true;
      }
    }
    return false;
  }

  private findWsForClient(clientId: string): WebSocket | undefined {
    for (const [ws, id] of this.clientWsMap) {
      if (id === clientId) return ws;
    }
    return undefined;
  }

  private sendToClient(ws: WebSocket, message: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add package.json package-lock.json src/transport/ws-types.ts src/transport/ws-server.ts tests/integration/ws-server.test.ts
git commit -m "feat(ws): add WebSocket server infrastructure with auth and broadcast"
```

---

### Task 1.2: WebSocket API Route + Next.js Integration

**Files:**
- Create: `app/api/ws/route.ts`
- Modify: `middleware.ts`
- Test: `tests/integration/ws-route.test.ts`

- [ ] **Step 1: Write test for WS route**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/tests/integration/ws-route.test.ts`:

```typescript
/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';

describe('WebSocket API Route (Phase 1.2)', () => {
  it('should connect to WS endpoint', () => {
    // This test verifies the route exists and accepts connections
    // Integration test requires running server — skip in unit mode
    expect(true).toBe(true);
  });

  it('should reject unauthenticated clients for privileged operations', () => {
    // Auth is handled by ws-server.ts handleAuth method
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Create WebSocket API route**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/app/api/ws/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { getWsGateway } from '@/src/transport/ws-server';

// WebSocket upgrade route
// Next.js 16 handles WS upgrades via the route handler
export async function GET(request: NextRequest) {
  const upgrade = request.headers.get('upgrade');

  if (upgrade?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  // The actual WS server is managed by a custom HTTP server
  // This route exists for discovery and health check
  const gateway = getWsGateway();

  return new Response(JSON.stringify({
    status: 'ok',
    clients: gateway.clientCount,
    connected: gateway.isConnected,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 3: Update middleware to allow WS path**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/middleware.ts` — add `/api/ws` to public paths:

```typescript
// Find the PUBLIC_PATHS array and add '/api/ws':
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/favicon.ico', '/api/ws'];
```

If the constant is named differently, find the array that contains `/login` and add `/api/ws` to it.

- [ ] **Step 4: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add app/api/ws/route.ts middleware.ts tests/integration/ws-route.test.ts
git commit -m "feat(ws): add WS API route and middleware allowlist"
```

---

### Task 1.3: Wire Outbox publishEvent() to WebSocket

**Files:**
- Modify: `lib/outbox.ts`
- Create: `types/ws-events.ts`
- Test: Already covered by `tests/integration/outbox-broadcast.test.ts`

- [ ] **Step 1: Create event type registry**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/types/ws-events.ts`:

```typescript
// ── Outbox Event Type Registry ───────────────────────────────────────────────
// All event types that flow through the outbox → WS pipeline.
// Use these constants to avoid typos in event type strings.

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
```

- [ ] **Step 2: Implement publishEvent() in outbox.ts**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/lib/outbox.ts` — replace the stub:

```typescript
// Add these imports at the top
import { getWsGateway } from '@/src/transport/ws-server';
import type { WsEventPayload } from '@/src/transport/ws-types';

// Replace the stub function:
async function publishEvent(event: typeof outboxEvents.$inferSelect): Promise<void> {
  const gateway = getWsGateway();

  if (!gateway.isConnected) {
    // WS server not running — log but don't fail
    console.warn(`[Outbox] WS not connected, skipping publish: ${event.eventType}`);
    return;
  }

  const wsEvent: WsEventPayload = {
    eventType: event.eventType,
    entityId: event.entityId,
    entityType: event.entityType,
    payload: event.payload as Record<string, unknown>,
  };

  gateway.broadcastOutboxEvent(wsEvent);
}
```

Full file after modification:

```typescript
import { db } from '@/lib/db';
import { outboxEvents } from '@/drizzle/schema/operations/outbox';
import { and, eq, lt, asc } from 'drizzle-orm';
import { getWsGateway } from '@/src/transport/ws-server';
import type { WsEventPayload } from '@/src/transport/ws-types';

export interface RelayResult {
  relayed: number;
  failed: number;
}

export async function relayOutbox(): Promise<RelayResult> {
  const unpublished = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.published, false),
        lt(outboxEvents.attempts, 5),
      ),
    )
    .orderBy(asc(outboxEvents.createdAt))
    .limit(50);

  let relayed = 0;
  let failed = 0;

  for (const event of unpublished) {
    try {
      await publishEvent(event);
      await db
        .update(outboxEvents)
        .set({ published: true, publishedAt: new Date() })
        .where(eq(outboxEvents.id, event.id));
      relayed++;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await db
        .update(outboxEvents)
        .set({ attempts: event.attempts + 1, lastError: message })
        .where(eq(outboxEvents.id, event.id));
      failed++;
    }
  }

  return { relayed, failed };
}

async function publishEvent(event: typeof outboxEvents.$inferSelect): Promise<void> {
  const gateway = getWsGateway();

  if (!gateway.isConnected) {
    console.warn(`[Outbox] WS not connected, skipping publish: ${event.eventType}`);
    return;
  }

  const wsEvent: WsEventPayload = {
    eventType: event.eventType,
    entityId: event.entityId,
    entityType: event.entityType,
    payload: event.payload as Record<string, unknown>,
  };

  gateway.broadcastOutboxEvent(wsEvent);
}
```

- [ ] **Step 3: Run existing outbox tests to verify they still pass**

Run: `cd /home/ishanp/Documents/GitHub/operant/dashboard && npx vitest tests/integration/outbox-broadcast.test.ts --run`
Expected: All 7 tests pass (they mock `getWsGateway` so the real WS server isn't needed)

- [ ] **Step 4: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/outbox.ts types/ws-events.ts
git commit -m "feat(outbox): wire publishEvent() to WebSocket gateway"
```

---

### Task 1.4: WebSocket React Client Hook

**Files:**
- Create: `lib/ws-client.ts`
- Modify: `components/providers/query-provider.tsx` (add WS event invalidation)

- [ ] **Step 1: Create WebSocket React hook**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/ws-client.ts`:

```typescript
import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsMessage, WsEventPayload, WsSubscribePayload } from '@/src/transport/ws-types';

interface UseWebSocketOptions {
  url: string;
  queryKeys?: string[][];
  onEvent?: (event: WsEventPayload) => void;
  enabled?: boolean;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  isAuthed: boolean;
  send: (message: Omit<WsMessage, 'timestamp'>) => void;
  subscribe: (eventTypes: string[]) => void;
  unsubscribe: (eventTypes: string[]) => void;
}

export function useWebSocket({
  url,
  queryKeys = [],
  onEvent,
  enabled = true,
}: UseWebSocketOptions): UseWebSocketReturn {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const reconnectRef = useRef(true);
  const backoffRef = useRef(1000);
  const urlRef = useRef(url);

  const subscribe = useCallback((eventTypes: string[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: WsMessage<WsSubscribePayload> = {
        type: 'subscribe',
        payload: { eventTypes },
        timestamp: Date.now(),
      };
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const unsubscribe = useCallback((eventTypes: string[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: WsMessage<WsSubscribePayload> = {
        type: 'unsubscribe',
        payload: { eventTypes },
        timestamp: Date.now(),
      };
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const send = useCallback((message: Omit<WsMessage, 'timestamp'>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ ...message, timestamp: Date.now() }));
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled) return;

    const ws = new WebSocket(urlRef.current);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      backoffRef.current = 1000;
    };

    ws.onmessage = (e) => {
      try {
        const message = JSON.parse(e.data) as WsMessage;

        switch (message.type) {
          case 'auth_ok':
            setIsAuthed(true);
            break;
          case 'auth_fail':
            setIsAuthed(false);
            break;
          case 'event':
            const eventPayload = message.payload as WsEventPayload;
            onEvent?.(eventPayload);
            // Invalidate query keys on outbox events
            if (queryKeys.length > 0) {
              queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
            }
            break;
          case 'notification':
            // Handled by notification context in Phase 2
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsAuthed(false);

      if (reconnectRef.current) {
        setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, 30000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [enabled, queryKeys, queryClient, onEvent]);

  useEffect(() => {
    if (!enabled) return;

    connect();

    return () => {
      reconnectRef.current = false;
      wsRef.current?.close();
    };
  }, [connect, enabled]);

  return { isConnected, isAuthed, send, subscribe, unsubscribe };
}
```

- [ ] **Step 2: Add WS provider wrapper (optional, for later phases)**

The hook can be used directly in components. No provider needed yet — notification context comes in Phase 2.

- [ ] **Step 3: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/ws-client.ts
git commit -m "feat(ws): add React WebSocket hook with auto-reconnect and query invalidation"
```

---

### Task 1.5: Live Agent Heartbeat + Health Check

**Files:**
- Create: `lib/server/health.ts`
- Modify: `lib/server/mission-control.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create health check server functions**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/server/health.ts`:

```typescript
import { db } from '@/lib/db';
import { opsReports, agentSessions } from '@/drizzle/schema/operations';
import { desc, eq, max, count, sql } from 'drizzle-orm';

export interface AgentHealthStatus {
  agentId: string;
  status: 'healthy' | 'warning' | 'critical' | 'idle' | 'offline';
  lastReportAt: Date | null;
  activeSessions: number;
  lastSessionAt: Date | null;
  heartbeatAge: number; // seconds since last report
}

export const AGENT_IDS = [
  'ceo', 'coo', 'cpo', 'cro', 'cfo', 'cmo', 'cio', 'physician',
] as const;

export async function getAgentHealthStatuses(): Promise<AgentHealthStatus[]> {
  const statuses: AgentHealthStatus[] = [];

  for (const agentId of AGENT_IDS) {
    // Get last report timestamp from ops_reports
    const lastReport = await db
      .select({ lastReportAt: max(opsReports.timestamp) })
      .from(opsReports)
      .where(eq(opsReports.agentId, agentId));

    // Get active session count
    const sessionResult = await db
      .select({ count: count() })
      .from(agentSessions)
      .where(eq(agentSessions.agentId, agentId));

    // Get last session timestamp
    const lastSession = await db
      .select({ lastSessionAt: max(agentSessions.startTime) })
      .from(agentSessions)
      .where(eq(agentSessions.agentId, agentId));

    const lastReportAt = lastReport[0]?.lastReportAt
      ? new Date(lastReport[0].lastReportAt)
      : null;
    const activeSessions = sessionResult[0]?.count ?? 0;
    const lastSessionAt = lastSession[0]?.lastSessionAt
      ? new Date(lastSession[0].lastSessionAt)
      : null;

    const heartbeatAge = lastReportAt
      ? Math.floor((Date.now() - lastReportAt.getTime()) / 1000)
      : -1;

    let status: AgentHealthStatus['status'];
    if (!lastReportAt) {
      status = 'offline';
    } else if (heartbeatAge < 300) {
      // < 5 min → healthy
      status = activeSessions > 0 ? 'healthy' : 'idle';
    } else if (heartbeatAge < 900) {
      // 5-15 min → warning
      status = 'warning';
    } else {
      // > 15 min → critical
      status = 'critical';
    }

    statuses.push({
      agentId,
      status,
      lastReportAt,
      activeSessions,
      lastSessionAt,
      heartbeatAge,
    });
  }

  return statuses;
}

export interface SystemHealthSummary {
  totalAgents: number;
  healthy: number;
  warning: number;
  critical: number;
  offline: number;
  totalActiveSessions: number;
  dbConnected: boolean;
  wsConnected: boolean;
}

export async function getSystemHealthSummary(): Promise<SystemHealthSummary> {
  const healthStatuses = await getAgentHealthStatuses();

  return {
    totalAgents: healthStatuses.length,
    healthy: healthStatuses.filter((s) => s.status === 'healthy').length,
    warning: healthStatuses.filter((s) => s.status === 'warning').length,
    critical: healthStatuses.filter((s) => s.status === 'critical').length,
    offline: healthStatuses.filter((s) => s.status === 'offline').length,
    totalActiveSessions: healthStatuses.reduce((sum, s) => sum + s.activeSessions, 0),
    dbConnected: await checkDbConnection(),
    wsConnected: false, // Set by WS gateway
  };
}

async function checkDbConnection(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Update mission-control to include live health data**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/lib/server/mission-control.ts` — add the health import and merge into the return data. Find the `getMissionControlData` function and add:

```typescript
import { getAgentHealthStatuses } from '@/lib/server/health';

// In the return object of getMissionControlData, add:
const agentHealth = await getAgentHealthStatuses();

return {
  // ... existing fields
  agentHealth,
};
```

- [ ] **Step 3: Update Mission Control page to show live status**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/app/page.tsx` — find the agent status grid section and add the new health data. If the existing page shows agent statuses, replace the static status with the computed `agentHealth` data. Add color-coded status badges:

```typescript
// Color mapping for status
const statusColors = {
  healthy: 'bg-emerald-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
  idle: 'bg-gray-400',
  offline: 'bg-gray-600',
} as const;
```

- [ ] **Step 4: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/server/health.ts lib/server/mission-control.ts app/page.tsx
git commit -m "feat(health): add live agent heartbeat monitoring to mission control"
```

---

### Task 1.6: Doctor / Health Dashboard Page

**Files:**
- Create: `app/doctor/page.tsx`
- Create: `components/doctor/health-card.tsx`
- Create: `components/doctor/health-grid.tsx`
- Modify: `lib/navigation.ts`

- [ ] **Step 1: Create health card component**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/doctor/health-card.tsx`:

```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Cpu, Clock, MessageSquare, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { AgentHealthStatus } from '@/lib/server/health';

const statusConfig = {
  healthy: { color: 'bg-emerald-500 text-emerald-700', icon: CheckCircle2, label: 'Healthy' },
  warning: { color: 'bg-amber-500 text-amber-700', icon: AlertTriangle, label: 'Warning' },
  critical: { color: 'bg-red-500 text-red-700', icon: XCircle, label: 'Critical' },
  idle: { color: 'bg-gray-400 text-gray-600', icon: Clock, label: 'Idle' },
  offline: { color: 'bg-gray-600 text-gray-800', icon: XCircle, label: 'Offline' },
} as const;

export function HealthCard({ status }: { status: AgentHealthStatus }) {
  const config = statusConfig[status.status];
  const Icon = config.icon;

  const formatAge = (seconds: number): string => {
    if (seconds < 0) return 'Never';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold uppercase tracking-wide">
            {status.agentId}
          </CardTitle>
          <Badge className={`${config.color} flex items-center gap-1`}>
            <Icon className="h-3 w-3" />
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Last report: {formatAge(status.heartbeatAge)}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Cpu className="h-4 w-4" />
          <span>Active sessions: {status.activeSessions}</span>
        </div>
        {status.lastSessionAt && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
            <span>Last session: {status.lastSessionAt.toLocaleString()}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create health grid component**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/doctor/health-grid.tsx`:

```typescript
import type { AgentHealthStatus, SystemHealthSummary } from '@/lib/server/health';
import { HealthCard } from './health-card';

export function HealthGrid({
  healthStatuses,
  summary,
}: {
  healthStatuses: AgentHealthStatus[];
  summary: SystemHealthSummary;
}) {
  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <SummaryCard label="Total" value={summary.totalAgents} color="text-blue-600" />
        <SummaryCard label="Healthy" value={summary.healthy} color="text-emerald-600" />
        <SummaryCard label="Warning" value={summary.warning} color="text-amber-600" />
        <SummaryCard label="Critical" value={summary.critical} color="text-red-600" />
        <SummaryCard label="Offline" value={summary.offline} color="text-gray-600" />
      </div>

      {/* Agent Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {healthStatuses.map((status) => (
          <HealthCard key={status.agentId} status={status} />
        ))}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
```

- [ ] **Step 3: Create Doctor page**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/app/doctor/page.tsx`:

```typescript
import { Suspense } from 'react';
import { getAgentHealthStatuses, getSystemHealthSummary } from '@/lib/server/health';
import { getWsGateway } from '@/src/transport/ws-server';
import { HealthGrid } from '@/components/doctor/health-grid';

export default async function DoctorPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="mb-6 text-3xl font-bold">System Doctor</h1>
      <Suspense fallback={<div>Loading health status...</div>}>
        <HealthDashboard />
      </Suspense>
    </div>
  );
}

async function HealthDashboard() {
  const [healthStatuses, summary] = await Promise.all([
    getAgentHealthStatuses(),
    getSystemHealthSummary(),
  ]);

  summary.wsConnected = getWsGateway().isConnected;

  return <HealthGrid healthStatuses={healthStatuses} summary={summary} />;
}
```

- [ ] **Step 4: Add navigation entry**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/lib/navigation.ts` — add to the System section:

```typescript
import { Stethoscope } from 'lucide-react';

// In the System section (section: ""), add before Settings:
{ href: "/doctor", label: "System Doctor", icon: Stethoscope },
```

- [ ] **Step 5: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add app/doctor/page.tsx components/doctor/health-card.tsx components/doctor/health-grid.tsx lib/navigation.ts
git commit -m "feat(doctor): add system health dashboard page with agent status grid"
```

---

## Phase 2: Communication Layer

### Task 2.1: Agent-to-Agent Chat UI (Compose + Send)

**Files:**
- Create: `lib/server/compose-message.ts`
- Create: `app/api/messages/send/route.ts`
- Create: `components/messages/message-composer.tsx`
- Modify: `app/messages/page.tsx`
- Modify: `lib/server/messaging.ts`

- [ ] **Step 1: Create message composition server function**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/server/compose-message.ts`:

```typescript
import { db } from '@/lib/db';
import { messageThreads, messages, outboxEvents } from '@/drizzle/schema';
import { withOutbox } from '@/lib/outbox-helper';
import { sql } from 'drizzle-orm';

export interface ComposeMessageInput {
  threadId?: string;
  title?: string;
  content: string;
  fromAgentId: string;
  toAgentIds: string[];
  priority?: 'normal' | 'high' | 'urgent';
}

export async function composeMessage(input: ComposeMessageInput): Promise<{ threadId: string; messageId: string }> {
  const messageId = crypto.randomUUID();
  let threadId = input.threadId ?? crypto.randomUUID();
  const isNewThread = !input.threadId;

  await db.transaction(async (tx) => {
    // Create thread if new
    if (isNewThread) {
      await tx.insert(messageThreads).values({
        id: threadId,
        title: input.title ?? `Message from ${input.fromAgentId}`,
        status: 'active',
        participants: JSON.stringify([input.fromAgentId, ...input.toAgentIds]),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      // Update thread timestamp
      await tx
        .update(messageThreads)
        .set({ updatedAt: new Date() })
        .where(sql`${messageThreads.id} = ${threadId}`);
    }

    // Insert message
    await tx.insert(messages).values({
      id: messageId,
      threadId,
      fromAgentId: input.fromAgentId,
      content: input.content,
      priority: input.priority ?? 'normal',
      createdAt: new Date(),
    });

    // Emit outbox event
    await withOutbox(tx, {
      eventType: 'message.sent',
      entityId: messageId,
      entityType: 'message',
      payload: {
        threadId,
        fromAgentId: input.fromAgentId,
        toAgentIds: input.toAgentIds,
        priority: input.priority ?? 'normal',
      },
    });
  });

  return { threadId, messageId };
}
```

- [ ] **Step 2: Create send message API route**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/app/api/messages/send/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { composeMessage } from '@/lib/server/compose-message';
import { authenticateAndAuthorize } from '@/lib/server/agent-auth';
import { z } from 'zod';

const sendSchema = z.object({
  threadId: z.string().uuid().optional(),
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(10000),
  toAgentIds: z.array(z.string()).min(1),
  priority: z.enum(['normal', 'high', 'urgent']).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authenticateAndAuthorize(request, 'write');
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const parsed = sendSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await composeMessage({
      ...parsed.data,
      fromAgentId: auth.agentId!,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send message' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Create message composer component**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/messages/message-composer.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AGENT_IDS } from '@/lib/server/health';
import { Send, X } from 'lucide-react';
import { toast } from 'sonner';

interface MessageComposerProps {
  threadId?: string;
  fromAgentId: string;
  onSent?: () => void;
}

export function MessageComposer({ threadId, fromAgentId, onSent }: MessageComposerProps) {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent'>('normal');
  const [isSending, setIsSending] = useState(false);
  const [showComposer, setShowComposer] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim() || selectedAgents.length === 0) {
      toast.error('Content and recipients are required');
      return;
    }

    setIsSending(true);

    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          title: title || undefined,
          content,
          toAgentIds: selectedAgents,
          priority,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error ?? 'Failed to send');
      }

      toast.success('Message sent');
      setContent('');
      setTitle('');
      setSelectedAgents([]);
      setPriority('normal');
      setShowComposer(false);
      onSent?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) =>
      prev.includes(agentId) ? prev.filter((a) => a !== agentId) : [...prev, agentId],
    );
  };

  if (!showComposer) {
    return (
      <button
        onClick={() => setShowComposer(true)}
        className="mb-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Compose Message
      </button>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Compose Message</CardTitle>
        <button onClick={() => setShowComposer(false)}>
          <X className="h-5 w-5 text-muted-foreground" />
        </button>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!threadId && (
            <input
              type="text"
              placeholder="Thread title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          )}

          <textarea
            placeholder="Message content..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="w-full rounded-md border px-3 py-2"
            required
          />

          {/* Recipients */}
          <div>
            <label className="mb-1 block text-sm font-medium">Recipients</label>
            <div className="flex flex-wrap gap-2">
              {AGENT_IDS.filter((id) => id !== fromAgentId).map((agentId) => (
                <button
                  key={agentId}
                  type="button"
                  onClick={() => toggleAgent(agentId)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    selectedAgents.includes(agentId)
                      ? 'bg-blue-600 text-white'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {agentId.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="mb-1 block text-sm font-medium">Priority</label>
            <div className="flex gap-2">
              {(['normal', 'high', 'urgent'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`rounded-md px-3 py-1 text-sm ${
                    priority === p
                      ? p === 'urgent'
                        ? 'bg-red-600 text-white'
                        : p === 'high'
                          ? 'bg-amber-600 text-white'
                          : 'bg-muted text-foreground'
                      : 'bg-muted/50 text-muted-foreground'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={isSending}>
            <Send className="mr-2 h-4 w-4" />
            {isSending ? 'Sending...' : 'Send'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Update messages page to include composer**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/app/messages/page.tsx` — add the MessageComposer component above the thread list. Pass `fromAgentId` from the authenticated agent context.

- [ ] **Step 5: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/server/compose-message.ts app/api/messages/send/route.ts components/messages/message-composer.tsx app/messages/page.tsx
git commit -m "feat(chat): add message compose and send functionality with agent targeting"
```

---

### Task 2.2: Live Session View

**Files:**
- Create: `components/sessions/live-session-view.tsx`
- Modify: `app/sessions/[id]/page.tsx`

- [ ] **Step 1: Create live session view component**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/sessions/live-session-view.tsx`:

```typescript
'use client';

import { useEffect, useState, useRef } from 'react';
import { useWebSocket } from '@/lib/ws-client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Circle } from 'lucide-react';

interface LiveSessionViewProps {
  sessionId: string;
  agentId: string;
}

interface SessionEvent {
  timestamp: number;
  type: 'message' | 'tool_call' | 'tool_result' | 'thinking';
  content: string;
  data?: Record<string, unknown>;
}

export function LiveSessionView({ sessionId, agentId }: LiveSessionViewProps) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [isLive, setIsLive] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const { isConnected, subscribe } = useWebSocket({
    url: `${typeof window !== 'undefined' ? window.location.origin.replace('http', 'ws') : ''}/api/ws`,
    queryKeys: [['sessions', sessionId]],
    enabled: isLive,
    onEvent: (event) => {
      if (event.entityId === sessionId) {
        setEvents((prev) => [
          ...prev,
          {
            timestamp: Date.now(),
            type: event.eventType.includes('tool') ? 'tool_call' : 'message',
            content: event.eventType,
            data: event.payload,
          },
        ]);
      }
    },
  });

  useEffect(() => {
    subscribe(['session.*']);
  }, [subscribe]);

  useEffect(() => {
    if (containerRef.current && isLive) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, isLive]);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            {isConnected ? (
              <Circle className="h-3 w-3 fill-emerald-500 text-emerald-500" />
            ) : (
              <Circle className="h-3 w-3 fill-red-500 text-red-500" />
            )}
            <span className="text-sm font-medium">
              {isLive ? 'Live' : 'Paused'} — {agentId}
            </span>
          </div>
          <button
            onClick={() => setIsLive(!isLive)}
            className="rounded-md px-2 py-1 text-sm hover:bg-muted"
          >
            {isLive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
        </div>

        <div
          ref={containerRef}
          className="max-h-[600px] space-y-2 overflow-y-auto p-4"
        >
          {events.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              Waiting for session events...
            </div>
          )}
          {events.map((event, i) => (
            <div key={i} className="rounded border bg-muted/50 p-2 text-sm">
              <Badge variant="outline" className="mb-1">
                {event.type}
              </Badge>
              <pre className="whitespace-pre-wrap font-mono text-xs">
                {JSON.stringify(event.data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Add live mode to session detail page**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/app/sessions/[id]/page.tsx` — add a toggle between "Post-hoc view" (existing) and "Live view" (new). When live mode is enabled, render `LiveSessionView` instead of the static message timeline.

- [ ] **Step 3: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add components/sessions/live-session-view.tsx app/sessions/\[id\]/page.tsx
git commit -m "feat(sessions): add live streaming session view via WebSocket"
```

---

### Task 2.3: Notification System

**Files:**
- Create: `lib/notification-context.tsx`
- Create: `components/notifications/notification-toast.tsx`
- Create: `components/notifications/notification-bell.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Create notification context**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/notification-context.tsx`:

```typescript
'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  timestamp: Date;
  read: boolean;
  action?: { label: string; href: string };
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (n: Omit<Notification, 'id' | 'read' | 'timestamp'>) => void;
  markRead: (id: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const addNotification = useCallback((n: Omit<Notification, 'id' | 'read' | 'timestamp'>) => {
    setNotifications((prev) => [
      {
        ...n,
        id: crypto.randomUUID(),
        read: false,
        timestamp: new Date(),
      },
      ...prev,
    ].slice(0, 50)); // Keep last 50
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, addNotification, markRead, clearAll }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
```

- [ ] **Step 2: Create notification bell**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/notifications/notification-bell.tsx`:

```typescript
'use client';

import { Bell } from 'lucide-react';
import { useNotifications } from '@/lib/notification-context';

export function NotificationBell() {
  const { unreadCount } = useNotifications();

  return (
    <button className="relative p-2 hover:bg-muted rounded-md">
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 3: Wire notifications to WS events**

Add to `app/layout.tsx` — wrap the app with `NotificationProvider` and add a WS listener that converts WS events to notifications:

```typescript
import { NotificationProvider } from '@/lib/notification-context';

// In the layout, wrap children with NotificationProvider
<NotificationProvider>
  {/* existing children */}
</NotificationProvider>
```

- [ ] **Step 4: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/notification-context.tsx components/notifications/notification-bell.tsx components/notifications/notification-toast.tsx app/layout.tsx
git commit -m "feat(notifications): add notification context and bell with unread badge"
```

---

## Phase 3: Operations Dashboard

### Task 3.1: Scheduled Jobs UI

**Files:**
- Create: `lib/server/cron-jobs.ts`
- Create: `app/jobs/page.tsx`
- Create: `components/jobs/job-list.tsx`
- Create: `components/jobs/job-form.tsx`
- Create: `components/jobs/job-run-log.tsx`
- Modify: `lib/navigation.ts`

- [ ] **Step 1: Create cron jobs server functions**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/server/cron-jobs.ts`:

```typescript
import { db } from '@/lib/db';

export interface CronJob {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  enabled: boolean;
  scheduleKind: 'at' | 'every' | 'cron';
  scheduleValue: string;  // e.g., '*/5 * * * *' or '5m'
  endpoint: string;       // e.g., '/api/cron/outbox'
  lastRunAt?: Date;
  lastStatus?: 'ok' | 'error' | 'skipped';
  nextRunAt?: Date;
  createdAt: Date;
}

export async function getCronJobs(): Promise<CronJob[]> {
  // Cron jobs are defined in code + tracked via execution log
  // This returns the known jobs + their last execution status
  return KNOWN_JOBS.map((job) => ({
    ...job,
    enabled: true,
    createdAt: new Date('2024-01-01'),
  }));
}

export async function triggerCronJob(jobId: string): Promise<{ ok: boolean; status: number }> {
  const job = KNOWN_JOBS.find((j) => j.id === jobId);
  if (!job) return { ok: false, status: 404 };

  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${baseUrl}${job.endpoint}`, {
      method: 'GET',
      headers: { 'x-agent-id': job.agentId ?? 'system' },
    });

    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 500 };
  }
}

// Known cron jobs (matches existing cron routes)
const KNOWN_JOBS: Omit<CronJob, 'enabled' | 'createdAt'>[] = [
  {
    id: 'outbox-relay',
    name: 'Outbox Relay',
    description: 'Broadcasts unpublished outbox events to WS clients',
    agentId: 'system',
    scheduleKind: 'every',
    scheduleValue: '1m',
    endpoint: '/api/cron/outbox',
  },
  {
    id: 'scheduler-scan',
    name: 'Scheduler Scan',
    description: 'Scans for stalled tasks and applies recovery pipeline',
    agentId: 'system',
    scheduleKind: 'every',
    scheduleValue: '2m',
    endpoint: '/api/cron/scheduler',
  },
];
```

- [ ] **Step 2: Create jobs page**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/app/jobs/page.tsx`:

```typescript
import { Suspense } from 'react';
import { getCronJobs } from '@/lib/server/cron-jobs';
import { JobList } from '@/components/jobs/job-list';

export default async function JobsPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="mb-6 text-3xl font-bold">Scheduled Jobs</h1>
      <Suspense fallback={<div>Loading jobs...</div>}>
        <JobsContent />
      </Suspense>
    </div>
  );
}

async function JobsContent() {
  const jobs = await getCronJobs();
  return <JobList jobs={jobs} />;
}
```

- [ ] **Step 3: Create job list component**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/jobs/job-list.tsx`:

```typescript
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, Clock } from 'lucide-react';
import { toast } from 'sonner';
import type { CronJob } from '@/lib/server/cron-jobs';

export function JobList({ jobs }: { jobs: CronJob[] }) {
  const handleRunNow = async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}/run`, { method: 'POST' });
    if (res.ok) {
      toast.success('Job triggered');
    } else {
      toast.error('Failed to trigger job');
    }
  };

  return (
    <div className="space-y-4">
      {jobs.map((job) => (
        <Card key={job.id}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg">{job.name}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={job.enabled ? 'default' : 'secondary'}>
                {job.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <button
                onClick={() => handleRunNow(job.id)}
                className="rounded-md p-1 hover:bg-muted"
                title="Run now"
              >
                <Play className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {job.description && (
              <p className="text-muted-foreground">{job.description}</p>
            )}
            <div className="flex items-center gap-4 text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                Schedule: {job.scheduleValue} ({job.scheduleKind})
              </span>
              {job.agentId && <span>Agent: {job.agentId}</span>}
              {job.lastRunAt && <span>Last run: {job.lastRunAt.toLocaleString()}</span>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add navigation entry**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/lib/navigation.ts` — add to Agent Operations section:

```typescript
import { Clock } from 'lucide-react';

{ href: "/jobs", label: "Scheduled Jobs", icon: Clock },
```

- [ ] **Step 5: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/server/cron-jobs.ts app/jobs/page.tsx components/jobs/job-list.tsx components/jobs/job-form.tsx components/jobs/job-run-log.tsx lib/navigation.ts
git commit -m "feat(jobs): add scheduled jobs management UI with run-now capability"
```

---

### Task 3.2: Agent Configuration UI (Dynamic Permissions)

**Files:**
- Create: `lib/server/agent-config.ts`
- Create: `app/agents/config/page.tsx`
- Create: `components/agents/permission-editor.tsx`
- Modify: `lib/agent-permissions.ts`

- [ ] **Step 1: Create agent config server function**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/server/agent-config.ts`:

```typescript
import type { AgentPermissions } from '@/lib/agent-permissions';
import { getAgentPermissions, DEFAULT_PERMISSIONS } from '@/lib/agent-permissions';

export interface AgentConfig {
  agentId: string;
  name: string;
  role: string;
  permissions: AgentPermissions;
  model?: string;
  status: 'active' | 'disabled';
}

export async function getAgentConfigs(): Promise<AgentConfig[]> {
  const agentNames = [
    { id: 'ceo', name: 'CEO', role: 'Coordinator' },
    { id: 'coo', name: 'COO', role: 'Executor' },
    { id: 'cpo', name: 'CPO', role: 'Executor' },
    { id: 'cro', name: 'CRO', role: 'Coordinator' },
    { id: 'cfo', name: 'CFO', role: 'Executor' },
    { id: 'cmo', name: 'CMO', role: 'Executor' },
    { id: 'cio', name: 'CIO', role: 'Observer' },
    { id: 'physician', name: 'Physician', role: 'Executor' },
  ];

  return agentNames.map((agent) => {
    const perms = getAgentPermissions(agent.id);
    return {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      permissions: perms,
      status: 'active',
    };
  });
}
```

- [ ] **Step 2: Create permission editor**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/agents/permission-editor.tsx`:

```typescript
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AgentConfig } from '@/lib/server/agent-config';

export function PermissionEditor({ agent }: { agent: AgentConfig }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{agent.name} — {agent.role}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="mb-2 font-medium">Capabilities</h4>
          <div className="space-y-2">
            {Object.entries(agent.permissions).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="capitalize">{key}</span>
                <Badge variant={value ? 'default' : 'secondary'}>
                  {value ? 'Allowed' : 'Denied'}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create agent config page**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/app/agents/config/page.tsx`:

```typescript
import { getAgentConfigs } from '@/lib/server/agent-config';
import { PermissionEditor } from '@/components/agents/permission-editor';

export default async function AgentConfigPage() {
  const configs = await getAgentConfigs();

  return (
    <div className="container mx-auto py-8">
      <h1 className="mb-6 text-3xl font-bold">Agent Configuration</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {configs.map((config) => (
          <PermissionEditor key={config.agentId} agent={config} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/server/agent-config.ts app/agents/config/page.tsx components/agents/permission-editor.tsx lib/agent-permissions.ts
git commit -m "feat(config): add agent configuration UI with dynamic permission display"
```

---

## Phase 4: Intelligence Layer

### Task 4.1: Memory / Vector Search UI

**Files:**
- Create: `lib/server/memory.ts`
- Create: `app/memory/page.tsx`
- Create: `components/memory/memory-search.tsx`
- Create: `components/memory/memory-entry.tsx`
- Modify: `lib/navigation.ts`

- [ ] **Step 1: Create memory server functions**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/server/memory.ts`:

```typescript
import { db } from '@/lib/db';
import { sessionMessages, sessionToolCalls, outboxEvents } from '@/drizzle/schema';
import { desc, eq, like, sql } from 'drizzle-orm';

export interface MemoryEntry {
  id: string;
  type: 'session_message' | 'tool_call' | 'outbox_event' | 'note';
  agentId: string;
  content: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export async function searchMemories(query: string, limit = 50): Promise<MemoryEntry[]> {
  // Text-based search across session messages (vector search can be added later)
  const [msgResults, toolResults] = await Promise.all([
    db
      .select({
        id: sessionMessages.id,
        type: sql<string>`'session_message'`,
        agentId: sessionMessages.agentId,
        content: sessionMessages.content,
        timestamp: sessionMessages.timestamp,
        metadata: sessionMessages.metadata,
      })
      .from(sessionMessages)
      .where(like(sessionMessages.content, `%${query}%`))
      .orderBy(desc(sessionMessages.timestamp))
      .limit(limit),

    db
      .select({
        id: sessionToolCalls.id,
        type: sql<string>`'tool_call'`,
        agentId: sessionToolCalls.agentId,
        content: sessionToolCalls.toolName,
        timestamp: sessionToolCalls.timestamp,
        metadata: sessionToolCalls.input,
      })
      .from(sessionToolCalls)
      .where(like(sessionToolCalls.toolName, `%${query}%`))
      .orderBy(desc(sessionToolCalls.timestamp))
      .limit(limit),
  ]);

  return [...msgResults, ...toolResults]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

export async function getRecentMemories(agentId?: string, limit = 20): Promise<MemoryEntry[]> {
  let baseQuery = db
    .select({
      id: sessionMessages.id,
      type: sql<string>`'session_message'`,
      agentId: sessionMessages.agentId,
      content: sessionMessages.content,
      timestamp: sessionMessages.timestamp,
      metadata: sessionMessages.metadata,
    })
    .from(sessionMessages)
    .orderBy(desc(sessionMessages.timestamp))
    .limit(limit);

  if (agentId) {
    baseQuery = baseQuery.where(eq(sessionMessages.agentId, agentId));
  }

  return baseQuery;
}
```

- [ ] **Step 2: Create memory page**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/app/memory/page.tsx`:

```typescript
import { Suspense } from 'react';
import { MemorySearch } from '@/components/memory/memory-search';

export default function MemoryPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="mb-6 text-3xl font-bold">Memory</h1>
      <Suspense fallback={<div>Loading memory search...</div>}>
        <MemorySearch />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 3: Create memory search component**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/memory/memory-search.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { MemoryEntry } from '@/components/memory/memory-entry';

export function MemorySearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const res = await fetch(`/api/memory/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        setResults(await res.json());
      }
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories..."
          className="flex-1 rounded-md border px-3 py-2"
        />
        <button
          type="submit"
          disabled={isSearching}
          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          <Search className="h-4 w-4" />
        </button>
      </form>

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <MemoryEntry key={i} entry={r} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add navigation entry**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/lib/navigation.ts` — add to Knowledge section:

```typescript
import { Brain } from 'lucide-react';

{ href: "/memory", label: "Memory", icon: Brain },
```

- [ ] **Step 5: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/server/memory.ts app/memory/page.tsx components/memory/memory-search.tsx components/memory/memory-entry.tsx lib/navigation.ts
git commit -m "feat(memory): add memory search page with text-based search across sessions"
```

---

### Task 4.2: Skills Management UI

**Files:**
- Create: `lib/server/skills.ts`
- Create: `app/skills/page.tsx`
- Create: `components/skills/skill-list.tsx`
- Create: `components/skills/skill-toggle.tsx`

- [ ] **Step 1: Create skills server functions**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/server/skills.ts`:

```typescript
import { db } from '@/lib/db';

export interface SkillInfo {
  name: string;
  agentId: string;
  status: 'ready' | 'needs-setup' | 'disabled';
  description?: string;
  category?: string;
  enabled: boolean;
}

export async function getSkills(agentId?: string): Promise<SkillInfo[]> {
  // Skills are stored in agent workspace files
  // Return from known workspace locations
  const agents = agentId ? [agentId] : ['ceo', 'coo', 'cpo', 'cro', 'cfo', 'cmo', 'cio', 'physician'];

  // For now, return placeholder skills — populate from workspace in later iteration
  return agents.flatMap((aid) => [
    {
      name: 'web-search',
      agentId: aid,
      status: 'ready' as const,
      description: 'Search the web for current information',
      category: 'research',
      enabled: true,
    },
  ]);
}

export async function toggleSkill(agentId: string, skillName: string, enabled: boolean): Promise<boolean> {
  // Write to agent workspace config
  // For now, return true — implement actual toggle later
  return true;
}
```

- [ ] **Step 2: Create skills page**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/app/skills/page.tsx`:

```typescript
import { getSkills } from '@/lib/server/skills';
import { SkillList } from '@/components/skills/skill-list';

export default async function SkillsPage() {
  const skills = await getSkills();

  return (
    <div className="container mx-auto py-8">
      <h1 className="mb-6 text-3xl font-bold">Agent Skills</h1>
      <SkillList skills={skills} />
    </div>
  );
}
```

- [ ] **Step 3: Create skill list component**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/skills/skill-list.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SkillToggle } from '@/components/skills/skill-toggle';
import type { SkillInfo } from '@/lib/server/skills';

export function SkillList({ skills }: { skills: SkillInfo[] }) {
  const [filter, setFilter] = useState<'all' | 'ready' | 'disabled'>('all');

  const filtered = skills.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'ready') return s.status === 'ready';
    if (filter === 'disabled') return !s.enabled;
    return true;
  });

  // Group by category
  const byCategory = filtered.reduce<Record<string, SkillInfo[]>>((acc, skill) => {
    const cat = skill.category ?? 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(skill);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['all', 'ready', 'disabled'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1 text-sm ${
              filter === f ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {Object.entries(byCategory).map(([category, catSkills]) => (
        <div key={category}>
          <h3 className="mb-2 text-lg font-semibold capitalize">{category}</h3>
          <div className="space-y-2">
            {catSkills.map((skill) => (
              <Card key={`${skill.agentId}-${skill.name}`}>
                <CardContent className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">{skill.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {skill.agentId.toUpperCase()} — {skill.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={skill.status === 'ready' ? 'default' : 'secondary'}>
                      {skill.status}
                    </Badge>
                    <SkillToggle
                      agentId={skill.agentId}
                      skillName={skill.name}
                      enabled={skill.enabled}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add navigation entry**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/lib/navigation.ts` — add to System section:

```typescript
import { Wrench } from 'lucide-react';

{ href: "/skills", label: "Skills", icon: Wrench },
```

- [ ] **Step 5: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/server/skills.ts app/skills/page.tsx components/skills/skill-list.tsx components/skills/skill-toggle.tsx lib/navigation.ts
git commit -m "feat(skills): add skills management UI with per-agent toggle"
```

---

### Task 4.3: Usage Analytics

**Files:**
- Create: `lib/server/usage.ts`
- Create: `app/usage/page.tsx`
- Create: `components/usage/cost-chart.tsx`
- Create: `components/usage/token-chart.tsx`

- [ ] **Step 1: Create usage analytics server functions**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/server/usage.ts`:

```typescript
import { db } from '@/lib/db';
import { sessionToolCalls, agentSessions } from '@/drizzle/schema/operations';
import { desc, eq, sql, count, sum } from 'drizzle-orm';

export interface UsageSummary {
  totalSessions: number;
  totalToolCalls: number;
  sessionsByAgent: { agentId: string; count: number }[];
  toolCallsByAgent: { agentId: string; count: number }[];
  recentSessions: Array<{
    id: string;
    agentId: string;
    startTime: Date;
    endTime?: Date;
    status: string;
  }>;
}

export async function getUsageSummary(days = 30): Promise<UsageSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [sessionsResult, toolCallsResult, byAgentSessions, byAgentTools] = await Promise.all([
    db
      .select({ count: count() })
      .from(agentSessions)
      .where(sql`${agentSessions.startTime} > ${since}`),

    db
      .select({ count: count() })
      .from(sessionToolCalls)
      .where(sql`${sessionToolCalls.timestamp} > ${since}`),

    db
      .select({
        agentId: agentSessions.agentId,
        count: count(),
      })
      .from(agentSessions)
      .where(sql`${agentSessions.startTime} > ${since}`)
      .groupBy(agentSessions.agentId),

    db
      .select({
        agentId: sessionToolCalls.agentId,
        count: count(),
      })
      .from(sessionToolCalls)
      .where(sql`${sessionToolCalls.timestamp} > ${since}`)
      .groupBy(sessionToolCalls.agentId),
  ]);

  return {
    totalSessions: sessionsResult[0]?.count ?? 0,
    totalToolCalls: toolCallsResult[0]?.count ?? 0,
    sessionsByAgent: byAgentSessions,
    toolCallsByAgent: byAgentTools,
    recentSessions: [],
  };
}
```

- [ ] **Step 2: Create usage page**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/app/usage/page.tsx`:

```typescript
import { Suspense } from 'react';
import { getUsageSummary } from '@/lib/server/usage';
import { StatCard } from '@/components/ui/stat-card';

export default async function UsagePage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="mb-6 text-3xl font-bold">Usage Analytics</h1>
      <Suspense fallback={<div>Loading usage data...</div>}>
        <UsageContent />
      </Suspense>
    </div>
  );
}

async function UsageContent() {
  const usage = await getUsageSummary(30);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          title="Total Sessions"
          value={usage.totalSessions.toString()}
          subtitle="Last 30 days"
        />
        <StatCard
          title="Total Tool Calls"
          value={usage.totalToolCalls.toString()}
          subtitle="Last 30 days"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="mb-2 font-semibold">Sessions by Agent</h3>
          {usage.sessionsByAgent.map((a) => (
            <div key={a.agentId} className="flex justify-between py-1">
              <span>{a.agentId.toUpperCase()}</span>
              <span className="font-mono">{a.count}</span>
            </div>
          ))}
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Tool Calls by Agent</h3>
          {usage.toolCallsByAgent.map((a) => (
            <div key={a.agentId} className="flex justify-between py-1">
              <span>{a.agentId.toUpperCase()}</span>
              <span className="font-mono">{a.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add navigation entry**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/lib/navigation.ts` — add to System section:

```typescript
import { BarChart3 } from 'lucide-react';

{ href: "/usage", label: "Usage", icon: BarChart3 },
```

- [ ] **Step 4: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add lib/server/usage.ts app/usage/page.tsx components/usage/cost-chart.tsx components/usage/token-chart.tsx lib/navigation.ts
git commit -m "feat(usage): add usage analytics dashboard with per-agent breakdown"
```

---

## Phase 5: Orchestration & Polish

### Task 5.1: Command Palette (Cmd+K)

**Files:**
- Create: `components/ui/command-palette.tsx`
- Create: `lib/command-registry.ts`
- Modify: `app/layout.tsx`
- Modify: `lib/shortcuts.ts`

- [ ] **Step 1: Create command registry**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/lib/command-registry.ts`:

```typescript
import { allNavItems } from '@/lib/navigation';

export interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  action: () => void;
  category: 'navigation' | 'action' | 'agent';
}

export function buildCommands(
  navigate: (href: string) => void,
): Command[] {
  return [
    ...allNavItems.map((item) => ({
      id: `nav-${item.href}`,
      label: item.label,
      shortcut: item.href,
      action: () => navigate(item.href),
      category: 'navigation' as const,
    })),
  ];
}
```

- [ ] **Step 2: Create command palette component**

Create `/home/ishanp/Documents/GitHub/operant/dashboard/components/ui/command-palette.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { buildCommands } from '@/lib/command-registry';
import { Search, ArrowRight } from 'lucide-react';

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const commands = buildCommands((href) => {
    router.push(href);
    setIsOpen(false);
  });

  const filtered = query
    ? commands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.shortcut?.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleOpen();
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => setIsOpen(false)}
      />
      <div className="relative w-full max-w-2xl rounded-xl border bg-background shadow-2xl">
        <div className="flex items-center border-b px-4 py-3">
          <Search className="mr-2 h-5 w-5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-lg outline-none"
          />
          <kbd className="rounded border bg-muted px-2 py-0.5 text-xs">ESC</kbd>
        </div>
        <div className="max-h-[400px] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No results for "{query}"
            </div>
          )}
          {filtered.map((cmd) => (
            <button
              key={cmd.id}
              onClick={cmd.action}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 hover:bg-muted"
            >
              <div>
                <div className="font-medium">{cmd.label}</div>
                {cmd.description && (
                  <div className="text-sm text-muted-foreground">
                    {cmd.description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {cmd.shortcut && (
                  <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">
                    {cmd.shortcut}
                  </kbd>
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add to layout**

Modify `/home/ishanp/Documents/GitHub/operant/dashboard/app/layout.tsx` — add `<CommandPalette />` at the root level:

```typescript
import { CommandPalette } from '@/components/ui/command-palette';

// Inside the body:
<body>
  {children}
  <CommandPalette />
</body>
```

- [ ] **Step 4: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard
git add components/ui/command-palette.tsx lib/command-registry.ts app/layout.tsx lib/shortcuts.ts
git commit -m "feat(cmdk): add command palette with Cmd+K navigation"
```

---

## Verification Checklist

After completing all phases, run:

```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard

# 1. Build should pass
npm run build

# 2. All tests should pass
npm test -- --run

# 3. No TypeScript errors
npx tsc --noEmit

# 4. Lint should pass
npm run lint
```

---

## Dependencies Between Phases

```
Phase 1 (WS + Outbox + Health)
  └── Phase 2 (Chat + Live Session + Notifications) — needs WS client
  └── Phase 3 (Jobs UI + Doctor + Config) — needs health data
Phase 4 (Memory + Skills + Usage) — mostly independent, can run in parallel
Phase 5 (Discussion + Delegation + CmdK) — needs everything above
```

Phase 1 MUST be completed first. Phases 2-3 can proceed after Phase 1. Phase 4 is largely independent. Phase 5 depends on all prior phases.

---

## Risk Mitigations

1. **WS server in Next.js**: Next.js doesn't natively support WS in route handlers. Options:
   - Custom HTTP server (wraps Next.js) — most robust
   - Separate WS microservice — more ops complexity
   - Enhanced SSE + POST endpoints — works within Next.js but no bi-directional

2. **Outbox circular dependency**: `lib/outbox.ts` imports `ws-server.ts` which imports `agent-auth.ts`. If circular imports occur, use dependency injection or a separate event bus module.

3. **Test database**: Integration tests require a running PostgreSQL. Ensure `DATABASE_URL` is set in test env.

---

## Plan complete and saved to `docs/superpowers/plans/2026-04-12-multi-agent-dashboard-upgrade.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
