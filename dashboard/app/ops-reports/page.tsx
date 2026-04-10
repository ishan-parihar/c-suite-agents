import { Suspense } from "react";
import { getReportsList } from "@/lib/server/reports";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportsTable } from "./reports-table";

async function ReportsContent() {
  const data = await getReportsList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          Operational Reports
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Review operational reports and metrics
        </p>
      </div>

      <ReportsTable data={data} />
    </div>
  );
}

export default function OpsReportsPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <ReportsContent />
    </Suspense>
  );
}
