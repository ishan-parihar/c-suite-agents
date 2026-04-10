import { Suspense } from "react";
import Link from "next/link";
import { LayoutGrid, Calendar, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { getQuartersList } from "@/lib/server/temporal";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

async function QuartersListContent() {
  const quarters = await getQuartersList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Quarters</h1>
        <p className="text-sm text-text-secondary mt-1">Quarterly performance and review</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-elevated">
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Quarter</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Period</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Income</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Expenses</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {quarters.length > 0 ? quarters.map((q) => {
                  const badgeKey = statusToBadge[q.status ?? ""] ?? "neutral";
                  const netNum = q.netCashflow ? parseFloat(q.netCashflow) : null;
                  const netColor = netNum !== null ? (netNum >= 0 ? "text-healthy" : "text-critical") : "text-text-secondary";
                  const netIcon = netNum !== null
                    ? (netNum >= 0 ? <ArrowUpRight className="w-3.5 h-3.5 inline" /> : <ArrowDownRight className="w-3.5 h-3.5 inline" />)
                    : <Minus className="w-3.5 h-3.5 inline text-text-muted" />;
                  return (
                    <tr key={q.id} className="hover:bg-hover/50 transition-colors">
                      <td className="px-5 py-4">
                        <Link href={`/quarters/${q.id}`} className="font-medium text-text-primary hover:text-accent-secondary transition-colors">
                          {q.name}
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-sm text-text-secondary">{q.quarterRange ?? "\u2014"}</td>
                      <td className="px-5 py-4"><Badge status={badgeKey} /></td>
                      <td className="px-5 py-4 text-right tabular text-text-secondary">{formatCurrencySimple(q.totalIncome)}</td>
                      <td className="px-5 py-4 text-right tabular text-text-secondary">{formatCurrencySimple(q.totalExpenses)}</td>
                      <td className={`px-5 py-4 text-right tabular font-medium ${netColor}`}>
                        {netIcon} {formatCurrencySimple(q.netCashflow)}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-text-muted">
                      <div className="flex flex-col items-center gap-2">
                        <LayoutGrid className="w-8 h-8" />
                        <p>No quarters found</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function QuartersPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={8} />}>
      <QuartersListContent />
    </Suspense>
  );
}
