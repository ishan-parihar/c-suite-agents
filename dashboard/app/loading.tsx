import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function LoadingPage() {
  return (
    <div role="status" aria-label="loading" className="space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="h-8 w-full rounded-md bg-elevated animate-pulse" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} variant="default">
            <Skeleton variant="stat" className="h-24" />
          </Card>
        ))}
      </div>

      <Card variant="default">
        <Skeleton variant="table" lines={5} className="h-64" />
      </Card>
    </div>
  );
}
