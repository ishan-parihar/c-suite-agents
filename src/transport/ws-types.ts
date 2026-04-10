// WebSocket Frame Protocol — Type definitions
// Modeled after OpenClaw Gateway RequestFrame/EventFrame pattern

import type WebSocket from "ws";

// ── Client → Server Frames ──

export type ClientFrame =
  | AuthFrame
  | ToolResponseFrame
  | CancelFrame
  | PingFrame;

export interface AuthFrame {
  type: "auth";
  token: string;
  agent_id: string;
  last_seq?: number;  // For reconnect: last known sequence number
}

export interface ToolResponseFrame {
  type: "tool_response";
  id: string;         // Tool call ID
  payload: {
    result: string;
    [key: string]: unknown;
  };
}

export interface CancelFrame {
  type: "cancel";
  run_id: string;     // Session/run ID to cancel
}

export interface PingFrame {
  type: "ping";
}

// ── Server → Client Frames ──

export type ServerFrame =
  | AuthOkFrame
  | AuthErrorFrame
  | MessageFrame
  | StreamChunkFrame
  | StreamEndFrame
  | ToolCallFrame
  | PongFrame
  | ReconnectHintFrame
  | ServerPingFrame;

export interface AuthOkFrame {
  type: "auth_ok";
  session_id: string;
  seq?: number;       // Current sequence counter for this session
}

export interface AuthErrorFrame {
  type: "auth_error";
  reason: string;
}

export interface MessagePayload {
  message_id: string;
  thread_id: string;
  from: string;
  to: string;
  content: string;
  priority: string;
  requires_response: boolean;
  created_at: number;
  tags?: string[];
}

export interface MessageFrame {
  type: "message";
  payload: MessagePayload;
  seq: number;        // Monotonically increasing sequence number
}

export interface StreamEvent {
  type: "text" | "tool_use" | "usage" | "error";
  content?: string;
  id?: string;
  name?: string;
  input?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StreamChunkFrame {
  type: "stream_chunk";
  session_id: string;
  payload: StreamEvent;
}

export interface StreamEndFrame {
  type: "stream_end";
  session_id: string;
  stop_reason: string;  // "stop" | "tool_calls" | "cancelled" | "timeout" | "error"
}

export interface ToolCallPayload {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallFrame {
  type: "tool_call";
  id: string;
  payload: ToolCallPayload;
}

export interface PongFrame {
  type: "pong";
}

export interface ReconnectHintFrame {
  type: "reconnect_hint";
  last_seq: number;
}

export interface ServerPingFrame {
  type: "ping";
}

// ── WS Session ──

export interface WsSession {
  agentId: string;
  ws: WebSocket;
  seq: number;              // Monotonically increasing sequence for this session
  lastActivity: number;     // Timestamp of last activity
  sessionId: string;        // Unique session identifier
  authenticated: boolean;
  pongReceived: boolean;    // For heartbeat tracking
  consecutiveMissedPongs: number;
  lastSeq?: number;         // Last known seq from client (for reconnect replay)
}

// ── Transport Mode ──

export type TransportMode = "ws" | "sse" | "polling";

// ── Frame Serialization ──

export function serializeFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

export function deserializeFrame(raw: string): ClientFrame {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.type) {
      throw new Error("Missing frame type");
    }
    return parsed as ClientFrame;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid frame: ${msg}`);
  }
}
