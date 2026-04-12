import { NextRequest } from 'next/server';
import { getWsGateway } from '@/src/transport/ws-server';

// WebSocket upgrade route — returns gateway status for discovery/health check
export async function GET(request: NextRequest) {
  const upgrade = request.headers.get('upgrade');

  if (upgrade?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const gateway = getWsGateway();

  return new Response(JSON.stringify({
    status: 'ok',
    clients: gateway.clientCount,
    connected: gateway.isConnected,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
