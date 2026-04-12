import { Clock, CheckCircle, AlertCircle, Timer, Calendar } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface Job {
  id: string;
  name: string;
  cron: string;
  lastRun: string;
  lastStatus: 'success' | 'failed' | 'running';
  nextRun: string;
  avgDuration: string;
}

const JOBS: Job[] = [
  { id: 'j1', name: 'Daily Digest', cron: '0 8 * * *', lastRun: '2026-04-12 08:00', lastStatus: 'success', nextRun: '2026-04-13 08:00', avgDuration: '2m 14s' },
  { id: 'j2', name: 'Weekly Report', cron: '0 9 * * 1', lastRun: '2026-04-07 09:00', lastStatus: 'success', nextRun: '2026-04-14 09:00', avgDuration: '5m 32s' },
  { id: 'j3', name: 'Health Check', cron: '*/5 * * * *', lastRun: '2026-04-12 14:35', lastStatus: 'running', nextRun: '2026-04-12 14:40', avgDuration: '8s' },
  { id: 'j4', name: 'Data Sync', cron: '0 */6 * * *', lastRun: '2026-04-12 12:00', lastStatus: 'failed', nextRun: '2026-04-12 18:00', avgDuration: '1m 45s' },
  { id: 'j5', name: 'Cache Cleanup', cron: '0 2 * * *', lastRun: '2026-04-12 02:00', lastStatus: 'success', nextRun: '2026-04-13 02:00', avgDuration: '30s' },
];

const statusConfig = {
  success: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950' },
  failed: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950' },
  running: { icon: Timer, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950' },
};

export default function OpsReportsPage() {
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
              <p className="text-2xl font-semibold">{JOBS.length}</p>
              <p className="text-xs text-zinc-500">Total Jobs</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-2xl font-semibold">{JOBS.filter((j) => j.lastStatus === 'success').length}</p>
              <p className="text-xs text-zinc-500">Healthy</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <div>
              <p className="text-2xl font-semibold">{JOBS.filter((j) => j.lastStatus === 'failed').length}</p>
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
            {JOBS.map((job) => {
              const { icon: StatusIcon, color, bg } = statusConfig[job.lastStatus];
              return (
                <tr key={job.id} className="border-b border-card-border last:border-b-0">
                  <td className="px-5 py-3 font-medium">{job.name}</td>
                  <td className="px-5 py-3 font-mono text-xs">{job.cron}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${color} ${bg}`}>
                      <StatusIcon className="w-3 h-3" />
                      {job.lastStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-zinc-500 text-xs">{job.lastRun}</td>
                  <td className="px-5 py-3 text-zinc-500 text-xs">{job.nextRun}</td>
                  <td className="px-5 py-3 text-xs font-mono">{job.avgDuration}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
