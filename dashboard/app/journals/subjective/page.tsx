import { Suspense } from "react";
import { Pen } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubjectiveEntries } from "@/lib/server/journals";
import { SubjectiveTable } from "../_components/journal-tables";

async function SubjectiveList() {
  const data = await getSubjectiveEntries();
  return <SubjectiveTable data={data} />;
}

export default async function SubjectivePage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-elevated border border-border p-2">
            <Pen className="h-5 w-5 text-text-secondary" />
          </div>
          <div>
            <h1 className="font-heading text-2xl text-text-primary">Subjective Journal</h1>
            <p className="text-text-secondary mt-1">
              Your inner experience — mood, stress, energy tracking
            </p>
          </div>
        </div>
      </div>

      <Suspense fallback={<Skeleton variant="table" lines={12} />}>
        <SubjectiveList />
      </Suspense>
    </div>
  );
}
