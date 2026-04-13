'use client';

import { useState, useEffect, useCallback } from 'react';
import { Cpu, Play, Square, Clock, Activity, Zap, Database } from 'lucide-react';
import { useWebSocket, getWsUrl } from '@/lib/ws-client';

const AGENTS = ['ceo', 'coo', 'cpo', 'cro', 'cfo', 'cmo', 'cio', 'physician'];

interface Session {
  id: string;
  agentId: string;
  status: 'running' | 'idle' | 'waiting' | 'error';
  startedAt: Date;
  lastActivity: Date;
  toolCalls: number;
  tokensUsed: number;
  model: string;
  contextLength: number;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      const data = await res.json();
      setSessions(data.map((s: any) => ({
        id: s.id,
        agentId: s.agentId,
        status: s.status,
        startedAt: new Date(s.startedAt),
        lastActivity: new Date(s.lastActivity),
        toolCalls: s.toolCalls,
        tokensUsed: s.tokensUsed,
        model: s.model,
        contextLength: s.contextLength,
      })));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load session data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const { isConnected, subscribe } = useWebSocket({
    url: getWsUrl('/api/ws'),
    queryKeys: [['sessions']],
    enabled: true,
  });

  const statusConfig = {
    running: { icon: Play, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950' },
    idle: { icon: Clock, color: 'text-zinc-400', bg: 'bg-zinc-50 dark:bg-zinc-900' },
    waiting: { icon: Activity, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950' },
    error: { icon: Square, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950' },
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">Agent Sessions</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Real-time view of active agent sessions
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {isConnected ? (
            <span className="flex items-center gap-1 text-green-500">
              <Zap className="w-3 h-3" />
              Live
            </span>
          ) : (
            <span className="text-text-muted">Offline</span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-text-secondary">Loading sessions...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl px-5 py-4 mb-8">
          <p className="text-red-600 dark:text-red-400 text-sm">Unable to load session data: {error}</p>
        </div>
      ) : (
        <>
      <div className="grid gap-4 md:grid-cols-4 mb-8">
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Cpu className="w-5 h-5 text-blue-500" />
            <div>
              <p className="text-2xl font-semibold">{sessions.length}</p>
              <p className="text-xs text-text-secondary">Total Sessions</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Play className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-2xl font-semibold">{sessions.filter((s) => s.status === 'running').length}</p>
              <p className="text-xs text-text-secondary">Running</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-purple-500" />
            <div>
              <p className="text-2xl font-semibold">{sessions.reduce((sum, s) => sum + s.toolCalls, 0)}</p>
              <p className="text-xs text-text-secondary">Tool Calls</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-amber-500" />
            <div>
              <p className="text-2xl font-semibold">{(sessions.reduce((sum, s) => sum + s.tokensUsed, 0) / 1000).toFixed(1)}k</p>
              <p className="text-xs text-text-secondary">Tokens Used</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card-bg border border-card-border rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-text-muted">
              <th className="text-left px-5 py-3 font-medium">Agent</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Started</th>
              <th className="text-left px-5 py-3 font-medium">Last Activity</th>
              <th className="text-left px-5 py-3 font-medium">Tool Calls</th>
              <th className="text-left px-5 py-3 font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => {
              const { icon: StatusIcon, color, bg } = statusConfig[session.status];
              return (
                <tr key={session.id} className="border-b border-card-border last:border-b-0">
                  <td className="px-5 py-3 font-mono text-xs uppercase">{session.agentId}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${color} ${bg}`}>
                      <StatusIcon className="w-3 h-3" />
                      {session.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-text-secondary text-xs">
                    {session.startedAt.toLocaleTimeString()}
                  </td>
                  <td className="px-5 py-3 text-text-secondary text-xs">
                    {Math.round((Date.now() - session.lastActivity.getTime()) / 1000)}s ago
                  </td>
                  <td className="px-5 py-3 text-xs">{session.toolCalls}</td>
                  <td className="px-5 py-3 text-xs font-mono">{session.tokensUsed.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}
