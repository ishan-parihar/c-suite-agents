import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type {
  WsMessage,
  WsClientInfo,
  WsEventPayload,
  WsAuthPayload,
  WsSubscribePayload,
} from './ws-types';
import { getMessageBus } from './message-bus';

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

export class WsGateway {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WsClientInfo>();
  private clientWsMap = new Map<string, WebSocket>();
  private heartbeats = new Map<string, ReturnType<typeof setInterval>>();

  constructor() {
    const bus = getMessageBus();
    bus.subscribe('outbox:event', (event) => {
      if (event && typeof event === 'object' && 'eventType' in event) {
        this.broadcastOutboxEvent(event as WsEventPayload);
      }
    });
  }

  get isConnected(): boolean {
    return this.wss !== null;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  getClients(): WsClientInfo[] {
    return Array.from(this.clients.values());
  }

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
    for (const interval of this.heartbeats.values()) {
      clearInterval(interval);
    }
    this.heartbeats.clear();
    this.wss?.close();
    this.clients.clear();
    this.clientWsMap.clear();
    this.wss = null;
  }

  private verifyClient(
    info: { req: IncomingMessage },
    cb: (result: boolean, code?: number, message?: string) => void,
  ): void {
    cb(true);
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = crypto.randomUUID();
    const clientInfo: WsClientInfo = {
      id: clientId,
      isAuthenticated: false,
      subscriptions: new Set(),
      connectedAt: new Date(),
      lastPong: new Date(),
    };

    this.clients.set(clientId, clientInfo);
    this.clientWsMap.set(clientId, ws);

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

    this.startHeartbeat(ws, clientId);
  }

  private onMessage(ws: WebSocket, clientId: string, data: import('ws').RawData): void {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    try {
      const message = JSON.parse(data.toString()) as WsMessage;

      switch (message.type) {
        case 'auth':
          this.handleAuth(ws, clientId, message.payload);
          break;
        case 'subscribe':
          this.handleSubscribe(clientId, message.payload);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message.payload);
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
    const interval = this.heartbeats.get(clientId);
    if (interval) {
      clearInterval(interval);
      this.heartbeats.delete(clientId);
    }
    this.clients.delete(clientId);
    this.clientWsMap.delete(clientId);
  }

  private handleAuth(
    ws: WebSocket,
    clientId: string,
    payload: unknown,
  ): void {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    if (!payload || typeof payload !== 'object') {
      this.sendToClient(ws, {
        type: 'auth_fail',
        payload: { message: 'Invalid payload' },
        timestamp: Date.now(),
      });
      return;
    }

    const authPayload = payload as Record<string, unknown>;

    try {
      if (typeof authPayload.agentId === 'string') {
        clientInfo.agentId = authPayload.agentId;
        clientInfo.isAuthenticated = true;
        this.sendToClient(ws, {
          type: 'auth_ok',
          payload: { clientId, agentId: authPayload.agentId },
          timestamp: Date.now(),
        });
      } else if (typeof authPayload.token === 'string' || typeof authPayload.cookie === 'string') {
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

  private handleSubscribe(clientId: string, payload: unknown): void {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    if (!payload || typeof payload !== 'object' || !('eventTypes' in payload)) return;
    const subPayload = payload as Record<string, unknown>;
    if (!Array.isArray(subPayload.eventTypes)) return;

    const eventTypes = subPayload.eventTypes as string[];
    if (eventTypes.length === 0) {
      clientInfo.subscriptions = new Set(['*']);
    } else {
      eventTypes.forEach((t) => clientInfo.subscriptions.add(t));
    }
  }

  private handleUnsubscribe(clientId: string, payload: unknown): void {
    const clientInfo = this.clients.get(clientId);
    if (!clientInfo) return;

    if (!payload || typeof payload !== 'object' || !('eventTypes' in payload)) return;
    const subPayload = payload as Record<string, unknown>;
    if (!Array.isArray(subPayload.eventTypes)) return;

    (subPayload.eventTypes as string[]).forEach((t) => clientInfo.subscriptions.delete(t));
  }

  private startHeartbeat(ws: WebSocket, clientId: string): void {
    const interval = setInterval(() => {
      const currentWs = this.clientWsMap.get(clientId);
      if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        this.heartbeats.delete(clientId);
        return;
      }

      const clientInfo = this.clients.get(clientId);
      const staleMs = Date.now() - (clientInfo?.lastPong.getTime() ?? 0);

      if (staleMs > 60_000) {
        currentWs.terminate();
        clearInterval(interval);
        this.heartbeats.delete(clientId);
        return;
      }

      currentWs.ping();
      this.sendToClient(currentWs, { type: 'ping', timestamp: Date.now() });
    }, 30_000);

    this.heartbeats.set(clientId, interval);
  }

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

      const ws = this.clientWsMap.get(clientId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  publish(eventType: string, payload: Record<string, unknown>): void {
    const event: WsEventPayload = {
      eventType,
      entityId: typeof payload.entityId === 'string' ? payload.entityId : '',
      entityType: typeof payload.entityType === 'string' ? payload.entityType : '',
      payload,
    };
    const bus = getMessageBus();
    bus.publish('outbox:event', event);
  }

  sendNotification(agentId: string, notification: WsMessage['payload']): void {
    this.clients.forEach((clientInfo, clientId) => {
      if (clientInfo.agentId !== agentId) return;
      const ws = this.clientWsMap.get(clientId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'notification',
          payload: notification,
          timestamp: Date.now(),
        }));
      }
    });
  }

  private clientMatchesSubscription(client: WsClientInfo, eventType: string): boolean {
    if (client.subscriptions.has('*')) return true;
    if (client.subscriptions.has(eventType)) return true;

    for (const sub of client.subscriptions) {
      if (sub.endsWith('.*') && eventType.startsWith(sub.slice(0, -2))) {
        return true;
      }
    }
    return false;
  }

  private sendToClient(ws: WebSocket, message: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
