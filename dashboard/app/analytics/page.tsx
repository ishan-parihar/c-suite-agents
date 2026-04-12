'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { BarChart3, TrendingUp, Zap, DollarSign } from 'lucide-react';

const DAILY_USAGE = [
  { day: 'Mon', tokens: 12400, calls: 45, cost: 0.48 },
  { day: 'Tue', tokens: 15200, calls: 62, cost: 0.61 },
  { day: 'Wed', tokens: 9800, calls: 38, cost: 0.39 },
  { day: 'Thu', tokens: 18600, calls: 71, cost: 0.74 },
  { day: 'Fri', tokens: 14300, calls: 55, cost: 0.57 },
  { day: 'Sat', tokens: 6200, calls: 22, cost: 0.25 },
  { day: 'Sun', tokens: 8100, calls: 31, cost: 0.32 },
];

const AGENT_COSTS = [
  { name: 'CEO', value: 35, color: '#3b82f6' },
  { name: 'COO', value: 25, color: '#10b981' },
  { name: 'CMO', value: 18, color: '#f59e0b' },
  { name: 'CFO', value: 12, color: '#8b5cf6' },
  { name: 'Other', value: 10, color: '#6b7280' },
];

export default function AnalyticsPage() {
  const totalTokens = DAILY_USAGE.reduce((s, d) => s + d.tokens, 0);
  const totalCalls = DAILY_USAGE.reduce((s, d) => s + d.calls, 0);
  const totalCost = DAILY_USAGE.reduce((s, d) => s + d.cost, 0);
  const avgDaily = Math.round(totalTokens / 7);

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
            <BarChart data={DAILY_USAGE}>
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
            <LineChart data={DAILY_USAGE}>
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
              <Pie data={AGENT_COSTS} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {AGENT_COSTS.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {AGENT_COSTS.map((agent) => (
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
