import { Suspense } from "react";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { FolderKanban, Search } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusKey } from "@/lib/constants";

async function getProjects() {
  try {
    const result = await db.execute(sql`
      SELECT name, status, health_score, progress_pct, team_size
      FROM projects
      ORDER BY health_score DESC NULLS LAST
      LIMIT 50
    `);
    return result.rows as Array<{
      name: string | null;
      status: string | null;
      health_score: number | null;
      progress_pct: number | null;
      team_size: number | null;
    }>;
  } catch {
    return [];
  }
}

const statusToBadge: Record<string, StatusKey> = {
  "On Track": "healthy",
  "At Risk": "warning",
  "Off Track": "critical",
};

async function ProjectsContent() {
  const projects = await getProjects();

  const statusCounts = { healthy: 0, warning: 0, critical: 0, neutral: 0 };
  projects.forEach((p) => {
    const bk = statusToBadge[p.status ?? ""] ?? "neutral";
    statusCounts[bk]++;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Projects</h1>
        <p className="text-sm text-text-secondary mt-1">Monitor project health and progress</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Projects" value={projects.length} icon={FolderKanban} />
        <StatCard title="On Track" value={statusCounts.healthy} icon={FolderKanban} />
        <StatCard title="At Risk" value={statusCounts.warning} icon={FolderKanban} />
        <StatCard title="Off Track" value={statusCounts.critical} icon={FolderKanban} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-elevated">
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Project</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Health</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Score</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Progress</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Team</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {projects.length > 0 ? projects.map((p, i) => {
                  const bk = statusToBadge[p.status ?? ""] ?? "neutral";
                  return (
                    <tr key={i} className="hover:bg-hover/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <FolderKanban className="w-4 h-4 text-text-muted" />
                          <span className="text-sm font-medium text-text-primary">{p.name || "Unnamed"}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4"><Badge status={bk} /></td>
                      <td className="px-5 py-4 tabular text-text-secondary">{p.health_score ?? "—"}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-hover rounded-full overflow-hidden">
                            <div className="h-full bg-accent rounded-full" style={{ width: `${p.progress_pct ?? 0}%` }} />
                          </div>
                          <span className="text-xs text-text-muted tabular">{p.progress_pct ?? 0}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-text-secondary tabular">{p.team_size ?? "—"}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-text-muted">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="w-8 h-8" />
                        <p>No projects found</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Skeleton variant="table" lines={10} />}>
      <ProjectsContent />
    </Suspense>
  );
}
