import { Suspense } from "react";
import { Apple } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getDietEntries } from "@/lib/server/journals";
import { DietTable } from "../_components/journal-tables";

async function DietList() {
  const data = await getDietEntries();
  return <DietTable data={data} />;
}

export default async function DietPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-elevated border border-border p-2">
            <Apple className="h-5 w-5 text-text-secondary" />
          </div>
          <div>
            <h1 className="font-heading text-2xl text-text-primary">Diet Log</h1>
            <p className="text-text-secondary mt-1">
              Nutrition, supplements, and health metrics
            </p>
          </div>
        </div>
      </div>

      <Suspense fallback={<Skeleton variant="table" lines={12} />}>
        <DietList />
      </Suspense>
    </div>
  );
}
