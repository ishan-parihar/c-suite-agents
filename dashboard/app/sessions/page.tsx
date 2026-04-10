import { Suspense } from "react";
import { getSessionsList } from "@/lib/server/sessions";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionsTable } from "./sessions-table";

async function SessionsContent() {
  const data = await getSessionsList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Agent Sessions</h1>
        <p className="text-sm text-text-secondary mt-1">
          Monitor and inspect agent conversation sessions
        </p>
      </div>

      <SessionsTable data={data} />
    </div>
  );
}

export default function SessionsPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <SessionsContent />
    </Suspense>
  );
}
