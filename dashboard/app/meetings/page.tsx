import Link from "next/link";
import { getMeetingsList } from "@/lib/server/meetings";
import { cn, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

function meetingStatusConfig(status: string | null): { color: string; label: string } {
  switch (status) {
    case "scheduled":
      return { color: "var(--status-neutral)", label: "Scheduled" };
    case "in_progress":
      return { color: "var(--status-warning)", label: "In Progress" };
    case "concluded":
      return { color: "var(--status-healthy)", label: "Concluded" };
    default:
      return { color: "var(--status-neutral)", label: status ?? "Unknown" };
  }
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calcDuration(startedAt: Date | null, concludedAt: Date | null): string {
  if (!startedAt || !concludedAt) return "—";
  const diffMs = new Date(concludedAt).getTime() - new Date(startedAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const statusFilter = params.status ?? "all";
  const meetings = await getMeetingsList();

  const filtered = meetings.filter((m) => statusFilter === "all" || m.status === statusFilter);

  const filterOptions = [
    { value: "all", label: "All" },
    { value: "scheduled", label: "Scheduled" },
    { value: "in_progress", label: "In Progress" },
    { value: "concluded", label: "Concluded" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Board Meetings</h1>
        <p className="text-text-secondary mt-1">Quorum-based decision meetings with turn-by-turn records</p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        {filterOptions.map((opt) => (
          <Link
            key={opt.value}
            href={opt.value === "all" ? "/meetings" : `/meetings?status=${opt.value}`}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md border border-border transition-colors",
              statusFilter === opt.value
                ? "bg-accent/10 border-border-strong text-text-primary"
                : "bg-surface text-text-secondary hover:bg-hover"
            )}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  Objective
                </th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  Turns
                </th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  Duration
                </th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-text-muted">
                    No meetings found
                  </td>
                </tr>
              ) : (
                filtered.map((meeting) => {
                  const statusConfig = meetingStatusConfig(meeting.status);
                  return (
                    <tr
                      key={meeting.id}
                      className="border-b border-border last:border-b-0 hover:bg-hover/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-text-primary tabular">
                        {formatDate(meeting.date)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge color={statusConfig.color} label={statusConfig.label} />
                      </td>
                      <td className="px-4 py-3 text-text-primary max-w-xs">
                        {truncate(meeting.objective ?? "No objective", 80)}
                      </td>
                      <td className="px-4 py-3 text-text-secondary tabular">
                        {meeting.turnCount}
                      </td>
                      <td className="px-4 py-3 text-text-secondary tabular">
                        {calcDuration(meeting.startedAt, meeting.concludedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/meetings/${meeting.id}`}
                          className="text-accent-secondary hover:text-text-primary text-sm transition-colors"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
