import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, CheckSquare, BarChart3 } from "lucide-react";
import { getWeekDetail } from "@/lib/server/temporal";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";

const statusToBadge: Record<string, StatusKey> = {
  "Active": "healthy",
  "Closed": "neutral",
  "Planning": "warning",
};

async function WeekDetailContent({ id }: { id: string }) {
  const week = await getWeekDetail(id);

  if (!week) {
    return (
      <div className="space-y-6">
        <Link href="/weeks" className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Weeks
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-text-muted">
            Week not found
          </CardContent>
        </Card>
      </div>
    );
  }

  const bk = statusToBadge[week.status ?? ""] ?? "neutral";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/weeks" className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors mb-3">
          <ArrowLeft className="w-4 h-4" />
          Back to Weeks
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">{week.name || "Unnamed Week"}</h1>
          <Badge status={bk} />
        </div>
        {week.weekRange && <p className="text-sm text-text-secondary mt-1">{week.weekRange}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Income"
          value={week.totalIncome != null ? formatCurrency(parseFloat(week.totalIncome)) : "\u2014"}
          icon={TrendingUp}
        />
        <StatCard
          title="Expenses"
          value={week.totalExpenses != null ? formatCurrency(parseFloat(week.totalExpenses)) : "\u2014"}
          icon={TrendingDown}
        />
        <StatCard
          title="Net Cashflow"
          value={week.netCashflow != null ? formatCurrency(parseFloat(week.netCashflow)) : "\u2014"}
          icon={DollarSign}
        />
      </div>

      {week.tasksProgress && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary">Tasks Progress</h2>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans">{typeof week.tasksProgress === "string" ? week.tasksProgress : JSON.stringify(week.tasksProgress, null, 2)}</pre>
          </CardContent>
        </Card>
      )}

      {week.activityBreakdown && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary">Activity Breakdown</h2>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans">{typeof week.activityBreakdown === "string" ? week.activityBreakdown : JSON.stringify(week.activityBreakdown, null, 2)}</pre>
          </CardContent>
        </Card>
      )}

      {week.keyLearnings && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary">Key Learnings</h2>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans">{typeof week.keyLearnings === "string" ? week.keyLearnings : JSON.stringify(week.keyLearnings, null, 2)}</pre>
          </CardContent>
        </Card>
      )}

      {week.categorySummary && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary">Category Summary</h2>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans">{typeof week.categorySummary === "string" ? week.categorySummary : JSON.stringify(week.categorySummary, null, 2)}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default async function WeekDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton variant="card" lines={8} />}>
      <WeekDetailContent id={id} />
    </Suspense>
  );
}
