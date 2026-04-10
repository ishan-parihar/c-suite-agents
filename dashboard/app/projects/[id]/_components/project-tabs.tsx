"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatCurrency, formatPercent, formatNumber } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";
import { safeJsonParse, clamp } from "@/lib/utils";

const TABS = ["overview", "monitor", "progress", "budget", "risks", "opportunities", "activity"] as const;
type TabId = (typeof TABS)[number];

const statusToBadge: Record<string, StatusKey> = {
  "On Track": "healthy",
  "At Risk": "warning",
  "Off Track": "critical",
};

interface ProjectTabsProps {
  project: ReturnType<typeof import("@/lib/server/projects").getProjectDetail> extends Promise<infer T> ? T : never;
  tasks: ReturnType<typeof import("@/lib/server/projects").getProjectTasks> extends Promise<infer T> ? T : never;
  financialLog: ReturnType<typeof import("@/lib/server/projects").getProjectFinancialLog> extends Promise<infer T> ? T : never;
}

function getDeadlineDays(deadline: string | null): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function calcTimeProgress(start: string | null, deadline: string | null): number | null {
  if (!start || !deadline) return null;
  const s = new Date(start).getTime();
  const d = new Date(deadline).getTime();
  const now = Date.now();
  if (isNaN(s) || isNaN(d) || d <= s) return null;
  return clamp(((now - s) / (d - s)) * 100, 0, 100);
}

export function ProjectTabs({ project, tasks, financialLog }: ProjectTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get("tab") as TabId) || "overview";

  if (!project) {
    return <Skeleton variant="card" lines={6} />;
  }

  const statusKey = statusToBadge[project.status ?? ""] ?? "neutral";
  const deadlineDays = getDeadlineDays(project.deadline);
  const timeProgress = calcTimeProgress(project.projectStart, project.deadline);
  const progressVal = typeof project.progress === "number" ? project.progress : null;
  const pacing =
    progressVal != null && timeProgress != null
      ? progressVal > timeProgress + 5
        ? "Ahead"
        : progressVal < timeProgress - 5
          ? "Behind"
          : "On Track"
      : null;

  const completedTasks = tasks?.filter((t) => t.status === "Completed" || t.status === "Done") ?? [];
  const recentActivity = [...(tasks ?? [])]
    .sort((a, b) => {
      const da = a.completedDate ? new Date(a.completedDate).getTime() : 0;
      const db = b.completedDate ? new Date(b.completedDate).getTime() : 0;
      return db - da;
    })
    .slice(0, 20);

  const handleTabChange = (tab: TabId) => {
    router.replace(`?tab=${tab}`);
  };

  const projectJson = safeJsonParse<Record<string, unknown>>(project.projectJson, {});
  const directivesRisks = projectJson?.directives_risks ?? null;
  const people = safeJsonParse<Array<{ name?: string; role?: string }>>(project.people, []);
  const teamMembers = Array.isArray(project.team) ? project.team : people;

  return (
    <div>
      <div className="mb-6">
        <a href="/projects" className="text-sm text-text-muted hover:text-text-primary transition-colors mb-3 inline-block">
          &larr; Back to Projects
        </a>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">{project.name || "Unnamed Project"}</h1>
          <Badge status={statusKey}>{project.status ?? "Unknown"}</Badge>
          {project.health != null && (
            <span className="text-sm tabular text-text-muted">Health: {project.health}</span>
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === tab
                ? "border-accent text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            )}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          {(project.summary || project.justification || project.strategy) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {project.summary && (
                <Card>
                  <CardHeader>
                    <h3 className="font-heading text-sm font-medium text-text-primary">Summary</h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-text-secondary leading-relaxed">{project.summary}</p>
                  </CardContent>
                </Card>
              )}
              {project.justification && (
                <Card>
                  <CardHeader>
                    <h3 className="font-heading text-sm font-medium text-text-primary">Justification</h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-text-secondary leading-relaxed">{project.justification}</p>
                  </CardContent>
                </Card>
              )}
              {project.strategy && (
                <Card>
                  <CardHeader>
                    <h3 className="font-heading text-sm font-medium text-text-primary">Strategy</h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-text-secondary leading-relaxed">{project.strategy}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {project.kpi && (
            <Card>
              <CardHeader>
                <h3 className="font-heading text-sm font-medium text-text-primary">KPI</h3>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-text-secondary mb-2">{project.kpi}</p>
                {project.kpiStatus && (
                  <Badge status={project.kpiStatus === "On Track" ? "healthy" : project.kpiStatus === "At Risk" ? "warning" : "critical"}>
                    {project.kpiStatus}
                  </Badge>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <h3 className="font-heading text-sm font-medium text-text-primary">Key Metrics</h3>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {project.deadline && (
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wider">Deadline</p>
                    <p className="text-sm font-medium text-text-primary tabular mt-1">
                      {formatDate(project.deadline)}
                      {deadlineDays != null && (
                        <span className={cn(
                          "ml-1 text-xs",
                          deadlineDays < 0 ? "text-critical" : deadlineDays < 30 ? "text-warning" : "text-text-muted"
                        )}>
                          ({deadlineDays < 0 ? `${Math.abs(deadlineDays)}d overdue` : `${deadlineDays}d left`})
                        </span>
                      )}
                    </p>
                  </div>
                )}
                {project.projectStart && (
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wider">Start</p>
                    <p className="text-sm font-medium text-text-primary tabular mt-1">{formatDate(project.projectStart)}</p>
                  </div>
                )}
                {project.reviewDate && (
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wider">Review</p>
                    <p className="text-sm font-medium text-text-primary tabular mt-1">{formatDate(project.reviewDate)}</p>
                  </div>
                )}
                {project.priority && (
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wider">Priority</p>
                    <p className="text-sm font-medium text-text-primary mt-1">{project.priority}</p>
                  </div>
                )}
                {project.phase && (
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wider">Phase</p>
                    <p className="text-sm font-medium text-text-primary mt-1">{project.phase}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {teamMembers.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="font-heading text-sm font-medium text-text-primary">Team</h3>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {teamMembers.map((m: any, i: number) => (
                    <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-elevated text-sm text-text-secondary">
                      {m.name ?? m}
                      {m.role && <span className="text-text-muted text-xs">({m.role})</span>}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === "monitor" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="font-heading text-sm font-medium text-text-primary">Status Overview</h3>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-text-muted uppercase tracking-wider">Status</p>
                  <p className="text-sm font-medium text-text-primary mt-1">{project.status ?? "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted uppercase tracking-wider">Phase</p>
                  <p className="text-sm font-medium text-text-primary mt-1">{project.phase ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted uppercase tracking-wider">Deadline</p>
                  <p className="text-sm font-medium text-text-primary tabular mt-1">
                    {project.deadline ? formatDate(project.deadline) : "—"}
                    {deadlineDays != null && (
                      <span className={cn(
                        "ml-1 text-xs",
                        deadlineDays < 0 ? "text-critical" : deadlineDays < 30 ? "text-warning" : "text-text-muted"
                      )}>
                        ({deadlineDays < 0 ? `${Math.abs(deadlineDays)}d overdue` : `${deadlineDays}d remaining`})
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-muted uppercase tracking-wider">Tasks</p>
                  <p className="text-sm font-medium text-text-primary tabular mt-1">
                    {completedTasks.length} / {tasks?.length ?? 0} completed
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {project.monitor && (
            <Card>
              <CardHeader>
                <h3 className="font-heading text-sm font-medium text-text-primary">Monitor Data</h3>
              </CardHeader>
              <CardContent>
                <pre className="text-xs text-text-secondary bg-elevated rounded-md p-4 overflow-x-auto whitespace-pre-wrap font-mono">
                  {typeof project.monitor === "string" ? project.monitor : JSON.stringify(project.monitor, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === "progress" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="font-heading text-sm font-medium text-text-primary">Project Progress</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              {progressVal != null && (
                <ProgressBar
                  value={progressVal}
                  color={progressVal >= 80 ? "healthy" : progressVal >= 50 ? "accent" : progressVal >= 25 ? "warning" : "critical"}
                />
              )}
              {project.projectProgress && (
                <div className="text-sm text-text-secondary leading-relaxed">
                  {typeof project.projectProgress === "string"
                    ? project.projectProgress
                    : JSON.stringify(project.projectProgress, null, 2)}
                </div>
              )}
            </CardContent>
          </Card>

          {timeProgress != null && (
            <Card>
              <CardHeader>
                <h3 className="font-heading text-sm font-medium text-text-primary">Time Elapsed</h3>
              </CardHeader>
              <CardContent className="space-y-3">
                <ProgressBar
                  value={timeProgress}
                  label={`${formatDate(project.projectStart)} → ${formatDate(project.deadline)}`}
                  color="accent"
                />
                {pacing && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted uppercase tracking-wider">Pacing:</span>
                    <Badge status={pacing === "Ahead" ? "healthy" : pacing === "Behind" ? "critical" : "neutral"}>
                      {pacing}
                    </Badge>
                    {progressVal != null && (
                      <span className="text-sm tabular text-text-muted">
                        ({formatPercent(progressVal)} complete vs {formatPercent(timeProgress)} time elapsed)
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {project.durationDays && (
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="py-4">
                  <p className="text-xs text-text-muted uppercase tracking-wider">Duration</p>
                  <p className="text-2xl font-heading font-semibold text-text-primary tabular mt-1">{project.durationDays} days</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <p className="text-xs text-text-muted uppercase tracking-wider">Tasks Completed</p>
                  <p className="text-2xl font-heading font-semibold text-text-primary tabular mt-1">
                    {formatNumber(completedTasks.length)}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {activeTab === "budget" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <h3 className="font-heading text-sm font-medium text-text-primary">Budget Utilization</h3>
              </CardHeader>
              <CardContent className="space-y-4">
                {project.budgetAllocated != null && project.budgetSpent != null ? (
                  <>
                    <ProgressBar
                      value={Number(project.budgetSpent)}
                      max={Number(project.budgetAllocated)}
                      color={Number(project.budgetSpent) / Number(project.budgetAllocated) > 0.9 ? "critical" : Number(project.budgetSpent) / Number(project.budgetAllocated) > 0.75 ? "warning" : "healthy"}
                      label={`${formatCurrency(project.budgetSpent)} of ${formatCurrency(project.budgetAllocated)}`}
                    />
                  </>
                ) : (
                  <p className="text-sm text-text-muted">No budget data available</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="font-heading text-sm font-medium text-text-primary">Financial Summary</h3>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted">Required Budget</span>
                    <span className="text-sm font-medium text-text-primary tabular">{formatCurrency(project.requiredBudget)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted">Projected Revenue</span>
                    <span className="text-sm font-medium text-text-primary tabular">{formatCurrency(project.projectedRevenue)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted">Cost to Date</span>
                    <span className="text-sm font-medium text-text-primary tabular">{formatCurrency(project.costToDate)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {financialLog && financialLog.length > 0 ? (
            <Card>
              <CardHeader>
                <h3 className="font-heading text-sm font-medium text-text-primary">Financial Log</h3>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-elevated">
                        <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Date</th>
                        <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Amount</th>
                        <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Category</th>
                        <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {financialLog.map((entry) => (
                        <tr key={entry.id} className="hover:bg-hover/50 transition-colors">
                          <td className="px-5 py-3 tabular text-text-secondary">{formatDate(entry.createdAt)}</td>
                          <td className={cn(
                            "px-5 py-3 tabular font-medium text-right",
                            entry.signedAmount < 0 ? "text-critical" : "text-healthy"
                          )}>
                            {formatCurrency(entry.signedAmount)}
                          </td>
                          <td className="px-5 py-3 text-text-secondary">{entry.category ?? "—"}</td>
                          <td className="px-5 py-3 text-text-secondary max-w-xs truncate">{entry.description ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-text-muted">
                No financial entries recorded
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === "risks" && (
        <div className="space-y-6">
          {directivesRisks ? (
            <Card>
              <CardHeader>
                <h3 className="font-heading text-sm font-medium text-text-primary">Project Risks</h3>
              </CardHeader>
              <CardContent>
                <pre className="text-xs text-text-secondary bg-elevated rounded-md p-4 overflow-x-auto whitespace-pre-wrap font-mono">
                  {JSON.stringify(directivesRisks, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-text-muted">Risk data available in Notion sync</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === "opportunities" && (
        <div className="space-y-6">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-text-muted">Opportunity data available in Notion sync</p>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "activity" && (
        <div className="space-y-6">
          {recentActivity.length > 0 ? (
            <Card>
              <CardHeader>
                <h3 className="font-heading text-sm font-medium text-text-primary">Recent Activity</h3>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-elevated">
                        <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Task</th>
                        <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
                        <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Priority</th>
                        <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Action Date</th>
                        <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Completed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {recentActivity.map((task) => (
                        <tr key={task.id} className="hover:bg-hover/50 transition-colors">
                          <td className="px-5 py-3 font-medium text-text-primary">{task.name ?? "Unnamed"}</td>
                          <td className="px-5 py-3">
                            <Badge status={task.status === "Completed" || task.status === "Done" ? "healthy" : task.status === "In Progress" ? "warning" : "neutral"}>
                              {task.status ?? "Unknown"}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-text-secondary">{task.priority ?? "—"}</td>
                          <td className="px-5 py-3 tabular text-text-secondary">{formatDate(task.actionDate)}</td>
                          <td className="px-5 py-3 tabular text-text-secondary">{formatDate(task.completedDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-text-muted">
                No activity recorded yet
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
