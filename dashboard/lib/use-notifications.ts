import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useWebSocket, getWsUrl } from './ws-client';
import type { WsEventPayload, WsNotificationPayload } from '@/src/transport/ws-types';

const toastTypeMap: Record<string, typeof toast.info> = {
  info: toast.info,
  success: toast.success,
  warning: toast.warning,
  error: toast.error,
};

export function useNotifications() {
  const handleNotification = useCallback((notification: WsNotificationPayload) => {
    const toastFn = toastTypeMap[notification.type] ?? toast.info;
    toastFn(notification.title, {
      description: notification.message,
      action: notification.action
        ? {
            label: notification.action.label,
            onClick: () => window.location.assign(notification.action!.href),
          }
        : undefined,
    });
  }, []);

  const { isConnected, subscribe } = useWebSocket({
    url: getWsUrl('/api/ws'),
    queryKeys: [['notifications']],
    onEvent: (event: WsEventPayload) => {
      toast.info(`Event: ${event.eventType}`, {
        description: `${event.entityType} ${event.entityId}`,
      });
    },
    onNotification: handleNotification,
  });

  useEffect(() => {
    if (isConnected) {
      subscribe(['*']);
    }
  }, [isConnected, subscribe]);

  return { isConnected };
}
