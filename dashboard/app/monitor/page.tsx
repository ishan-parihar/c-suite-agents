import { Activity } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function MonitorPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Project Monitor</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Real-time project metrics and alerts
        </p>
      </div>

      <div className="bg-card-bg border border-card-border rounded-xl px-5 py-12 text-center">
        <Activity className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">Monitor Coming Soon</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Real-time project monitoring with v_project_monitor view integration
        </p>
      </div>
    </div>
  );
}
