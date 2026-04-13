'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, Key, Wrench, Settings as SettingsIcon, Globe, FileText, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardContent } from '@/components/ui/card';

const AGENTS = [
  { id: 'ceo', name: 'CEO', role: 'Strategic Leadership' },
  { id: 'coo', name: 'COO', role: 'Operations' },
  { id: 'cpo', name: 'CPO', role: 'Psychology' },
  { id: 'cro', name: 'CRO', role: 'Relations' },
  { id: 'cfo', name: 'CFO', role: 'Finance' },
  { id: 'cmo', name: 'CMO', role: 'Content' },
  { id: 'cio', name: 'CIO', role: 'Intelligence' },
  { id: 'physician', name: 'Physician', role: 'Health' },
];

const PERMISSIONS = [
  { key: 'bash', label: 'Bash Execution', icon: Wrench },
  { key: 'web', label: 'Web Access', icon: Globe },
  { key: 'file', label: 'File System', icon: FileText },
  { key: 'db', label: 'Database', icon: Key },
];

interface AgentConfig {
  permissions: Record<string, boolean>;
  model: string;
  maxTokens: number;
}

interface AgentResponse {
  id: string;
  name: string;
  role: string;
  model: string;
  maxTokens: number;
  permissions: Record<string, boolean>;
}

async function patchConfig(agentId: string, config: AgentConfig): Promise<{ success: boolean }> {
  const res = await fetch('/api/agent-config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, config }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to save config');
  }
  return res.json();
}

export default function SettingsPage() {
  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0].id);
  const [configs, setConfigs] = useState<Record<string, AgentConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/agent-config')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { agents: AgentResponse[] }) => {
        const map: Record<string, AgentConfig> = {};
        for (const a of data.agents) {
          map[a.id] = {
            permissions: a.permissions,
            model: a.model,
            maxTokens: a.maxTokens,
          };
        }
        setConfigs(map);
        setError(null);
      })
      .catch((err) => {
        setError(err.message ?? 'Failed to load agent configurations');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const persistAndSet = useCallback(
    async (agentId: string, updater: (prev: AgentConfig) => AgentConfig) => {
      setSaving(true);
      try {
        setConfigs((prev) => {
          const current = prev[agentId];
          if (!current) return prev;
          const next = updater(current);
          patchConfig(agentId, next).catch(() => {});
          return { ...prev, [agentId]: next };
        });
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const togglePermission = (key: string) => {
    persistAndSet(selectedAgent, (prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] },
    }));
  };

  const config = configs[selectedAgent];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Loader2 className="w-6 h-6 text-text-muted animate-spin mx-auto" />
          <p className="text-sm text-text-muted">Loading agent configurations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <AlertCircle className="w-6 h-6 text-red-500 mx-auto" />
          <p className="text-sm text-text-muted">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              window.location.reload();
            }}
            className="text-sm text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Agent Configuration</h1>
        <p className="text-sm text-text-secondary mt-1">
          Manage agent permissions, models, and tool access
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Agent List */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-text-muted" />
            <h2 className="text-sm font-medium text-text-primary">Agents</h2>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {AGENTS.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 transition-colors',
                    selectedAgent === agent.id
                      ? 'bg-elevated'
                      : 'hover:bg-hover'
                  )}
                >
                  <p className="text-sm font-medium text-text-primary">{agent.name}</p>
                  <p className="text-xs text-text-muted">{agent.role}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Config Panel */}
        <div className="md:col-span-2 space-y-6">
          {/* Permissions */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-text-muted" />
              <h2 className="text-sm font-medium text-text-primary">Permissions</h2>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {PERMISSIONS.map(({ key, label, icon: Icon }) => (
                  <div key={key} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-text-muted" />
                      <span className="text-sm text-text-secondary">{label}</span>
                    </div>
                    <button
                      onClick={() => togglePermission(key)}
                      className={cn(
                        'relative w-10 h-5 rounded-full transition-colors',
                        config.permissions[key] ? 'bg-accent' : 'bg-text-muted/40'
                      )}
                      role="switch"
                      aria-checked={config.permissions[key]}
                      aria-label={label}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform',
                          config.permissions[key] ? 'translate-x-5' : ''
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Model Settings */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-text-muted" />
              <h2 className="text-sm font-medium text-text-primary">Model Settings</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm text-text-muted">Model</label>
                <select
                  value={config.model}
                  onChange={(e) =>
                    persistAndSet(selectedAgent, (prev) => ({ ...prev, model: e.target.value }))
                  }
                  className="mt-1 w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
                >
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="claude-3">Claude 3</option>
                  <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-text-muted">Max Tokens</label>
                <input
                  type="number"
                  value={config.maxTokens}
                  onChange={(e) =>
                    persistAndSet(selectedAgent, (prev) => ({
                      ...prev,
                      maxTokens: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                  className="mt-1 w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
