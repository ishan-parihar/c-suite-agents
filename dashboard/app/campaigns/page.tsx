import Link from "next/link";
import {
  Megaphone,
  TrendingUp,
  Users,
  Target,
  Calendar,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatCard } from "@/components/ui/stat-card";
import { truncate } from "@/lib/utils";
import type { StatusKey } from "@/lib/constants";
import { getCampaignsList } from "@/lib/server/marketing";

function statusToBadgeKey(status: string | null): StatusKey {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s === "active") return "healthy";
  if (s === "planned" || s === "draft") return "warning";
  if (s === "completed" || s === "archived") return "neutral";
  if (s === "paused" || s === "cancelled") return "critical";
  return "neutral";
}

function reachProgressColor(actual: number | null, target: number | null): "healthy" | "warning" | "critical" | "accent" {
  if (!target || target === 0) return "accent";
  const ratio = (actual || 0) / target;
  if (ratio >= 0.9) return "healthy";
  if (ratio >= 0.5) return "warning";
  return "critical";
}

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
}

function statusColorVar(status: string | null): string {
  if (!status) return "var(--status-neutral)";
  const s = status.toLowerCase();
  if (s === "active") return "var(--status-healthy)";
  if (s === "planned" || s === "draft") return "var(--status-warning)";
  if (s === "paused" || s === "cancelled") return "var(--status-critical)";
  return "var(--status-neutral)";
}

export default async function CampaignsPage() {
  const campaigns = await getCampaignsList();

  const totalCampaigns = campaigns.length;
  const activeCampaigns = campaigns.filter((c) => c.status?.toLowerCase() === "active").length;
  const totalReach = campaigns.reduce((sum, c) => sum + (Number(c.actualReach) || 0), 0);
  const avgEngagement =
    campaigns.length > 0
      ? campaigns.reduce((sum, c) => sum + (parseFloat(c.engagementRate) || 0), 0) / campaigns.length
      : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Campaigns</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Marketing campaigns and performance tracking
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Campaigns"
          value={totalCampaigns}
          icon={Megaphone}
        />
        <StatCard
          title="Active Campaigns"
          value={activeCampaigns}
          icon={TrendingUp}
          subtitle={`${totalCampaigns > 0 ? Math.round((activeCampaigns / totalCampaigns) * 100) : 0}% of total`}
        />
        <StatCard
          title="Total Reach"
          value={totalReach.toLocaleString("en-IN")}
          icon={Users}
        />
        <StatCard
          title="Avg Engagement Rate"
          value={`${(avgEngagement * 100).toFixed(1)}%`}
          icon={Target}
        />
      </div>

      {campaigns.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {campaigns.map((campaign) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`}>
              <Card
                variant="default"
                className="h-full hover:border-border-strong transition-colors"
              >
                <CardContent className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <h3 className="font-medium text-text-primary truncate">
                        {campaign.name}
                      </h3>
                      <Badge status={statusToBadgeKey(campaign.status)}>
                        {campaign.status || "Unknown"}
                      </Badge>
                    </div>
                    <ExternalLink className="w-4 h-4 text-text-muted flex-shrink-0 mt-1" />
                  </div>

                  {campaign.platforms.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {campaign.platforms.map((p: string) => (
                        <span
                          key={p}
                          className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-hover text-text-secondary"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>
                      {formatDate(campaign.startDate)} &rarr; {formatDate(campaign.endDate)}
                    </span>
                    {campaign.durationDays && (
                      <span className="text-text-muted">
                        ({campaign.durationDays}d)
                      </span>
                    )}
                  </div>

                  {campaign.theme && (
                    <p className="text-xs text-text-muted">
                      Theme: {campaign.theme}
                    </p>
                  )}

                  {campaign.summary && (
                    <p className="text-sm text-text-secondary line-clamp-2">
                      {truncate(campaign.summary, 120)}
                    </p>
                  )}

                  {campaign.targetReach && campaign.targetReach > 0 && (
                    <ProgressBar
                      value={campaign.actualReach || 0}
                      max={campaign.targetReach}
                      color={reachProgressColor(campaign.actualReach, campaign.targetReach)}
                      label={`${campaign.actualReach?.toLocaleString("en-IN") || 0} / ${campaign.targetReach.toLocaleString("en-IN")}`}
                    />
                  )}

                  <div className="flex items-center justify-between text-xs text-text-muted pt-1 border-t border-border">
                    <span>{campaign.contentCount} content items</span>
                    {campaign.budgetAllocated && (
                      <span>Budget: {campaign.budgetAllocated}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card variant="default">
          <EmptyState
            icon={Megaphone}
            title="No campaigns found"
            description="Create your first marketing campaign to get started."
          />
        </Card>
      )}

      {campaigns.length > 0 && <CampaignCalendar campaigns={campaigns} />}
    </div>
  );
}

function CampaignCalendar({
  campaigns,
}: {
  campaigns: Array<{
    id: string;
    name: string;
    startDate: Date | string | null;
    endDate: Date | string | null;
    status: string | null;
  }>;
}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  const monthName = firstDay.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
  for (let i = 0; i < startDayOfWeek; i++) {
    days.push({ date: new Date(year, month, -startDayOfWeek + i + 1), isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }

  function getCampaignsForDay(date: Date) {
    return campaigns.filter((c) => {
      if (!c.startDate || !c.endDate) return false;
      const start = c.startDate instanceof Date ? c.startDate : new Date(c.startDate);
      const end = c.endDate instanceof Date ? c.endDate : new Date(c.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
      return date >= start && date <= end;
    });
  }

  return (
    <Card variant="default">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-text-secondary" />
          <h2 className="text-lg font-medium text-text-primary">{monthName}</h2>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="text-xs text-text-muted text-center py-1">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((day, idx) => {
            const dayCampaigns = day.isCurrentMonth ? getCampaignsForDay(day.date) : [];
            const isToday = day.date.toDateString() === now.toDateString();

            return (
              <div
                key={idx}
                className={`min-h-[60px] rounded-md p-1 border ${
                  day.isCurrentMonth
                    ? isToday
                      ? "border-accent bg-accent/10"
                      : "border-border bg-surface"
                    : "border-transparent"
                }`}
              >
                {day.isCurrentMonth && (
                  <>
                    <div
                      className={`text-xs mb-1 ${
                        isToday ? "text-accent font-semibold" : "text-text-muted"
                      }`}
                    >
                      {day.date.getDate()}
                    </div>
                    <div className="space-y-0.5">
                      {dayCampaigns.slice(0, 2).map((c) => (
                        <div
                          key={c.id}
                          className="text-[10px] px-1 py-0.5 rounded truncate"
                          style={{
                            backgroundColor: `${statusColorVar(c.status)}30`,
                            color: statusColorVar(c.status),
                          }}
                          title={c.name}
                        >
                          {c.name}
                        </div>
                      ))}
                      {dayCampaigns.length > 2 && (
                        <div className="text-[10px] text-text-muted">
                          +{dayCampaigns.length - 2} more
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
