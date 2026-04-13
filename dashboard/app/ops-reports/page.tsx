'use client';

import { Clock, CheckCircle, AlertCircle, Timer, Calendar } from 'lucide-react';
import { useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

interface OpsReport {
  id: string;
  agent_id: string;
  period: string | null;
  summary: string | null;
  metrics: Record<string, unknown> | null;
  actions: Record<string, unknown> | null;
  created_at: string;
}

const statusConfig = {
  success: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950' },
  failed: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950' },
  running: { icon: Timer, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950' },
};

export default function OpsReportsPage() {
  const [reports, setReports] = useState<OpsReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/crud/ops-reports?limit=50&sort=created_at&order=desc')
      .then(r => r.json())
      .then(data => {
        setReports(data.data?.items || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load ops reports:', err);
        setLoading(false);
      });
  }, []);

  const statusCounts = reports.reduce(
    (acc, r) => {
      const status = r.metrics?.status as string | undefined || 'success';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Operations Reports</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Scheduled jobs and system task status
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-blue-500" />
            <div>
              <p className="text-2xl font-semibold">{loading ? '...' : reports.length}</p>
              <p className="text-xs text-zinc-500">Total Jobs</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-2xl font-semibold">{loading ? '...' : (statusCounts.success || 0)}</p>
              <p className="text-xs text-zinc-500">Healthy</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <div>
              <p className="text-2xl font-semibold">{loading ? '...' : (statusCounts.failed || 0)}</p>
              <p className="text-xs text-zinc-500">Failed</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card-bg border border-card-border rounded-xl">
        <div className="px-5 py-4 border-b border-card-border flex items-center gap-2">
          <Clock className="w-4 h-4" />
          <h2 className="text-sm font-medium">Scheduled Jobs</h2>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-zinc-500">
              <th className="text-left px-5 py-3 font-medium">Job</th>
              <th className="text-left px-5 py-3 font-medium">Schedule</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Last Run</th>
              <th className="text-left px-5 py-3 font-medium">Next Run</th>
              <th className="text-left px-5 py-3 font-medium">Avg Duration</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-zinc-500">
                  Loading reports...
                </td>
              </tr>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-zinc-500">
                  No reports found
                </td>
              </tr>
            ) : (
              reports.map((report) => {
                const status = (report.metrics?.status as string) || 'success';
                const { icon: StatusIcon, color, bg } = statusConfig[status as keyof typeof statusConfig] || statusConfig.success;
                return (
                  <tr key={report.id} className="border-b border-card-border last:border-b-0">
                    <td className="px-5 py-3 font-medium">{report.agent_id}</td>
                    <td className="px-5 py-3 font-mono text-xs">{report.period || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${color} ${bg}`}>
                        <StatusIcon className="w-3 h-3" />
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-zinc-500 text-xs">{new Date(report.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3 text-zinc-500 text-xs">—</td>
                    <td className="px-5 py-3 text-xs font-mono">{report.summary || '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
