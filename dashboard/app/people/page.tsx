import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getPeopleList } from "@/lib/server/people";
import { PeopleListClient } from "./people-list-client";

function PeopleSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} variant="card" lines={3} />
      ))}
    </div>
  );
}

async function PeopleList() {
  const people = await getPeopleList();
  return <PeopleListClient people={people} />;
}

export default async function PeoplePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-heading font-semibold tracking-tight">
          People
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Relationship directory and contact tracking
        </p>
      </div>

      <Suspense fallback={<PeopleSkeleton />}>
        <PeopleList />
      </Suspense>
    </div>
  );
}
