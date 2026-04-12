import { NextResponse } from 'next/server';
import { getWsGateway } from '@/src/transport/ws-server';

export async function GET() {
  const gateway = getWsGateway();
  const clients = gateway.getClients();

  return NextResponse.json({
    wsConnected: gateway.isConnected,
    clientCount: clients.length,
    agents: clients
      .filter((c) => c.agentId)
      .map((c) => ({
        agentId: c.agentId,
        isAuthenticated: c.isAuthenticated,
        connectedAt: c.connectedAt,
        lastHeartbeat: c.lastPong,
        stale: Date.now() - c.lastPong.getTime() > 60_000,
      })),
  });
}
