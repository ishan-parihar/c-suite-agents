import type http from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import { validateAgentIdentity } from "../auth/session";
import { getMessageBus } from "./message-bus";
import {
  serializeFrame,
  deserializeFrame,
  type WsSession,
  type ClientFrame,
  type ServerFrame,
} from "./ws-types";

const HEARTBEAT_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_CONSECUTIVE_MISSED_PONGS = 2;
const WS_PATH = "/ws";

export class WsGateway extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private sessions: Map<string, WsSession> = new Map();
  private observers: Set<WsSession> = new Set();
  private wsAlive: Map<WebSocket, boolean> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private messageBus = getMessageBus();
  private toolCallResolvers: Map<string, { resolve: (result: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }> = new Map();

  attach(httpServer: http.Server): void {
    this.wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname === WS_PATH) {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit("connection", ws, req);
        });
      }
    });

    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    logger.info("WebSocket gateway attached to HTTP server");

    this.heartbeatTimer = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  private onConnection(ws: WebSocket, _req: http.IncomingMessage): void {
    this.wsAlive.set(ws, false);

    ws.on("pong", () => {
      const session = this.findSessionByWs(ws);
      if (session) {
        this.wsAlive.set(ws, true);
        session.pongReceived = true;
        session.consecutiveMissedPongs = 0;
        session.lastActivity = Date.now();
      }
    });

    ws.on("message", (data: RawData) => this.onMessage(ws, data));

    ws.on("close", (code, reason) => {
      const session = this.findSessionByWs(ws);
      if (session) {
        logger.info({ agentId: session.agentId, code, reason: reason.toString() }, "WS connection closed");
        this.unregisterSession(session);
      } else {
        // Clean up wsAlive for unauthenticated connections
        this.wsAlive.delete(ws);
      }
    });

    ws.on("error", (err: Error) => {
      const session = this.findSessionByWs(ws);
      logger.warn({ agentId: session?.agentId, err: err.message }, "WS connection error");
    });

    const url = new URL((_req.url || "/"), `http://${_req.headers.host}`);
    const agentId = url.searchParams.get("agentId");
    const token = url.searchParams.get("token");

    // Observer mode: dashboard connects without token, authenticates via auth frame
    if (agentId === "dashboard") {
      const timeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1008, "Observer auth timeout");
        }
      }, 5_000);
      timeout.unref();
      return;
    }

    if (agentId && token) {
      this.authenticate(ws, agentId, token, undefined);
    } else {
      ws.send(JSON.stringify({ type: "auth_error", reason: "auth frame required as first message" }));
      const timeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1008, "Authentication timeout");
        }
      }, 10_000);
      timeout.unref();
    }
  }

  private onMessage(ws: WebSocket, data: RawData): void {
    let frame: ClientFrame;
    try {
      frame = deserializeFrame(data.toString());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ws.send(JSON.stringify({ type: "auth_error", reason: `Invalid frame: ${msg}` }));
      return;
    }

    const session = this.findSessionByWs(ws);

    switch (frame.type) {
      case "auth":
        if (session?.authenticated) {
          ws.send(JSON.stringify({ type: "auth_error", reason: "Already authenticated" }));
          return;
        }
        this.authenticate(ws, frame.agent_id, frame.token, frame.last_seq);
        break;

      case "tool_response": {
        if (!session) return;
        session.lastActivity = Date.now();
        const resolver = this.toolCallResolvers.get(frame.id);
        if (resolver) {
          this.toolCallResolvers.delete(frame.id);
          clearTimeout(resolver.timer);
          resolver.resolve(frame.payload.result);
        } else {
          logger.warn({ toolCallId: frame.id }, "Received tool_response for unknown/resolved tool call");
        }
        break;
      }

      case "cancel": {
        if (!session) return;
        session.lastActivity = Date.now();
        this.emit("cancel", { agentId: session.agentId, runId: frame.run_id });
        break;
      }

      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
    }
  }

  private async authenticate(ws: WebSocket, agentId: string, token: string, lastSeq?: number): Promise<void> {
    if (agentId === "dashboard") {
      const sessionId = uuidv4();
      const session: WsSession = {
        agentId,
        ws,
        seq: 0,
        lastActivity: Date.now(),
        sessionId,
        authenticated: true,
        pongReceived: true,
        consecutiveMissedPongs: 0,
        lastSeq,
      };

      this.sessions.set(sessionId, session);
      this.registerObserver(session);

      ws.send(serializeFrame({ type: "auth_ok", session_id: sessionId }));
      logger.info({ agentId, sessionId, sessionType: "observer" }, "WS observer authenticated");
      return;
    }

    try {
      await validateAgentIdentity(agentId);
    } catch {
      ws.send(JSON.stringify({ type: "auth_error", reason: `Unauthorized agent: ${agentId}` }));
      ws.close(1008, "Unauthorized");
      return;
    }

    const sessionId = uuidv4();
    const session: WsSession = {
      agentId,
      ws,
      seq: 0,
      lastActivity: Date.now(),
      sessionId,
      authenticated: true,
      pongReceived: true,
      consecutiveMissedPongs: 0,
      lastSeq,
    };

    this.sessions.set(sessionId, session);
    this.messageBus.registerSession(session);

    ws.send(serializeFrame({ type: "auth_ok", session_id: sessionId }));

    logger.info({ agentId, sessionId, reconnecting: !!lastSeq }, "WS agent authenticated");

    if (lastSeq !== undefined) {
      const delivered = this.messageBus.replayQueuedMessages(agentId, lastSeq);
      if (delivered > 0) {
        ws.send(serializeFrame({ type: "reconnect_hint", last_seq: session.seq }));
      }
    }
  }

  private unregisterSession(session: WsSession): void {
    this.sessions.delete(session.sessionId);
    this.wsAlive.delete(session.ws);
    if (this.observers.has(session)) {
      this.unregisterObserver(session);
    } else {
      this.messageBus.unregisterSession(session.agentId);
    }
  }

  private registerObserver(session: WsSession): void {
    this.observers.add(session);
    this.messageBus.syncObservers(this.observers);
    logger.info({ sessionId: session.sessionId }, "Observer registered");
  }

  private unregisterObserver(session: WsSession): void {
    this.observers.delete(session);
    this.messageBus.syncObservers(this.observers);
    logger.info({ sessionId: session.sessionId }, "Observer unregistered");
  }

  private tick(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
        logger.warn({ agentId: session.agentId, idleMs: now - session.lastActivity }, "Closing idle WS connection");
        session.ws.close(1001, "Idle timeout");
        continue;
      }

      const alive = this.wsAlive.get(session.ws);
      if (!alive) {
        session.consecutiveMissedPongs++;
        if (session.consecutiveMissedPongs >= MAX_CONSECUTIVE_MISSED_PONGS) {
          logger.warn({ agentId: session.agentId, missedPongs: session.consecutiveMissedPongs }, "Closing WS — missed pongs");
          session.ws.close(1001, "Missed pong");
          continue;
        }
      }

      this.wsAlive.set(session.ws, false);
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: "ping" }));
      }
    }
  }

  private findSessionByWs(ws: WebSocket): WsSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.ws === ws) return session;
    }
    return undefined;
  }

  getSessionByAgentId(agentId: string): WsSession | undefined {
    for (const s of this.sessions.values()) {
      if (s.agentId === agentId) return s;
    }
    return undefined;
  }

  pushStreamChunk(agentId: string, sessionId: string, payload: Record<string, unknown>): boolean {
    const session = this.getSessionByAgentId(agentId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) return false;
    try {
      const frame: ServerFrame = { type: "stream_chunk", session_id: sessionId, payload: payload as any };
      session.ws.send(serializeFrame(frame));
      return true;
    } catch {
      return false;
    }
  }

  pushStreamEnd(agentId: string, sessionId: string, stopReason: string): boolean {
    const session = this.getSessionByAgentId(agentId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) return false;
    try {
      const frame: ServerFrame = { type: "stream_end", session_id: sessionId, stop_reason: stopReason };
      session.ws.send(serializeFrame(frame));
      return true;
    } catch {
      return false;
    }
  }

  pushToolCall(agentId: string, toolCallId: string, name: string, args: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      const session = this.getSessionByAgentId(agentId);
      if (!session || session.ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`No active WS connection for agent ${agentId}`));
        return;
      }

      const timeout = setTimeout(() => {
        this.toolCallResolvers.delete(toolCallId);
        reject(new Error(`Tool call ${toolCallId} timed out for agent ${agentId}`));
      }, 48 * 60 * 60 * 1000);

      this.toolCallResolvers.set(toolCallId, { resolve, reject, timer: timeout });

      const frame: ServerFrame = {
        type: "tool_call",
        id: toolCallId,
        payload: { name, args },
      };
      session.ws.send(serializeFrame(frame));
    });
  }

  cancelRun(agentId: string, runId: string): void {
    this.emit("cancel", { agentId, runId });
  }

  getActiveConnectionCount(): number {
    return this.sessions.size;
  }

  getObservers(): ReadonlySet<WsSession> {
    return this.observers;
  }

  getHealth(): { connections: number; sessions: Array<{ agentId: string; sessionId: string; lastActivity: number }> } {
    return {
      connections: this.sessions.size,
      sessions: Array.from(this.sessions.values()).map(s => ({
        agentId: s.agentId,
        sessionId: s.sessionId,
        lastActivity: s.lastActivity,
      })),
    };
  }

  shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const session of this.sessions.values()) {
      try {
        session.ws.close(1001, "Server shutting down");
      } catch { /* ignore */ }
    }
    this.sessions.clear();
    this.observers.clear();

    for (const resolver of this.toolCallResolvers.values()) {
      clearTimeout(resolver.timer);
      resolver.reject(new Error("Server shutting down"));
    }
    this.toolCallResolvers.clear();

    return new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

export function emitEvent(event: string, data: unknown): void {
  (globalThis as any).__operant_ws_gateway?.emit(event, data);
}

let wsGateway: WsGateway | null = null;

export function getWsGateway(): WsGateway {
  if (!wsGateway) {
    wsGateway = new WsGateway();
    (globalThis as any).__operant_ws_gateway = wsGateway;
  }
  return wsGateway;
}

export function resetWsGateway(): void {
  wsGateway = null;
  delete (globalThis as any).__operant_ws_gateway;
}
