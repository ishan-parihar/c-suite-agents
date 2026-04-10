import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LayoutGrid, ArrowLeft, ArrowUpRight, ArrowDownRight, BookOpen, FileText } from "lucide-react";
import { getQuarterDetail } from "@/lib/server/temporal";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
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

function formatCurrencySimple(value: string | null): string {
  if (!value) return "\u2014";
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return `\u20B9${Math.abs(num).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function QuarterDetailContent({ id }: { id: string }) {
  const quarter = await getQuarterDetail(id);
  if (!quarter) notFound();

  const badgeKey = statusToBadge[quarter.status ?? ""] ?? "neutral";

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link href="/quarters" className="mt-1 text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">{quarter.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            {quarter.quarterRange && (
              <span className="text-sm text-text-secondary">{quarter.quarterRange}</span>
            )}
            <Badge status={badgeKey} />
          </div>
          {quarter.yearsId && (
            <Link href={`/years/${quarter.yearsId}`} className="inline-flex items-center gap-1 text-sm text-accent-secondary hover:text-text-primary transition-colors mt-2">
              <LayoutGrid className="w-3.5 h-3.5" />
              View parent year
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Income"
          value={formatCurrencySimple(quarter.totalIncome)}
          icon={ArrowUpRight}
          className="border-l-2 border-l-healthy"
        />
        <StatCard
          title="Total Expenses"
          value={formatCurrencySimple(quarter.totalExpenses)}
          icon={ArrowDownRight}
          className="border-l-2 border-l-critical"
        />
        <StatCard
          title="Net Cashflow"
          value={formatCurrencySimple(quarter.netCashflow)}
          icon={ArrowUpRight}
          className="border-l-2 border-l-accent"
        />
      </div>

      {quarter.keyLearnings && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-text-muted" />
              Key Learnings
            </h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{quarter.keyLearnings}</p>
          </CardContent>
        </Card>
      )}

      {quarter.quarterReport && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary flex items-center gap-2">
              <FileText className="w-5 h-5 text-text-muted" />
              Quarter Report
            </h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{quarter.quarterReport}</p>
          </CardContent>
        </Card>
      )}

      {!quarter.keyLearnings && !quarter.quarterReport && (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-8 h-8 text-text-muted mx-auto mb-3" />
            <p className="text-sm text-text-secondary">No learnings or report recorded</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default async function QuarterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <QuarterDetailContent id={id} />
    </Suspense>
  );
}
