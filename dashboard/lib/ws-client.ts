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
            if (queryKeys.length > 0) {
              queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
            }
            break;
          case 'notification':
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
