import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getPeopleList } from "@/lib/server/people";
import { PeopleCrudClient } from "./people-crud-client";
import type { PersonListItem } from "@/lib/server/people";

function PeopleSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Skeleton variant="card" lines={1} />
      </div>
      <Skeleton variant="table" lines={10} />
    </div>
  );
}

async function PeopleList() {
  const people = await getPeopleList();
  const rows = people.map((p: PersonListItem) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    relationshipStatus: p.relationshipStatus,
    city: p.city,
    lastConnectedDate: p.lastConnectedDate,
    connectionFrequencyDays: p.connectionFrequencyDays,
    networkingProfile: p.networkingProfile,
    professionalDomain: p.professionalDomain,
    lastInteractionSentiment: p.lastInteractionSentiment,
  }));
  return <PeopleCrudClient people={rows} />;
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
