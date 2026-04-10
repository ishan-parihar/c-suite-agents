import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Heart, Calendar } from "lucide-react";
import { getDayDetail } from "@/lib/server/temporal";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";

const statusToBadge: Record<string, StatusKey> = {
  "Active": "healthy",
  "Closed": "neutral",
  "Planning": "warning",
};

async function DayDetailContent({ id }: { id: string }) {
  const day = await getDayDetail(id);

  if (!day) {
    return (
      <div className="space-y-6">
        <Link href="/days" className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Days
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-text-muted">
            Day not found
          </CardContent>
        </Card>
      </div>
    );
  }

  const bk = statusToBadge[day.status ?? ""] ?? "neutral";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/days" className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors mb-3">
          <ArrowLeft className="w-4 h-4" />
          Back to Days
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">{formatDate(day.date)}</h1>
          <Badge status={bk} />
        </div>
        {day.dayName && <p className="text-sm text-text-secondary mt-1">{day.dayName}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Health Score"
          value={day.healthScore != null ? day.healthScore.toString() : "\u2014"}
          icon={Heart}
        />
        <StatCard
          title="Day Number"
          value={day.dayNumber != null ? day.dayNumber.toString() : "\u2014"}
          icon={Calendar}
        />
        <StatCard
          title="Year"
          value={day.year != null ? day.year.toString() : "\u2014"}
          icon={Calendar}
        />
      </div>

      {day.dayJson && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-lg font-medium text-text-primary">Day Details</h2>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-mono text-xs overflow-x-auto">
              {typeof day.dayJson === "string" ? JSON.stringify(JSON.parse(day.dayJson), null, 2) : JSON.stringify(day.dayJson, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default async function DayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton variant="card" lines={8} />}>
      <DayDetailContent id={id} />
    </Suspense>
  );
}
