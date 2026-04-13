import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Daemon WebSocket frame types.
 * Defined inline — dashboard must NOT import from daemon source.
 */
interface DaemonFrame {
  type: 'auth_ok' | 'auth_error' | 'message' | 'stream_chunk' | 'stream_end' | 'tool_call' | 'ping' | 'pong';
  session_id?: string;
  reason?: string;
  payload?: Record<string, unknown>;
  seq?: number;
}

/**
 * Construct a WebSocket URL that matches the current page protocol.
 *
 * In development, connects to operant daemon on port 3001.
 * In production, uses environment variable NEXT_PUBLIC_WS_URL or falls back to same-host /ws.
 */
export function getWsUrl(path: string = '/ws'): string {
  if (typeof window === 'undefined') {
    return `ws://localhost:3000${path}`;
  }

  const envWsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envWsUrl) {
    return envWsUrl;
  }

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:3001/ws';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

interface UseWebSocketOptions {
  url: string;
  queryKeys?: string[][];
  onEvent?: (event: any) => void;
  onNotification?: (notification: any) => void;
  enabled?: boolean;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  isAuthed: boolean;
  subscribe: (eventTypes: string[]) => void;
  unsubscribe: (eventTypes: string[]) => void;
}

export function useWebSocket({
  url,
  queryKeys = [],
  onEvent,
  onNotification,
  enabled = true,
}: UseWebSocketOptions): UseWebSocketReturn {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const reconnectRef = useRef(true);
  const backoffRef = useRef(1000);
  const urlRef = useRef(url);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const subscribe = useCallback((_eventTypes: string[]) => {}, []);
  const unsubscribe = useCallback((_eventTypes: string[]) => {}, []);

  const connect = useCallback(() => {
    if (!enabled) return;

    const ws = new WebSocket(urlRef.current);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      backoffRef.current = 1000;
      ws.send(JSON.stringify({ type: 'auth', agent_id: 'dashboard', token: '' }));
    };

    ws.onmessage = (e) => {
      try {
        const frame = JSON.parse(e.data) as DaemonFrame;

        switch (frame.type) {
          case 'auth_ok':
            setIsAuthed(true);
            break;

          case 'auth_error':
            console.error('[WS] Auth error:', frame.reason);
            setIsAuthed(false);
            break;

          case 'message':
          case 'stream_chunk':
          case 'stream_end':
            if (queryKeys.length > 0) {
              queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'ping' }));
            break;

          case 'tool_call':
          case 'pong':
            break;

          default:
            break;
        }
      } catch {
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
  }, [enabled, queryKeys, queryClient]);

  useEffect(() => {
    if (!enabled) return;

    connect();

    return () => {
      reconnectRef.current = false;
      wsRef.current?.close();
    };
  }, [connect, enabled]);

  return { isConnected, isAuthed, subscribe, unsubscribe };
}
