'use client';

import { useMemo } from "react";
import { Calendar } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface CampaignRow {
  id: string;
  name: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  platforms: string[];
  theme: string | null;
  summary: string | null;
  targetReach: number | null;
  actualReach: number | null;
  engagementRate: string | null;
  budgetAllocated: string | null;
  contentCount: number;
}

function statusColorVar(status: string | null): string {
  if (!status) return "var(--status-neutral)";
  const s = status.toLowerCase();
  if (s === "active") return "var(--status-healthy)";
  if (s === "planned" || s === "draft") return "var(--status-warning)";
  if (s === "paused" || s === "cancelled") return "var(--status-critical)";
  return "var(--status-neutral)";
}

export function CampaignCalendarClient({ campaigns }: { campaigns: CampaignRow[] }) {
  const calendarData = useMemo(() => {
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

    return { monthName, days, now };
  }, []);

  const getCampaignsForDay = (date: Date) => {
    return campaigns.filter((c) => {
      if (!c.startDate || !c.endDate) return false;
      const start = new Date(c.startDate);
      const end = new Date(c.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
      return date >= start && date <= end;
    });
  };

  return (
    <Card variant="default">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-text-secondary" />
          <h2 className="text-lg font-medium text-text-primary">{calendarData.monthName}</h2>
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
          {calendarData.days.map((day, idx) => {
            const dayCampaigns = day.isCurrentMonth ? getCampaignsForDay(day.date) : [];
            const isToday = day.date.toDateString() === calendarData.now.toDateString();

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
                    <div className={`text-xs mb-1 ${isToday ? "text-accent font-semibold" : "text-text-muted"}`}>
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
