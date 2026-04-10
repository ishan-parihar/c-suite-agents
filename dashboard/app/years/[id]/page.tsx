import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Target, LayoutGrid, ArrowLeft, TrendingUp } from "lucide-react";
import { getYearDetail, getYearGoals, getYearQuarters } from "@/lib/server/temporal";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { formatDate, formatCurrency } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";

const statusToBadge: Record<string, StatusKey> = {
  "On Track": "healthy",
  "Active": "healthy",
  "Completed": "healthy",
  "At Risk": "warning",
  "Delayed": "warning",
  "Off Track": "critical",
  "Failed": "critical",
  "Inactive": "neutral",
  "Draft": "neutral",
  "Planned": "neutral",
};

async function YearDetailContent({ id }: { id: string }) {
  const year = await getYearDetail(id);
  if (!year) notFound();

  const [goals, quarters] = await Promise.all([
    getYearGoals(id),
    getYearQuarters(id),
  ]);

  const badgeKey = statusToBadge[year.status ?? ""] ?? "neutral";

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link href="/years" className="mt-1 text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">{year.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            {year.yearRange && (
              <span className="text-sm text-text-secondary">{year.yearRange}</span>
            )}
            <Badge status={badgeKey} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Quarters"
          value={year._count.quarters}
          icon={LayoutGrid}
        />
        <StatCard
          title="Annual Goals"
          value={year._count.annualGoals}
          icon={Target}
        />
        <StatCard
          title="Status"
          value={year.status ?? "Unknown"}
          icon={Calendar}
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-heading text-lg font-medium text-text-primary">Annual Goals</h2>
        </CardHeader>
        <CardContent className="p-0">
          {goals.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-elevated">
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Goal</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {goals.map((goal) => {
                    const gBadge = statusToBadge[goal.status ?? ""] ?? "neutral";
                    return (
                      <tr key={goal.id} className="hover:bg-hover/50 transition-colors">
                        <td className="px-5 py-4">
                          <span className="font-medium text-text-primary">{goal.name}</span>
                        </td>
                        <td className="px-5 py-4"><Badge status={gBadge} /></td>
                        <td className="px-5 py-4 text-sm text-text-secondary">{goal.goalProgress ?? "\u2014"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-text-muted">
              <Target className="w-8 h-8 mx-auto mb-3" />
              <p>No annual goals</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-heading text-lg font-medium text-text-primary">Quarters</h2>
        </CardHeader>
        <CardContent>
          {quarters.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {quarters.map((q) => {
                const qBadge = statusToBadge[q.status ?? ""] ?? "neutral";
                return (
                  <Link key={q.id} href={`/quarters/${q.id}`}>
                    <Card variant="default" className="h-full">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-heading text-sm font-medium text-text-primary">{q.name}</h3>
                            {q.quarterRange && (
                              <p className="text-xs text-text-secondary mt-0.5">{q.quarterRange}</p>
                            )}
                          </div>
                          <Badge status={qBadge} />
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="text-text-muted">Income</p>
                            <p className="text-text-primary font-medium tabular">{q.totalIncome ?? "\u2014"}</p>
                          </div>
                          <div>
                            <p className="text-text-muted">Expenses</p>
                            <p className="text-text-primary font-medium tabular">{q.totalExpenses ?? "\u2014"}</p>
                          </div>
                          <div>
                            <p className="text-text-muted">Net</p>
                            <p className="font-medium tabular text-healthy">{q.netCashflow ?? "\u2014"}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-text-muted">
              <LayoutGrid className="w-8 h-8 mx-auto mb-3" />
              <p>No quarters</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default async function YearDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <YearDetailContent id={id} />
    </Suspense>
  );
}
