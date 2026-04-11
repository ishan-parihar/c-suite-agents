import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useSSE(url: string, queryKeys: string[][]) {
  const queryClient = useQueryClient();
  const reconnectRef = useRef(true);
  const backoffRef = useRef(1000);

  const connect = useCallback(() => {
    const es = new EventSource(url);

    es.onmessage = (e) => {
      JSON.parse(e.data);
      queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      backoffRef.current = 1000;
    };

    es.onerror = () => {
      es.close();
      if (reconnectRef.current) {
        setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, 30000);
      }
    };

    return es;
  }, [url, queryKeys, queryClient]);

  useEffect(() => {
    const es = connect();
    return () => {
      reconnectRef.current = false;
      es.close();
    };
  }, [connect]);
}
