import { Suspense } from "react";
import { UsersRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getRelationalEntries } from "@/lib/server/journals";
import { RelationalTable } from "../_components/journal-tables";

async function RelationalList() {
  const data = await getRelationalEntries();
  return <RelationalTable data={data} />;
}

export default async function RelationalPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-elevated border border-border p-2">
            <UsersRound className="h-5 w-5 text-text-secondary" />
          </div>
          <div>
            <h1 className="font-heading text-2xl text-text-primary">Relational Journal</h1>
            <p className="text-text-secondary mt-1">
              Relationship interactions and connection tracking
            </p>
          </div>
        </div>
      </div>

      <Suspense fallback={<Skeleton variant="table" lines={12} />}>
        <RelationalList />
      </Suspense>
    </div>
  );
}
