import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    positive: boolean;
  };
  subtitle?: string;
  className?: string;
}

export function StatCard({ title, value, icon: Icon, trend, subtitle, className = '' }: StatCardProps) {
  return (
    <div className={`bg-card-bg border border-card-border rounded-xl p-5 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-500">{title}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          {trend && (
            <p className={`mt-1 text-xs ${trend.positive ? 'text-emerald-600' : 'text-red-600'}`}>
              {trend.positive ? '+' : ''}{trend.value}% from last week
            </p>
          )}
          {subtitle && <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>}
        </div>
        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
      </div>
    </div>
  );
}
