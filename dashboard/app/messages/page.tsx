import { Suspense } from "react";
import { getMessageThreads } from "@/lib/server/messaging";
import { MessagesClient } from "./_components/messages-client";
import { Skeleton } from "@/components/ui/skeleton";

export default async function MessagesPage() {
  const threads = await getMessageThreads();

  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <MessagesClient initialThreads={threads} />
    </Suspense>
  );
}
