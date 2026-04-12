import { Activity, Server, Users, Wifi, WifiOff, AlertTriangle, CheckCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

async function getHealthData() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export default async function DoctorPage() {
  const health = await getHealthData();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">System Doctor</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Agent health, WebSocket status, and system diagnostics
        </p>
      </div>

      {/* Connection Status */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            {health?.wsConnected ? (
              <Wifi className="w-5 h-5 text-green-500" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-500" />
            )}
            <div>
              <p className="text-sm font-medium">WebSocket</p>
              <p className="text-xs text-zinc-500">
                {health?.wsConnected ? 'Connected' : 'Disconnected'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-blue-500" />
            <div>
              <p className="text-sm font-medium">Connected Clients</p>
              <p className="text-xs text-zinc-500">{health?.clientCount ?? 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Server className="w-5 h-5 text-purple-500" />
            <div>
              <p className="text-sm font-medium">Active Agents</p>
              <p className="text-xs text-zinc-500">
                {health?.agents?.filter((a: { agentId: string }) => a.agentId)?.length ?? 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Health Table */}
      <div className="bg-card-bg border border-card-border rounded-xl">
        <div className="px-5 py-4 border-b border-card-border">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Agent Health
          </h2>
        </div>

        {health?.agents && health.agents.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-zinc-500">
                <th className="text-left px-5 py-3 font-medium">Agent</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Last Heartbeat</th>
                <th className="text-left px-5 py-3 font-medium">Connected Since</th>
              </tr>
            </thead>
            <tbody>
              {health.agents.map((agent: { agentId: string; isAuthenticated: boolean; lastHeartbeat: string; connectedAt: string; stale: boolean }) => (
                <tr key={agent.agentId} className="border-b border-card-border last:border-b-0">
                  <td className="px-5 py-3 font-mono text-xs">{agent.agentId}</td>
                  <td className="px-5 py-3">
                    {agent.stale ? (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="w-3 h-3" />
                        Stale
                      </span>
                    ) : agent.isAuthenticated ? (
                      <span className="inline-flex items-center gap-1 text-green-600">
                        <CheckCircle className="w-3 h-3" />
                        Healthy
                      </span>
                    ) : (
                      <span className="text-zinc-500">Unauthenticated</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-zinc-500">
                    {agent.lastHeartbeat ? formatDuration(Date.now() - new Date(agent.lastHeartbeat).getTime()) : '—'}
                  </td>
                  <td className="px-5 py-3 text-zinc-500">
                    {agent.connectedAt ? new Date(agent.connectedAt).toLocaleTimeString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-5 py-12 text-center">
            <Activity className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">No Agents Connected</h2>
            <p className="text-sm text-zinc-500 mt-1">
              No agents are currently connected via WebSocket
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
