import { Suspense } from "react";
import { Target, ClipboardList, Search } from "lucide-react";
import Link from "next/link";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatPercent, formatNumber } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";
import { getAnnualGoals, getQuarterlyGoals } from "@/lib/server/goals";

const goalStatusToBadge: Record<string, StatusKey> = {
  Complete: "healthy",
  Achieved: "healthy",
  "In Progress": "warning",
  Missed: "critical",
};

function goalHealthToColor(health: string | null): "healthy" | "warning" | "critical" | "accent" {
  if (!health) return "accent";
  const lower = health.toLowerCase();
  if (lower === "on track" || lower === "good") return "healthy";
  if (lower === "at risk" || lower === "warning") return "warning";
  if (lower === "off track" || lower === "critical" || lower === "bad") return "critical";
  return "accent";
}

function SkeletonContent() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-hover animate-pulse" />
        ))}
      </div>
      <Skeleton variant="table" lines={6} />
      <Skeleton variant="table" lines={4} />
    </div>
  );
}

async function GoalsContent() {
  const [annualGoals, quarterlyGoals] = await Promise.all([
    getAnnualGoals(),
    getQuarterlyGoals(),
  ]);

  const annualActive = annualGoals.filter(
    (g) => goalStatusToBadge[g.status ?? ""] === "warning"
  ).length;
  const quarterlyActive = quarterlyGoals.filter(
    (g) => goalStatusToBadge[g.status ?? ""] === "warning"
  ).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Goals Dashboard</h1>
        <p className="text-sm text-text-secondary mt-1">Track annual and quarterly goal progress</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Annual Goals" value={formatNumber(annualGoals.length)} icon={Target} />
        <StatCard title="Active Annual Goals" value={formatNumber(annualActive)} icon={Target} />
        <StatCard title="Total Quarterly Goals" value={formatNumber(quarterlyGoals.length)} icon={ClipboardList} />
        <StatCard title="Active Quarterly Goals" value={formatNumber(quarterlyActive)} icon={ClipboardList} />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider">
            Annual Goals
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {annualGoals.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-elevated">
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Goal</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Progress</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Archetype</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Strategic Approach</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {annualGoals.map((g) => {
                    const bk = goalStatusToBadge[g.status ?? ""] ?? "neutral";
                    return (
                      <tr key={g.id} className="hover:bg-hover/50 transition-colors">
                        <td className="px-5 py-4">
                          <Link href={`/goals/annual/${g.id}`} className="text-sm font-medium text-text-primary hover:text-accent-secondary transition-colors">
                            {g.name || "Unnamed"}
                          </Link>
                        </td>
                        <td className="px-5 py-4"><Badge status={bk} /></td>
                        <td className="px-5 py-4 w-48">
                          <ProgressBar value={g.goalProgress ?? 0} showLabel />
                        </td>
                        <td className="px-5 py-4 text-sm text-text-secondary tabular">
                          {g.goalArchetype || "\u2014"}
                        </td>
                        <td className="px-5 py-4 text-sm text-text-secondary max-w-xs truncate">
                          {g.strategicApproach || "\u2014"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 rounded-full bg-hover p-4 text-text-muted">
                <Target className="h-8 w-8" />
              </div>
              <h3 className="mb-1 text-lg font-medium text-text-primary">No annual goals</h3>
              <p className="text-sm text-text-secondary">Annual goals will appear here once defined</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider">
            Quarterly Goals
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {quarterlyGoals.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-elevated">
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Goal</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Progress</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Health</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Key Results</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {quarterlyGoals.map((g) => {
                    const bk = goalStatusToBadge[g.status ?? ""] ?? "neutral";
                    const progressVal = g.progress ?? g.goalProgress ?? 0;
                    return (
                      <tr key={g.id} className="hover:bg-hover/50 transition-colors">
                        <td className="px-5 py-4">
                          <Link href={`/goals/quarterly/${g.id}`} className="text-sm font-medium text-text-primary hover:text-accent-secondary transition-colors">
                            {g.name || "Unnamed"}
                          </Link>
                        </td>
                        <td className="px-5 py-4"><Badge status={bk} /></td>
                        <td className="px-5 py-4 w-48">
                          <ProgressBar
                            value={progressVal}
                            color={goalHealthToColor(g.health)}
                            showLabel
                          />
                        </td>
                        <td className="px-5 py-4">
                          <Badge status={goalHealthToColor(g.health) as StatusKey} />
                        </td>
                        <td className="px-5 py-4 text-sm text-text-secondary max-w-md">
                          {[g.keyResult1, g.keyResult2, g.keyResult3]
                            .filter(Boolean)
                            .slice(0, 2)
                            .join(" \u00b7 ") || "\u2014"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 rounded-full bg-hover p-4 text-text-muted">
                <ClipboardList className="h-8 w-8" />
              </div>
              <h3 className="mb-1 text-lg font-medium text-text-primary">No quarterly goals</h3>
              <p className="text-sm text-text-secondary">Quarterly goals will appear here once defined</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function GoalsPage() {
  return (
    <Suspense fallback={<SkeletonContent />}>
      <GoalsContent />
    </Suspense>
  );
}
