import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, truncate } from "@/lib/utils";
import { getCalendarEvents, type CalendarEvent } from "@/lib/server/calendar";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MAX_EVENTS_PER_CELL = 3;

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  project: { label: "Project", color: "var(--accent-secondary)" },
  campaign: { label: "Campaign", color: "var(--status-warning)" },
  activity: { label: "Activity", color: "var(--status-healthy)" },
  content: { label: "Content", color: "#8B5CF6" },
};

function getMonthDates(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const dates: (number | null)[][] = [];
  let day = 1;
  for (let week = 0; week < 6; week++) {
    const weekDates: (number | null)[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const weekIndex = week * 7 + dow;
      if (weekIndex < startOffset || day > daysInMonth) {
        weekDates.push(null);
      } else {
        weekDates.push(day);
        day++;
      }
    }
    dates.push(weekDates);
    if (day > daysInMonth) break;
  }
  return { dates };
}

function getEventsForDate(events: CalendarEvent[], year: number, month: number, day: number): CalendarEvent[] {
  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return events.filter((e) => {
    const eventDate = e.date?.split("T")[0];
    if (eventDate === dateStr) return true;
    if (e.endDate) {
      const startDate = e.date?.split("T")[0];
      if (startDate && startDate <= dateStr && dateStr <= e.endDate.split("T")[0]) return true;
    }
    return false;
  });
}

function CalendarGrid({ events, year, month }: { events: CalendarEvent[]; year: number; month: number }) {
  const { dates } = getMonthDates(year, month);

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7">
        {DAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-text-muted">
            {d}
          </div>
        ))}
      </div>
      <div className="space-y-px">
        {dates.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day, di) => {
              if (!day) return <div key={`e-${di}`} className="min-h-[5rem] border-t border-l border-border bg-surface/50 p-1" />;
              const dayEvents = getEventsForDate(events, year, month, day);
              const visible = dayEvents.slice(0, MAX_EVENTS_PER_CELL);
              const overflow = dayEvents.length - MAX_EVENTS_PER_CELL;
              return (
                <div key={di} className={cn("relative min-h-[5rem] border-t border-l border-border bg-surface p-1 transition-colors", dayEvents.length > 0 && "hover:bg-elevated")}>
                  <span className="text-sm font-medium text-text-secondary">{day}</span>
                  <div className="mt-1 space-y-0.5">
                    {visible.map((evt) => {
                      const cfg = TYPE_CONFIG[evt.type] || TYPE_CONFIG.activity;
                      return (
                        <Link key={evt.id} href={evt.href} className="group relative flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-hover" style={{ borderLeft: `2px solid ${cfg.color}` }} aria-label={`${evt.title} - ${cfg.label}`}>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cfg.color }} aria-hidden="true" />
                          <span className="truncate text-text-secondary group-hover:text-text-primary">{truncate(evt.title, 16)}</span>
                          <div className="pointer-events-none absolute -top-8 left-0 z-10 rounded bg-elevated border border-border px-2 py-1 text-xs shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="font-medium text-text-primary">{truncate(evt.title, 32)}</div>
                            <div className="text-text-muted">{cfg.label}</div>
                          </div>
                        </Link>
                      );
                    })}
                    {overflow > 0 && <div className="text-xs text-text-muted px-1">+{overflow} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarList({ events, year, month }: { events: CalendarEvent[]; year: number; month: number }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysWithEvents: { day: number; events: CalendarEvent[] }[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const de = getEventsForDate(events, year, month, day);
    if (de.length > 0) daysWithEvents.push({ day, events: de });
  }
  if (daysWithEvents.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-text-muted">No events this month</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {daysWithEvents.map(({ day, events: de }) => (
        <div key={day} className="rounded-lg border border-border bg-surface p-3">
          <div className="text-sm font-medium text-text-secondary mb-2">{MONTHS[month]} {day}</div>
          <div className="space-y-1.5">
            {de.map((evt) => {
              const cfg = TYPE_CONFIG[evt.type] || TYPE_CONFIG.activity;
              return (
                <Link key={evt.id} href={evt.href} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover transition-colors" aria-label={`${evt.title} - ${cfg.label}`}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cfg.color }} aria-hidden="true" />
                  <span className="text-sm text-text-primary truncate">{evt.title}</span>
                  <span className="ml-auto text-xs text-text-muted shrink-0">{cfg.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface CalendarPageProps {
  searchParams: Promise<{ month?: string; view?: string }>;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const params = await searchParams;
  const now = new Date();
  const [yearStr, monthStr] = (params.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`).split("-");
  const viewYear = parseInt(yearStr) || now.getFullYear();
  const viewMonth = (parseInt(monthStr) || now.getMonth() + 1) - 1;
  const view = params.view === "list" ? "list" : "grid";

  const events = await getCalendarEvents(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`);

  const prevM = viewMonth === 0 ? { month: `${viewYear - 1}-12`, year: viewYear - 1, m: 11 } : { month: `${viewYear}-${String(viewMonth).padStart(2, "0")}`, year: viewYear, m: viewMonth - 1 };
  const nextM = viewMonth === 11 ? { month: `${viewYear + 1}-01`, year: viewYear + 1, m: 0 } : { month: `${viewYear}-${String(viewMonth + 2).padStart(2, "0")}`, year: viewYear, m: viewMonth + 1 };
  const todayM = { month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, year: now.getFullYear(), m: now.getMonth() };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Calendar</h1>
        <p className="text-sm text-text-secondary mt-1">Unified temporal view across all domains</p>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href={`?month=${prevM.month}&view=${view}`} className="rounded-md border border-border bg-surface p-2 text-text-secondary hover:bg-hover transition-colors" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h2 className="text-lg font-medium font-heading text-text-primary min-w-[200px] text-center">{MONTHS[viewMonth]} {viewYear}</h2>
          <Link href={`?month=${nextM.month}&view=${view}`} className="rounded-md border border-border bg-surface p-2 text-text-secondary hover:bg-hover transition-colors" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {!(viewYear === now.getFullYear() && viewMonth === now.getMonth()) && (
            <Link href={`?month=${todayM.month}&view=${view}`} className="text-xs text-text-muted hover:text-text-secondary transition-colors px-2 py-1 rounded border border-border bg-surface">Today</Link>
          )}
          <div className="flex rounded-md border border-border bg-surface overflow-hidden">
            <Link href={`?month=${params.month || todayM.month}&view=grid`} className={cn("px-3 py-1.5 text-xs transition-colors", view === "grid" ? "bg-elevated text-text-primary" : "text-text-muted hover:text-text-secondary")} aria-label="Month view">
              Month
            </Link>
            <Link href={`?month=${params.month || todayM.month}&view=list`} className={cn("px-3 py-1.5 text-xs transition-colors", view === "list" ? "bg-elevated text-text-primary" : "text-text-muted hover:text-text-secondary")} aria-label="List view">
              List
            </Link>
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        {view === "grid" ? (
          <CalendarGrid events={events} year={viewYear} month={viewMonth} />
        ) : (
          <CalendarList events={events} year={viewYear} month={viewMonth} />
        )}
      </div>

      <div className="md:hidden">
        <CalendarList events={events} year={viewYear} month={viewMonth} />
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border">
        <span className="text-xs text-text-muted uppercase tracking-wider">Legend</span>
        {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.color }} />
            <span className="text-xs text-text-secondary">{cfg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
