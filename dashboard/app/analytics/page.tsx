'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { BarChart3, TrendingUp, Zap, DollarSign, AlertCircle } from 'lucide-react';

interface DailyUsageRow {
  day: string;
  tokens: number;
  calls: number;
  cost: number;
}

interface AgentCostRow {
  name: string;
  value: number;
  color: string;
  tokens?: number;
}

interface AnalyticsData {
  dailyUsage: DailyUsageRow[];
  agentCosts: AgentCostRow[];
  summary: {
    totalTasks: number;
    activeProjects: number;
    activeCampaigns: number;
    messages: number;
    notes: number;
  };
}

const FALLBACK_DAILY_USAGE: DailyUsageRow[] = [
  { day: 'Mon', tokens: 0, calls: 0, cost: 0 },
  { day: 'Tue', tokens: 0, calls: 0, cost: 0 },
  { day: 'Wed', tokens: 0, calls: 0, cost: 0 },
  { day: 'Thu', tokens: 0, calls: 0, cost: 0 },
  { day: 'Fri', tokens: 0, calls: 0, cost: 0 },
  { day: 'Sat', tokens: 0, calls: 0, cost: 0 },
  { day: 'Sun', tokens: 0, calls: 0, cost: 0 },
];

const FALLBACK_AGENT_COSTS: AgentCostRow[] = [
  { name: 'CEO', value: 0, color: '#3b82f6' },
  { name: 'COO', value: 0, color: '#10b981' },
  { name: 'CMO', value: 0, color: '#f59e0b' },
  { name: 'CFO', value: 0, color: '#8b5cf6' },
  { name: 'Other', value: 0, color: '#6b7280' },
];

function SkeletonChart() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-zinc-700 rounded w-1/3" />
      <div className="h-[250px] bg-zinc-800 rounded" />
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/analytics')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to fetch');
        return r.json();
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const dailyUsage = data?.dailyUsage ?? FALLBACK_DAILY_USAGE;
  const agentCosts = data?.agentCosts ?? FALLBACK_AGENT_COSTS;
  const _summary = data?.summary ?? { totalTasks: 0, activeProjects: 0, activeCampaigns: 0, messages: 0, notes: 0 };

  const totalTokens = dailyUsage.reduce((s, d) => s + d.tokens, 0);
  const totalCalls = dailyUsage.reduce((s, d) => s + d.calls, 0);
  const totalCost = dailyUsage.reduce((s, d) => s + d.cost, 0);
  const avgDaily = dailyUsage.length > 0 ? Math.round(totalTokens / dailyUsage.length) : 0;

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Usage Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Agent usage metrics, costs, and performance
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-card-bg border border-card-border rounded-xl px-5 py-4">
              <div className="h-8 bg-zinc-700 rounded w-2/3" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        <SkeletonChart />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Usage Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Agent usage metrics, costs, and performance
          </p>
        </div>
        <div className="flex items-center gap-3 p-6 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300">Unable to load analytics. Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Usage Analytics</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Agent usage metrics, costs, and performance
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-8">
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-amber-500" />
            <div>
              <p className="text-2xl font-semibold">{(totalTokens / 1000).toFixed(1)}k</p>
              <p className="text-xs text-zinc-500">Tokens (Week)</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <div>
              <p className="text-2xl font-semibold">{totalCalls}</p>
              <p className="text-xs text-zinc-500">API Calls</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-2xl font-semibold">${totalCost.toFixed(2)}</p>
              <p className="text-xs text-zinc-500">Total Cost</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-purple-500" />
            <div>
              <p className="text-2xl font-semibold">{(avgDaily / 1000).toFixed(1)}k</p>
              <p className="text-xs text-zinc-500">Avg Daily Tokens</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2 mb-8">
        {/* Token Usage Chart */}
        <div className="bg-card-bg border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-medium mb-4">Daily Token Usage</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={dailyUsage}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="#a1a1aa" />
              <YAxis tick={{ fontSize: 12 }} stroke="#a1a1aa" />
              <Tooltip />
              <Bar dataKey="tokens" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* API Calls Chart */}
        <div className="bg-card-bg border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-medium mb-4">API Calls Trend</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={dailyUsage}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="#a1a1aa" />
              <YAxis tick={{ fontSize: 12 }} stroke="#a1a1aa" />
              <Tooltip />
              <Line type="monotone" dataKey="calls" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cost Breakdown */}
      <div className="bg-card-bg border border-card-border rounded-xl p-5">
        <h2 className="text-sm font-medium mb-4">Cost by Agent</h2>
        <div className="flex gap-8">
          <ResponsiveContainer width="50%" height={250}>
            <PieChart>
              <Pie data={agentCosts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {agentCosts.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {agentCosts.map((agent) => (
              <div key={agent.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: agent.color }} />
                  <span className="text-sm">{agent.name}</span>
                </div>
                <span className="text-sm font-medium">{agent.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
