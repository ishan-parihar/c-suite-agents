import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { logger } from "../logger";
import {
  serializeFrame,
  deserializeFrame,
  type ClientFrame,
  type ServerFrame,
  type StreamEvent,
} from "./ws-types";

const DEFAULT_BASE_URL = "ws://127.0.0.1:3001";
const DEFAULT_MAX_RECONNECT_DELAY = 30000;
const DEFAULT_INITIAL_RECONNECT_DELAY = 1000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_JITTER = 0.2;

export interface WsClientOptions {
  baseUrl?: string;
  agentId: string;
  token: string;
  maxReconnectDelay?: number;
  initialReconnectDelay?: number;
  backoffMultiplier?: number;
  jitter?: number;
}

export class WsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: Required<WsClientOptions>;
  private reconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastSeq = 0;
  private pendingToolCalls: Map<string, { resolve: (result: string) => void; reject: (err: Error) => void }> = new Map();
  private manualClose = false;

  constructor(options: WsClientOptions) {
    super();
    this.options = {
      baseUrl: options.baseUrl || DEFAULT_BASE_URL,
      agentId: options.agentId,
      token: options.token,
      maxReconnectDelay: options.maxReconnectDelay || DEFAULT_MAX_RECONNECT_DELAY,
      initialReconnectDelay: options.initialReconnectDelay || DEFAULT_INITIAL_RECONNECT_DELAY,
      backoffMultiplier: options.backoffMultiplier || DEFAULT_BACKOFF_MULTIPLIER,
      jitter: options.jitter || DEFAULT_JITTER,
    };
    this.reconnectDelay = this.options.initialReconnectDelay;
  }

  connect(): void {
    this.manualClose = false;
    this.doConnect();
  }

  private doConnect(): void {
    const url = new URL("/ws", this.options.baseUrl);
    url.searchParams.set("agentId", this.options.agentId);
    url.searchParams.set("token", this.options.token);
    if (this.lastSeq > 0) {
      url.searchParams.set("last_seq", String(this.lastSeq));
    }

    this.ws = new WebSocket(url.toString());

    this.ws.on("open", () => {
      logger.info({ agentId: this.options.agentId }, "WS connected");
      this.reconnectAttempts = 0;
      this.reconnectDelay = this.options.initialReconnectDelay;
    });

    this.ws.on("message", (data) => this.onMessage(data.toString()));

    this.ws.on("close", (code) => {
      logger.info({ agentId: this.options.agentId, code }, "WS closed");
      this.ws = null;
      if (!this.manualClose) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err: Error) => {
      logger.warn({ agentId: this.options.agentId, err: err.message }, "WS error");
    });
  }

  private onMessage(raw: string): void {
    let frame: ServerFrame;
    try {
      frame = deserializeFrame(raw) as unknown as ServerFrame;
    } catch {
      return;
    }

    switch (frame.type) {
      case "auth_ok":
        this.emit("connected", frame.session_id);
        break;

      case "auth_error":
        this.emit("auth_error", frame.reason);
        this.manualClose = true;
        this.ws?.close();
        break;

      case "message":
        this.lastSeq = frame.seq;
        this.emit("message", frame.payload);
        break;

      case "stream_chunk":
        this.emit("stream_chunk", frame.session_id, frame.payload as unknown as StreamEvent);
        break;

      case "stream_end":
        this.emit("stream_end", frame.session_id, frame.stop_reason);
        break;

      case "tool_call": {
        const resolver = this.pendingToolCalls.get(frame.id);
        if (resolver) {
          resolver.resolve(JSON.stringify(frame.payload));
          this.pendingToolCalls.delete(frame.id);
        } else {
          this.emit("tool_call", frame.id, frame.payload);
        }
        break;
      }

      case "pong":
        this.emit("pong");
        break;

      case "reconnect_hint":
        this.lastSeq = frame.last_seq;
        break;

      case "ping":
        this.ws?.send(JSON.stringify({ type: "ping" }));
        break;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const jitter = this.reconnectDelay * this.options.jitter * (Math.random() - 0.5) * 2;
    const delay = Math.min(this.reconnectDelay + jitter, this.options.maxReconnectDelay);

    logger.info({ agentId: this.options.agentId, attempt: this.reconnectAttempts, delayMs: Math.round(delay) }, "Scheduling WS reconnect");
    this.emit("reconnecting", { attempt: this.reconnectAttempts, delayMs: Math.round(delay) });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay *= this.options.backoffMultiplier;
      this.doConnect();
    }, delay);
  }

  sendToolResponse(toolCallId: string, result: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const frame: ClientFrame = { type: "tool_response", id: toolCallId, payload: { result } };
      this.ws.send(serializeFrame(frame as any));
    }
  }

  cancelRun(runId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const frame: ClientFrame = { type: "cancel", run_id: runId };
      this.ws.send(serializeFrame(frame as any));
    }
  }

  close(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000, "Client disconnect");
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
