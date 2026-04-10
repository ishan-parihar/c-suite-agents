import { Suspense } from "react";
import Link from "next/link";
import { Calendar, Search } from "lucide-react";
import { getMonthsList } from "@/lib/server/temporal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusKey } from "@/lib/constants";
import { formatCurrency } from "@/lib/formatters";

const statusToBadge: Record<string, StatusKey> = {
  "Active": "healthy",
  "Closed": "neutral",
  "Planning": "warning",
};

async function MonthsContent() {
  const months = await getMonthsList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Months</h1>
        <p className="text-sm text-text-secondary mt-1">Monthly financial reviews and cashflow summaries</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-elevated">
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Month</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Range</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Year</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Income</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Expenses</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {months.length > 0 ? months.map((m) => {
                  const bk = statusToBadge[m.status ?? ""] ?? "neutral";
                  return (
                    <tr key={m.id} className="hover:bg-hover/50 transition-colors">
                      <td className="px-5 py-4">
                        <Link href={`/months/${m.id}`} className="flex items-center gap-3 group">
                          <Calendar className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" />
                          <span className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">{m.name || "Unnamed"}</span>
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-sm text-text-secondary">{m.monthRange || "\u2014"}</td>
                      <td className="px-5 py-4"><Badge status={bk} /></td>
                      <td className="px-5 py-4 tabular text-text-secondary">{m.year ?? "\u2014"}</td>
                      <td className="px-5 py-4 tabular text-right text-text-secondary">{m.totalIncome != null ? formatCurrency(parseFloat(m.totalIncome)) : "\u2014"}</td>
                      <td className="px-5 py-4 tabular text-right text-text-secondary">{m.totalExpenses != null ? formatCurrency(parseFloat(m.totalExpenses)) : "\u2014"}</td>
                      <td className="px-5 py-4 tabular text-right font-medium text-text-primary">{m.netCashflow != null ? formatCurrency(parseFloat(m.netCashflow)) : "\u2014"}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-text-muted">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="w-8 h-8" />
                        <p>No months found</p>
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

export default function MonthsPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <MonthsContent />
    </Suspense>
  );
}
