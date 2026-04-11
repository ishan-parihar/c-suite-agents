import { getCalendarEvents } from "@/lib/server/calendar";
import { CalendarClient } from "./_components/calendar-client";

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
    <CalendarClient
      initialEvents={events}
      year={viewYear}
      month={viewMonth}
      view={view}
      now={todayM}
      prevM={prevM}
      nextM={nextM}
      todayM={todayM}
      params={params}
    />
  );
}
