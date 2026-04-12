'use client';

import { useState } from 'react';
import { Cpu, Play, Square, Clock, Activity, Zap, Database } from 'lucide-react';
import { useWebSocket } from '@/lib/ws-client';

const AGENTS = ['ceo', 'coo', 'cpo', 'cro', 'cfo', 'cmo', 'cio', 'physician'];

interface Session {
  id: string;
  agentId: string;
  status: 'running' | 'idle' | 'waiting' | 'error';
  startedAt: Date;
  lastActivity: Date;
  toolCalls: number;
  tokensUsed: number;
}

export default function SessionsPage() {
  const [sessions] = useState<Session[]>([
    { id: 's1', agentId: 'ceo', status: 'running', startedAt: new Date(Date.now() - 7200000), lastActivity: new Date(Date.now() - 30000), toolCalls: 42, tokensUsed: 15420 },
    { id: 's2', agentId: 'coo', status: 'idle', startedAt: new Date(Date.now() - 3600000), lastActivity: new Date(Date.now() - 600000), toolCalls: 18, tokensUsed: 8900 },
    { id: 's3', agentId: 'cmo', status: 'waiting', startedAt: new Date(Date.now() - 1800000), lastActivity: new Date(Date.now() - 120000), toolCalls: 5, tokensUsed: 2100 },
    { id: 's4', agentId: 'cfo', status: 'running', startedAt: new Date(Date.now() - 5400000), lastActivity: new Date(Date.now() - 10000), toolCalls: 67, tokensUsed: 23500 },
  ]);

  const { isConnected, subscribe } = useWebSocket({
    url: `ws://${typeof window !== 'undefined' ? window.location.host : 'localhost:3000'}/api/ws`,
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
    </div>
  );
}
