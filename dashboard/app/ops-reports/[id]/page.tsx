import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { BarChart3 } from "lucide-react";
import { formatDate } from "@/lib/formatters";
import { getReportDetail } from "@/lib/server/reports";

interface DetailPageProps {
  params: Promise<{ id: string }>;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton variant="text" lines={2} className="mb-6" />
      <Skeleton variant="card" lines={4} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="stat" />
        ))}
      </div>
    </div>
  );
}

function isStructuredMetrics(obj: unknown): obj is Record<string, unknown> {
  return (
    typeof obj === "object" &&
    obj !== null &&
    !Array.isArray(obj) &&
    Object.keys(obj).length > 0
  );
}

function isActionsArray(obj: unknown): obj is Array<{
  description?: string;
  status?: string;
  [key: string]: unknown;
}> {
  return Array.isArray(obj) && obj.length > 0;
}

function MetricsSection({ metrics }: { metrics: unknown }) {
  if (!metrics) {
    return (
      <p className="text-sm text-text-muted">No metrics data available</p>
    );
  }

  if (isStructuredMetrics(metrics)) {
    const entries = Object.entries(metrics);
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {entries.map(([key, value]) => (
          <StatCard
            key={key}
            title={key}
            value={
              typeof value === "number"
                ? value.toLocaleString()
                : typeof value === "boolean"
                ? value ? "Yes" : "No"
                : typeof value === "string"
                ? value
                : JSON.stringify(value)
            }
            icon={BarChart3}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="prose prose-sm prose-invert max-w-none">
      <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans bg-elevated rounded-md p-4">
        {typeof metrics === "string" ? metrics : JSON.stringify(metrics, null, 2)}
      </pre>
    </div>
  );
}

function ActionsSection({ actions }: { actions: unknown }) {
  if (!actions) {
    return (
      <p className="text-sm text-text-muted">No actions recorded</p>
    );
  }

  if (isActionsArray(actions)) {
    return (
      <div className="space-y-3">
        {actions.map((action, i) => {
          const description = String(action.description ?? action.title ?? action.text ?? `Action ${i + 1}`);
          const status = String(action.status ?? action.state ?? "");
          const isComplete = status === "completed" || status === "done" || status === "complete";
          const isFailed = status === "failed" || status === "error";

          return (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface"
            >
              <div className="mt-0.5 flex-shrink-0">
                {isComplete ? (
                  <CheckCircle2 className="w-4 h-4 text-healthy" />
                ) : isFailed ? (
                  <AlertCircle className="w-4 h-4 text-critical" />
                ) : (
                  <Circle className="w-4 h-4 text-text-muted" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">{String(description)}</p>
                {status && (
                  <p className="text-xs text-text-muted mt-0.5 font-mono">{status}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans bg-elevated rounded-md p-4">
      {typeof actions === "string" ? actions : JSON.stringify(actions, null, 2)}
    </pre>
  );
}

async function ReportDetail({ id }: { id: string }) {
  const report = await getReportDetail(id);

  if (!report) {
    return (
      <div className="bg-surface border border-border rounded-lg px-5 py-12 text-center text-sm text-text-muted">
        Report not found
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/ops-reports"
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Reports
        </Link>
      </div>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-elevated text-sm font-mono text-text-secondary">
            {report.agentId}
          </span>
          <h1 className="text-2xl font-heading font-semibold tracking-tight">
            {report.period ?? "Untitled Report"}
          </h1>
        </div>
        <p className="text-sm text-text-secondary">
          Generated on {formatDate(report.createdAt, "yyyy-MM-dd HH:mm")}
        </p>
      </div>

      {report.summary && (
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-sm font-heading font-medium text-text-primary">
              Summary
            </h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-primary whitespace-pre-wrap">
              {report.summary}
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-sm font-heading font-medium text-text-primary">
            Metrics
          </h2>
        </CardHeader>
        <CardContent>
          <MetricsSection metrics={report.metrics} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-heading font-medium text-text-primary">
            Actions
          </h2>
        </CardHeader>
        <CardContent>
          <ActionsSection actions={report.actions} />
        </CardContent>
      </Card>
    </div>
  );
}

export default async function ReportDetailPage({ params }: DetailPageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={<DetailSkeleton />}>
      <ReportDetail id={id} />
    </Suspense>
  );
}
