import { Suspense } from "react";
import { getTasksList } from "@/lib/server/tasks";
import { Skeleton } from "@/components/ui/skeleton";
import { TasksTable } from "./tasks-table";

async function TasksContent() {
  const data = await getTasksList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Tasks</h1>
        <p className="text-sm text-text-secondary mt-1">Track and manage all tasks</p>
      </div>

      <TasksTable data={data} />
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <TasksContent />
    </Suspense>
  );
}
