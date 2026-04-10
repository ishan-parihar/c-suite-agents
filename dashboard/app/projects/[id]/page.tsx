import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getProjectDetail, getProjectTasks, getProjectFinancialLog } from "@/lib/server/projects";
import { ProjectTabs } from "./_components/project-tabs";
import { Skeleton } from "@/components/ui/skeleton";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

async function ProjectDetailContent({ id }: { id: string }) {
  const [project, tasks, financialLog] = await Promise.all([
    getProjectDetail(id),
    getProjectTasks(id),
    getProjectFinancialLog(id),
  ]);

  if (!project) {
    notFound();
  }

  return <ProjectTabs project={project} tasks={tasks} financialLog={financialLog} />;
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={<Skeleton variant="card" lines={10} />}>
      <ProjectDetailContent id={id} />
    </Suspense>
  );
}
