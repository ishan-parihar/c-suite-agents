import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, FileText, MessageSquare } from "lucide-react";
import { getMeetingDetail } from "@/lib/server/meetings";
import { Card, CardContent } from "@/components/ui/card";
import TurnsAccordion from "./_components/turns-accordion";

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

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString();
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meeting = await getMeetingDetail(id);

  if (!meeting) {
    notFound();
  }

  const statusConfig = meetingStatusConfig(meeting.status);

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/meetings"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Meetings
        </Link>
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-text-primary">
            Meeting — {meeting.date ? new Date(meeting.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }) : "Unknown Date"}
          </h1>
          <StatusBadge color={statusConfig.color} label={statusConfig.label} />
        </div>
        {meeting.objective && (
          <p className="text-text-secondary mt-2">{meeting.objective}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Card className="bg-surface border-border">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-text-secondary text-sm mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Started</span>
            </div>
            <p className="text-text-primary tabular">{formatDateTime(meeting.startedAt)}</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-text-secondary text-sm mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Concluded</span>
            </div>
            <p className="text-text-primary tabular">{formatDateTime(meeting.concludedAt)}</p>
          </CardContent>
        </Card>
      </div>

      {meeting.turns.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-text-primary mb-3 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-text-secondary" />
            Turns ({meeting.turns.length})
          </h2>
          <TurnsAccordion turns={meeting.turns} />
        </div>
      )}

      {(meeting.userDecision || meeting.userFeedback || meeting.report) && (
        <div className="space-y-4">
          {meeting.report && (
            <Card className="bg-surface border-border">
              <CardContent className="py-3">
                <div className="flex items-center gap-2 text-text-secondary text-sm mb-2">
                  <FileText className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Report</span>
                </div>
                <p className="text-sm text-text-primary whitespace-pre-wrap">{meeting.report}</p>
              </CardContent>
            </Card>
          )}
          {meeting.userDecision && (
            <Card className="bg-surface border-border">
              <CardContent className="py-3">
                <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary mb-2">
                  User Decision
                </h3>
                <p className="text-sm text-text-primary whitespace-pre-wrap">
                  {meeting.userDecision}
                </p>
              </CardContent>
            </Card>
          )}
          {meeting.userFeedback && (
            <Card className="bg-surface border-border">
              <CardContent className="py-3">
                <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary mb-2">
                  User Feedback
                </h3>
                <p className="text-sm text-text-primary whitespace-pre-wrap">
                  {meeting.userFeedback}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
