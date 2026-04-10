import { Suspense } from "react";
import Link from "next/link";
import { Calendar, Target, LayoutGrid } from "lucide-react";
import { getYearsList } from "@/lib/server/temporal";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/formatters";
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

async function YearsListContent() {
  const years = await getYearsList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Years</h1>
        <p className="text-sm text-text-secondary mt-1">Annual planning and review</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {years.map((year) => {
          const badgeKey = statusToBadge[year.status ?? ""] ?? "neutral";
          return (
            <Link key={year.id} href={`/years/${year.id}`}>
              <Card variant="default" className="h-full">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-heading text-lg font-medium text-text-primary">{year.name}</h3>
                      {year.yearRange && (
                        <p className="text-sm text-text-secondary mt-0.5">{year.yearRange}</p>
                      )}
                    </div>
                    <Badge status={badgeKey} />
                  </div>
                  <div className="flex items-center gap-4 text-sm text-text-muted">
                    <span className="flex items-center gap-1.5">
                      <LayoutGrid className="w-3.5 h-3.5" />
                      {year._count.quarters} quarter{year._count.quarters !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5" />
                      {year._count.annualGoals} goal{year._count.annualGoals !== 1 ? "s" : ""}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {years.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="w-8 h-8 text-text-muted mx-auto mb-3" />
            <p className="text-sm text-text-secondary">No years found</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function YearsPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={6} />}>
      <YearsListContent />
    </Suspense>
  );
}
