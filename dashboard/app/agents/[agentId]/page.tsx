import { Suspense } from "react";
import Link from "next/link";
import {
  use, Crown, Cog, Brain, Handshake, Wallet, Sparkles,
  Telescope, Stethoscope, ArrowLeft, Activity, MessageSquare,
  BarChart3, Table2, CheckSquare,
} from "lucide-react";
import { getAgentWorkspaceData } from "@/lib/server/agent-workspace";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ceo: Crown, coo: Cog, cpo: Brain, cro: Handshake,
  cfo: Wallet, cmo: Sparkles, cio: Telescope, physician: Stethoscope,
};

function timeAgo(date: string | null) {
  if (!date) return "Never active";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusLabel(lastActive: string | null, sessionCount: number) {
  if (sessionCount === 0) return { status: "neutral" as const, label: "Not initialized" };
  if (!lastActive) return { status: "warning" as const, label: "Unknown" };
  const hoursSince = (Date.now() - new Date(lastActive).getTime()) / 3600000;
  if (hoursSince < 2) return { status: "healthy" as const, label: "Active" };
  if (hoursSince < 6) return { status: "warning" as const, label: "Delayed" };
  if (hoursSince < 24) return { status: "neutral" as const, label: "Idle" };
  return { status: "critical" as const, label: "Offline" };
}

async function WorkspaceContent({ agentId }: { agentId: string }) {
  const data = await getAgentWorkspaceData(agentId);

  if (!data.config) {
    return (
      <EmptyState
        icon={Activity}
        title="Unknown agent"
        description={`No workspace configured for agent "${agentId}".`}
        action={{ label: "Back to Mission Control", href: "/" }}
      />
    );
  }

  const Icon = ICONS[agentId] ?? Crown;
  const st = statusLabel(data.status.lastActive, data.status.sessionCount);

  return (
    <div className="space-y-6">
      {/* Agent Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-lg border border-border bg-surface flex items-center justify-center shrink-0">
          <Icon className="w-6 h-6 text-text-muted" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold text-text-primary">
              {data.config.name}
            </h1>
            <Badge status={st.status}>{st.label}</Badge>
          </div>
          <p className="text-sm text-text-secondary mt-0.5">{data.config.role}</p>
          <p className="text-sm text-text-muted mt-1 max-w-xl">{data.config.description}</p>
          <p className="text-xs text-text-muted mt-2">
            Last active: {timeAgo(data.status.lastActive)} &middot; {data.status.sessionCount} sessions &middot; {data.status.reportCount} reports
          </p>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          title="Active Cards"
          value={data.status.kanbanCards}
          icon={CheckSquare}
        />
        <StatCard
          title="Pending Messages"
          value={data.status.pendingMessages}
          icon={MessageSquare}
        />
        <StatCard
          title="Sessions"
          value={data.status.sessionCount}
          icon={Activity}
        />
        <StatCard
          title="Reports"
          value={data.status.reportCount}
          icon={BarChart3}
        />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Threads */}
        <div>
          <h2 className="font-heading text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Active Threads
          </h2>
          {data.recentMessages.length === 0 ? (
            <div className="rounded-md border border-border px-4 py-8 text-sm text-text-muted">
              No unread threads.
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              {data.recentMessages.map((msg: Record<string, unknown>, i: number) => (
                <div
                  key={String(msg.id)}
                  className={`px-4 py-2.5 text-sm ${i > 0 ? "border-t border-border/50" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-text-primary truncate">{String(msg.subject || "Untitled")}</span>
                    <span className="text-xs text-text-muted ml-2 shrink-0 tabular">
                      {msg.created_at ? new Date(String(msg.created_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Reports */}
        <div>
          <h2 className="font-heading text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Recent Reports
          </h2>
          {data.recentReports.length === 0 ? (
            <div className="rounded-md border border-border px-4 py-8 text-sm text-text-muted">
              No reports yet.
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              {data.recentReports.map((report: Record<string, unknown>, i: number) => (
                <div
                  key={String(report.id)}
                  className={`px-4 py-2.5 text-sm ${i > 0 ? "border-t border-border/50" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary truncate">
                      {report.period ? `Period: ${String(report.period)}` : "Report"}
                    </span>
                    <span className="text-xs text-text-muted ml-2 shrink-0 tabular">
                      {report.created_at ? new Date(String(report.created_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ""}
                    </span>
                  </div>
                  {report.summary && (
                    <p className="text-xs text-text-muted mt-1 truncate">
                      {String(report.summary)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Relevant Tables */}
      <div>
        <h2 className="font-heading text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
          {data.config.domain}
        </h2>
        <div className="flex flex-wrap gap-2">
          {data.config.relevantTables.map((t) => (
            <Link
              key={t.slug}
              href={`/database/${t.slug}`}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
            >
              <Table2 className="w-3.5 h-3.5" />
              {t.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-lg border border-border bg-surface animate-pulse" />
        <div className="space-y-2 flex-1">
          <div className="h-6 w-32 rounded bg-hover animate-pulse" />
          <div className="h-4 w-48 rounded bg-hover animate-pulse" />
          <div className="h-4 w-64 rounded bg-hover animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-md bg-surface animate-pulse border border-border" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-48 rounded-md bg-surface animate-pulse border border-border" />
        <div className="h-48 rounded-md bg-surface animate-pulse border border-border" />
      </div>
    </div>
  );
}

export default async function AgentWorkspacePage(props: { params: Promise<{ agentId: string }> }) {
  const params = use(props.params);
  const Icon = ICONS[params.agentId] ?? Crown;

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-colors mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Mission Control
      </Link>

      <Suspense fallback={<WorkspaceSkeleton />}>
        <WorkspaceContent agentId={params.agentId} />
      </Suspense>
    </div>
  );
}
