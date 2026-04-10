import { Suspense } from "react";
import Link from "next/link";
import { CalendarDays, Search } from "lucide-react";
import { getWeeksList } from "@/lib/server/temporal";
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

async function WeeksContent() {
  const weeks = await getWeeksList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Weeks</h1>
        <p className="text-sm text-text-secondary mt-1">Weekly activity reviews and task progress</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-elevated">
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Week</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Range</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Week #</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Year</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Income</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Expenses</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {weeks.length > 0 ? weeks.map((w) => {
                  const bk = statusToBadge[w.status ?? ""] ?? "neutral";
                  return (
                    <tr key={w.id} className="hover:bg-hover/50 transition-colors">
                      <td className="px-5 py-4">
                        <Link href={`/weeks/${w.id}`} className="flex items-center gap-3 group">
                          <CalendarDays className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" />
                          <span className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">{w.name || "Unnamed"}</span>
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-sm text-text-secondary">{w.weekRange || "\u2014"}</td>
                      <td className="px-5 py-4"><Badge status={bk} /></td>
                      <td className="px-5 py-4 tabular text-text-secondary">{w.weekNumber ?? "\u2014"}</td>
                      <td className="px-5 py-4 tabular text-text-secondary">{w.year ?? "\u2014"}</td>
                      <td className="px-5 py-4 tabular text-right text-text-secondary">{w.totalIncome != null ? formatCurrency(parseFloat(w.totalIncome)) : "\u2014"}</td>
                      <td className="px-5 py-4 tabular text-right text-text-secondary">{w.totalExpenses != null ? formatCurrency(parseFloat(w.totalExpenses)) : "\u2014"}</td>
                      <td className="px-5 py-4 tabular text-right font-medium text-text-primary">{w.netCashflow != null ? formatCurrency(parseFloat(w.netCashflow)) : "\u2014"}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-sm text-text-muted">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="w-8 h-8" />
                        <p>No weeks found</p>
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

export default function WeeksPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <WeeksContent />
    </Suspense>
  );
}
