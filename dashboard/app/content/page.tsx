import Link from "next/link";
import { FileText, CheckCircle, TrendingUp, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { getContentPipeline } from "@/lib/server/marketing";
import { ContentTable } from "./content-table";

export default async function ContentPipelinePage() {
  const content = await getContentPipeline();

  const totalContent = content.length;
  const published = content.filter(
    (c) => c.status?.toLowerCase() === "published" || c.status?.toLowerCase() === "live"
  ).length;
  const avgEngagement =
    content.length > 0
      ? content.reduce((sum, c) => sum + (parseFloat(c.engagementRate) || 0), 0) / content.length
      : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Content Pipeline</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Content creation and publishing tracking
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Total Content"
          value={totalContent}
          icon={FileText}
        />
        <StatCard
          title="Published"
          value={published}
          icon={CheckCircle}
          subtitle={`${totalContent > 0 ? Math.round((published / totalContent) * 100) : 0}% of total`}
        />
        <StatCard
          title="Engagement Rate"
          value={`${(avgEngagement * 100).toFixed(1)}%`}
          icon={TrendingUp}
        />
      </div>

      <Card variant="default">
        <ContentTable data={content} />
      </Card>
    </div>
  );
}
