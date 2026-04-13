import Link from "next/link";
import { ArrowLeft, Calendar, Users, TrendingUp, Target, FileText, Layers, Zap, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatDate } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";
import { getCampaignDetail } from "@/lib/server/marketing";

function statusToKey(s: string | null): StatusKey {
  if (!s) return "neutral";
  const l = s.toLowerCase();
  if (l === "active") return "healthy";
  if (l === "planned" || l === "draft") return "warning";
  if (l === "paused" || l === "cancelled") return "critical";
  return "neutral";
}

function contentStatusKey(s: string | null): StatusKey {
  if (!s) return "neutral";
  const l = s.toLowerCase();
  if (l === "published" || l === "live") return "healthy";
  if (l === "in progress" || l === "draft" || l === "in_review" || l === "in review") return "warning";
  if (l === "cancelled" || l === "rejected") return "critical";
  return "neutral";
}

async function CampaignDetail({ campaignId }: { campaignId: string }) {
  const data = await getCampaignDetail(campaignId);

  if (!data) {
    return (
      <div className="space-y-6">
        <Link href="/campaigns" className="flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Campaigns
        </Link>
        <div className="text-center py-12">
          <h2 className="text-lg font-medium text-text-muted">Campaign not found</h2>
          <p className="text-sm text-text-secondary mt-1">The campaign may have been deleted or the database is unavailable.</p>
        </div>
      </div>
    );
  }

  const { campaign, contentItems } = data;
  const reachPct = campaign.targetReach && campaign.targetReach > 0
    ? Math.round(((campaign.actualReach || 0) / campaign.targetReach) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/campaigns" className="flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <h1 className="font-heading text-2xl text-text-primary">{campaign.name}</h1>
        <Badge status={statusToKey(campaign.status)}>{campaign.status || "Unknown"}</Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Target Reach" value={campaign.targetReach?.toLocaleString("en-IN") ?? "—"} icon={Users} />
        <StatCard title="Actual Reach" value={campaign.actualReach?.toLocaleString("en-IN") ?? "—"} icon={TrendingUp} subtitle={`${reachPct}% of target`} />
        <StatCard title="Engagement" value={campaign.engagementRate ? `${(parseFloat(campaign.engagementRate) * 100).toFixed(1)}%` : "—"} icon={Target} />
        <StatCard title="Content Items" value={contentItems.length} icon={FileText} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <h3 className="font-mono text-sm font-medium text-text-primary">Campaign Details</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            {campaign.theme && (
              <div><span className="text-xs text-text-muted uppercase">Theme</span><p className="text-sm text-text-secondary">{campaign.theme}</p></div>
            )}
            {campaign.summary && (
              <div><span className="text-xs text-text-muted uppercase">Summary</span><p className="text-sm text-text-secondary">{campaign.summary}</p></div>
            )}
            <div className="flex gap-6">
              <div><span className="text-xs text-text-muted uppercase">Start</span><p className="text-sm text-text-secondary">{formatDate(campaign.startDate)}</p></div>
              <div><span className="text-xs text-text-muted uppercase">End</span><p className="text-sm text-text-secondary">{formatDate(campaign.endDate)}</p></div>
              {campaign.durationDays && <div><span className="text-xs text-text-muted uppercase">Duration</span><p className="text-sm text-text-secondary">{campaign.durationDays} days</p></div>}
            </div>
            {campaign.platforms.length > 0 && (
              <div>
                <span className="text-xs text-text-muted uppercase">Platforms</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {campaign.platforms.map((p: string) => (
                    <span key={p} className="text-xs bg-hover text-text-secondary px-2 py-0.5 rounded-md">{p}</span>
                  ))}
                </div>
              </div>
            )}
            {campaign.contentTypes.length > 0 && (
              <div>
                <span className="text-xs text-text-muted uppercase">Content Types</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {campaign.contentTypes.map((t: string) => (
                    <span key={t} className="text-xs bg-elevated text-text-secondary px-2 py-0.5 rounded-md border border-border">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {campaign.budgetAllocated && (
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-text-muted" />
                <span className="text-sm text-text-secondary">{campaign.budgetAllocated}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="font-mono text-sm font-medium text-text-primary">Performance</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            {campaign.targetReach && campaign.targetReach > 0 && (
              <ProgressBar
                value={campaign.actualReach || 0}
                max={campaign.targetReach}
                color={reachPct >= 90 ? "healthy" : reachPct >= 50 ? "warning" : "critical"}
                label={`${campaign.actualReach?.toLocaleString("en-IN") || 0} / ${campaign.targetReach.toLocaleString("en-IN")}`}
              />
            )}
            {campaign.engagementRate && (
              <div className="flex items-center gap-3">
                <TrendingUp className="w-4 h-4 text-text-muted" />
                <div className="flex-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Engagement Rate</span>
                    <span className="text-text-primary tabular">{(parseFloat(campaign.engagementRate) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            )}
            {campaign.conversionRate && (
              <div className="flex items-center gap-3">
                <Target className="w-4 h-4 text-text-muted" />
                <div className="flex-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Conversion Rate</span>
                    <span className="text-text-primary tabular">{(parseFloat(campaign.conversionRate) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            )}
            {campaign.viralScore != null && (
              <div className="flex items-center gap-3">
                <Zap className="w-4 h-4 text-text-muted" />
                <div className="flex-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Viral Score</span>
                    <span className="text-text-primary tabular">{campaign.viralScore}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(campaign.demographics || campaign.psychographics || campaign.seoKeywords) && (
        <Card>
          <CardHeader>
            <h3 className="font-mono text-sm font-medium text-text-primary">Targeting</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            {campaign.demographics && (
              <div><span className="text-xs text-text-muted uppercase">Demographics</span><p className="text-sm text-text-secondary mt-1">{campaign.demographics}</p></div>
            )}
            {campaign.psychographics && (
              <div><span className="text-xs text-text-muted uppercase">Psychographics</span><p className="text-sm text-text-secondary mt-1">{campaign.psychographics}</p></div>
            )}
            {campaign.seoKeywords.length > 0 && (
              <div>
                <span className="text-xs text-text-muted uppercase">SEO Keywords</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {campaign.seoKeywords.map((k: string) => (
                    <span key={k} className="text-xs bg-elevated text-text-secondary px-2 py-0.5 rounded-md border border-border">{k}</span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {contentItems.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-text-secondary" />
              <h3 className="font-mono text-sm font-medium text-text-primary">Content Pipeline ({contentItems.length})</h3>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {contentItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate">{item.name}</p>
                    <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
                      {item.platforms.length > 0 && <span>{item.platforms.join(", ")}</span>}
                      {item.publishDate && <span>{formatDate(item.publishDate)}</span>}
                    </div>
                  </div>
                  <Badge status={contentStatusKey(item.status)}>{item.status || "Unknown"}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {campaign.projects.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="font-mono text-sm font-medium text-text-primary">Linked Projects</h3>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {campaign.projects.map((p: string) => (
                <span key={p} className="text-sm bg-elevated text-text-secondary px-3 py-1 rounded-md border border-border">{p}</span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetail campaignId={id} />;
}
