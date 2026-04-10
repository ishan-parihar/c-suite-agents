import { Suspense } from "react";
import Link from "next/link";
import { Calendar, Search } from "lucide-react";
import { getDaysList } from "@/lib/server/temporal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusKey } from "@/lib/constants";
import { formatDate } from "@/lib/formatters";

const statusToBadge: Record<string, StatusKey> = {
  "Active": "healthy",
  "Closed": "neutral",
  "Planning": "warning",
};

async function DaysContent() {
  const days = await getDaysList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Days</h1>
        <p className="text-sm text-text-secondary mt-1">Daily logs and health scores</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-elevated">
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Date</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Day</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Health Score</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {days.length > 0 ? days.map((d) => {
                  const bk = statusToBadge[d.status ?? ""] ?? "neutral";
                  return (
                    <tr key={d.id} className="hover:bg-hover/50 transition-colors">
                      <td className="px-5 py-4">
                        <Link href={`/days/${d.id}`} className="flex items-center gap-3 group">
                          <Calendar className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" />
                          <span className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">{formatDate(d.date)}</span>
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-sm text-text-secondary">{d.dayName || "\u2014"}</td>
                      <td className="px-5 py-4">
                        {d.healthScore != null ? (
                          <span className="tabular font-medium text-text-primary">{d.healthScore}</span>
                        ) : "\u2014"}
                      </td>
                      <td className="px-5 py-4"><Badge status={bk} /></td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={4} className="px-5 py-12 text-center text-sm text-text-muted">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="w-8 h-8" />
                        <p>No days found</p>
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

export default function DaysPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <DaysContent />
    </Suspense>
  );
}
