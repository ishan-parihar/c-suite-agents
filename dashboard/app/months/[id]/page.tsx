import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, Wallet, BookOpen, AlertCircle, FileText } from "lucide-react";
import { getMonthDetail } from "@/lib/server/temporal";
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

async function MonthDetailContent({ id }: { id: string }) {
  const month = await getMonthDetail(id);

  if (!month) {
    return (
      <div className="space-y-6">
        <Link href="/months" className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Months
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-text-muted">
            Month not found
          </CardContent>
        </Card>
      </div>
    );
  }

  const bk = statusToBadge[month.status ?? ""] ?? "neutral";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/months" className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors mb-3">
          <ArrowLeft className="w-4 h-4" />
          Back to Months
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">{month.name || "Unnamed Month"}</h1>
          <Badge status={bk} />
        </div>
        {month.monthRange && <p className="text-sm text-text-secondary mt-1">{month.monthRange}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Income"
          value={month.totalIncome != null ? formatCurrency(parseFloat(month.totalIncome)) : "\u2014"}
          icon={TrendingUp}
        />
        <StatCard
          title="Expenses"
          value={month.totalExpenses != null ? formatCurrency(parseFloat(month.totalExpenses)) : "\u2014"}
          icon={TrendingDown}
        />
        <StatCard
          title="Net Cashflow"
          value={month.netCashflow != null ? formatCurrency(parseFloat(month.netCashflow)) : "\u2014"}
          icon={DollarSign}
        />
        <StatCard
          title="Net Worth Change"
          value={month.netWorthChange != null ? formatCurrency(parseFloat(month.netWorthChange)) : "\u2014"}
          icon={Wallet}
        />
      </div>

      {month.categorySummary && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary">Category Summary</h2>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans">{typeof month.categorySummary === "string" ? month.categorySummary : JSON.stringify(month.categorySummary, null, 2)}</pre>
          </CardContent>
        </Card>
      )}

      {month.keyLearnings && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary">Key Learnings</h2>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans">{typeof month.keyLearnings === "string" ? month.keyLearnings : JSON.stringify(month.keyLearnings, null, 2)}</pre>
          </CardContent>
        </Card>
      )}

      {month.significantEvents && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary">Significant Events</h2>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans">{typeof month.significantEvents === "string" ? month.significantEvents : JSON.stringify(month.significantEvents, null, 2)}</pre>
          </CardContent>
        </Card>
      )}

      {month.cashflowNarrative && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary">Cashflow Narrative</h2>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans">{typeof month.cashflowNarrative === "string" ? month.cashflowNarrative : JSON.stringify(month.cashflowNarrative, null, 2)}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default async function MonthDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton variant="card" lines={8} />}>
      <MonthDetailContent id={id} />
    </Suspense>
  );
}
