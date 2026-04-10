import { Suspense } from "react";
import { Network } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getSystemicEntries } from "@/lib/server/journals";
import { SystemicTable } from "../_components/journal-tables";

async function SystemicList() {
  const data = await getSystemicEntries();
  return <SystemicTable data={data} />;
}

export default async function SystemicPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-elevated border border-border p-2">
            <Network className="h-5 w-5 text-text-secondary" />
          </div>
          <div>
            <h1 className="font-heading text-2xl text-text-primary">Systemic Journal</h1>
            <p className="text-text-secondary mt-1">
              System-level observations and AI-generated insights
            </p>
          </div>
        </div>
      </div>

      <Suspense fallback={<Skeleton variant="table" lines={12} />}>
        <SystemicList />
      </Suspense>
    </div>
  );
}
