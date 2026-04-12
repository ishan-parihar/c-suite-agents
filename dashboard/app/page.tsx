import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight, CalendarDays, CheckCircle2,
  FolderKanban, Target, TrendingUp, Users, MessageSquare,
  Crown, Cog, Brain, Handshake, Wallet, Sparkles, Telescope, Stethoscope,
} from "lucide-react";
import { getMissionControlData, type AgentStatus } from "@/lib/server/mission-control";
import { formatCurrency } from "@/lib/formatters";

const AGENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ceo: Crown, coo: Cog, cpo: Brain, cro: Handshake,
  cfo: Wallet, cmo: Sparkles, cio: Telescope, physician: Stethoscope,
};

function timeAgo(date: string | null) {
  if (!date) return "Never";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function AgentStatusBadge({ status }: { status: AgentStatus["status"] }) {
  const map = {
    healthy: { label: "Active", dot: "bg-status-healthy" },
    warning: { label: "Delayed", dot: "bg-status-warning" },
    critical: { label: "Offline", dot: "bg-status-critical" },
    idle: { label: "Idle", dot: "bg-status-neutral" },
  };
  const cfg = map[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      <span className="text-xs text-text-muted">{cfg.label}</span>
    </span>
  );
}

async function MissionControlContent() {
  const data = await getMissionControlData();

  return (
    <div className="space-y-6">
      {/* Agent Status Grid */}
      <div>
        <h2 className="font-heading text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
          Agent Status
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/50 rounded-md border border-border overflow-hidden">
          {data.agents.map((agent) => {
            const Icon = AGENT_ICONS[agent.id] ?? Crown;
            return (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="flex flex-col gap-2 px-3 py-3 bg-surface hover:bg-hover transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <Icon className="w-4 h-4 text-text-muted" />
                  <AgentStatusBadge status={agent.status} />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">{agent.name}</p>
                  <p className="text-xs text-text-muted">{agent.role}</p>
                </div>
                <p className="text-xs text-text-muted">{timeAgo(agent.lastActive)}</p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          icon={FolderKanban}
          value={data.briefing.activeProjects}
          label="Active Projects"
          href="/database/projects"
        />
        <MetricCard
          icon={CheckCircle2}
          value={data.briefing.dueTasks}
          label="Due Tasks"
          href="/database/tasks"
          accent={data.briefing.dueTasks > 5 ? "warning" : undefined}
        />
        <MetricCard
          icon={TrendingUp}
          value={formatCurrency(data.briefing.todayIncome)}
          label="Today's Income"
          href="/database/financial-log"
        />
        <MetricCard
          icon={MessageSquare}
          value={data.unreadMessages}
          label="Unread Messages"
          href="/messages"
          accent={data.unreadMessages > 0 ? "cta" : undefined}
        />
      </div>

      {/* Two-column: Recent + Deadlines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading text-sm font-semibold text-text-muted uppercase tracking-wider">
              Due Soon
            </h2>
            <span className="text-xs text-text-muted">
              {data.upcomingDeadlines} in next 3 days
            </span>
          </div>
          <div className="rounded-md border border-border overflow-hidden">
            {data.recentTasks.length === 0 ? (
              <div className="px-4 py-8 text-sm text-text-muted">All clear — no pending tasks.</div>
            ) : (
              data.recentTasks.map((task: Record<string, unknown>, i: number) => (
                <div
                  key={String(task.id)}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                    i > 0 ? "border-t border-border/50" : ""
                  } hover:bg-hover transition-colors`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    task.priority === 'high' || task.priority === 'urgent' ? 'bg-status-critical' :
                    task.priority === 'medium' ? 'bg-status-warning' : 'bg-status-healthy'
                  }`} />
                  <span className="truncate text-text-primary">{String(task.name || "Unnamed")}</span>
                  <span className="text-xs text-text-muted ml-auto shrink-0 tabular">
                    {task.action_date ? new Date(String(task.action_date)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : "—"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading text-sm font-semibold text-text-muted uppercase tracking-wider">
              Project Health
            </h2>
            <Link
              href="/database/projects"
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
              View all →
            </Link>
          </div>
          <div className="rounded-md border border-border overflow-hidden">
            {data.recentProjects.length === 0 ? (
              <div className="px-4 py-8 text-sm text-text-muted">No active projects.</div>
            ) : (
              data.recentProjects.map((proj: Record<string, unknown>, i: number) => (
                <div
                  key={String(proj.id)}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                    i > 0 ? "border-t border-border/50" : ""
                  } hover:bg-hover transition-colors`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    proj.health === 'healthy' ? 'bg-status-healthy' :
                    proj.health === 'warning' ? 'bg-status-warning' :
                    proj.health === 'critical' ? 'bg-status-critical' : 'bg-status-neutral'
                  }`} />
                  <span className="truncate text-text-primary">{String(proj.name || "Unnamed")}</span>
                  <span className="text-xs text-text-muted ml-auto shrink-0 tabular">
                    {proj.progress != null ? `${Math.round(Number(proj.progress) * 100)}%` : "—"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="font-heading text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
          Quick Access
        </h2>
        <div className="flex flex-wrap gap-2">
          <QuickLink href="/database" icon={Target} label="All Tables" />
          <QuickLink href="/database/tasks" icon={CheckCircle2} label="Tasks" />
          <QuickLink href="/database/projects" icon={FolderKanban} label="Projects" />
          <QuickLink href="/database/people" icon={Users} label="People" />
          <QuickLink href="/database/financial-log" icon={Wallet} label="Financials" />
          <QuickLink href="/database/content-pipeline" icon={Sparkles} label="Content" />
          <QuickLink href="/meetings" icon={CalendarDays} label="Board Meetings" />
          <QuickLink href="/messages" icon={MessageSquare} label="Messages" />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon, value, label, href, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  href: string;
  accent?: "warning" | "cta";
}) {
  return (
    <Link
      href={href}
      className="flex items-baseline gap-3 px-4 py-3 rounded-md border border-border bg-surface hover:bg-hover transition-colors group"
    >
      <Icon className={`w-5 h-5 shrink-0 ${
        accent === "warning" ? "text-status-warning" :
        accent === "cta" ? "text-accent-cta" :
        "text-text-muted"
      }`} />
      <div className="min-w-0">
        <p className="font-heading text-xl font-semibold tabular-nums truncate">{value}</p>
        <p className="text-xs text-text-muted">{label}</p>
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-text-muted ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}

function QuickLink({
  href, icon: Icon, label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </Link>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/50 rounded-md border border-border overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-3 py-3 bg-surface animate-pulse">
            <div className="h-4 w-16 rounded bg-hover mb-2" />
            <div className="h-3 w-12 rounded bg-hover" />
          </div>
        ))}
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

export default async function HomePage() {
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Morning" : now.getHours() < 18 ? "Afternoon" : "Evening";

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          Good {greeting}, Ishan
        </h1>
        <p className="text-sm text-text-secondary mt-0.5">
          {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      <Suspense fallback={<PageSkeleton />}>
        <MissionControlContent />
      </Suspense>
    </div>
  );
}
