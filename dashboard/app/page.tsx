import { Suspense } from "react";
import { FolderKanban, CheckSquare, Heart, TrendingUp, ArrowRight } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatCurrency } from "@/lib/formatters";
import { getDailyBriefingData } from "@/lib/server/daily-briefing";

function BriefingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 rounded-md bg-hover animate-pulse" />
      <div className="h-4 w-32 rounded-md bg-hover animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-hover animate-pulse" />
        ))}
      </div>
    </div>
  );
}

async function BriefingContent() {
  const data = await getDailyBriefingData();

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Projects"
          value={data.activeProjects}
          icon={FolderKanban}
          subtitle="In progress"
        />
        <StatCard
          title="Due Tasks"
          value={data.dueTasks}
          icon={CheckSquare}
          trend={{ value: data.dueTasks > 5 ? 12 : 0, direction: data.dueTasks > 5 ? "down" : "up" }}
        />
        <StatCard
          title="Health Score"
          value={`${data.healthScore}%`}
          icon={Heart}
          trend={{ value: data.healthScore > 70 ? 5 : -3, direction: data.healthScore > 70 ? "up" : "down" }}
        />
        <StatCard
          title="Today&apos;s Income"
          value={formatCurrency(data.todayIncome)}
          icon={TrendingUp}
        />
      </div>

      <Card>
        <CardContent className="pt-5">
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-4">
            Quick Actions
          </h2>
          <div className="flex flex-wrap gap-2">
            <a
              href="/projects"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-primary hover:bg-hover/50 transition-colors"
            >
              View Projects
              <ArrowRight className="h-3.5 w-3.5 text-text-muted" />
            </a>
            <a
              href="/kanban"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-primary hover:bg-hover/50 transition-colors"
            >
              Open Kanban
              <ArrowRight className="h-3.5 w-3.5 text-text-muted" />
            </a>
            <a
              href="/people"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-primary hover:bg-hover/50 transition-colors"
            >
              People Directory
              <ArrowRight className="h-3.5 w-3.5 text-text-muted" />
            </a>
            <a
              href="/financial"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-primary hover:bg-hover/50 transition-colors"
            >
              Financial Dashboard
              <ArrowRight className="h-3.5 w-3.5 text-text-muted" />
            </a>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export default async function HomePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {formatDate(new Date(), "EEEE, MMMM d, yyyy")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">Your daily overview</p>
      </div>

      <Suspense fallback={<BriefingSkeleton />}>
        <BriefingContent />
      </Suspense>
    </div>
  );
}
