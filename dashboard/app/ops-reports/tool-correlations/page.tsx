import { Suspense } from "react";
import { getToolCorrelations } from "@/lib/server/reports";
import { Skeleton } from "@/components/ui/skeleton";
import { CorrelationsTable } from "./correlations-table";

async function CorrelationsContent() {
  const data = await getToolCorrelations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          Tool Correlations
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Analyze tool call patterns and result correlations
        </p>
      </div>

      <CorrelationsTable data={data} />
    </div>
  );
}

export default function ToolCorrelationsPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <CorrelationsContent />
    </Suspense>
  );
}
