import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/formatters";
import { getSessionDetail, getToolUsageBySession } from "@/lib/server/sessions";
import { TabBar, TabPanel, useTabSwitcher } from "./tab-switcher";
import { MessagesTimeline } from "./messages-timeline";
import { ToolCallsTable } from "./tool-calls-table";
import { ToolUsageChart } from "./tool-usage-chart";

interface DetailPageProps {
  params: Promise<{ id: string }>;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton variant="text" lines={2} className="mb-6" />
      <Skeleton variant="card" lines={4} />
      <Skeleton variant="card" lines={8} />
    </div>
  );
}

async function SessionDetail({ id }: { id: string }) {
  const { session, messages, toolCalls } = await getSessionDetail(id);
  const toolUsage = await getToolUsageBySession(id);

  if (!session) {
    return (
      <div className="bg-surface border border-border rounded-lg px-5 py-12 text-center text-sm text-text-muted">
        Session not found
      </div>
    );
  }

  const tabs = [
    { id: "messages", label: `Messages (${messages.length})` },
    { id: "toolcalls", label: `Tool Calls (${toolCalls.length})` },
  ];

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/sessions"
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Sessions
        </Link>
      </div>

      <div className="mb-8">
        <div className="flex items-start gap-4 mb-4">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-elevated text-sm font-mono text-text-secondary">
            {session.agentId}
          </span>
          <h1 className="text-2xl font-heading font-semibold tracking-tight">
            {session.title ?? "Untitled Session"}
          </h1>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-text-muted uppercase tracking-wider">Workspace</p>
              <p className="text-sm font-mono text-text-primary mt-1 truncate" title={session.workspacePath ?? ""}>
                {session.workspacePath ?? "N/A"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-text-muted uppercase tracking-wider">Compactions</p>
              <p className="text-xl font-mono font-semibold tabular-nums mt-1">
                {session.compactionCount ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-text-muted uppercase tracking-wider">Messages</p>
              <p className="text-xl font-mono font-semibold tabular-nums mt-1">
                {messages.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-text-muted uppercase tracking-wider">Last Used</p>
              <p className="text-sm text-text-secondary mt-1">
                {formatDate(session.lastUsed, "yyyy-MM-dd HH:mm")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {toolUsage.length > 0 && (
        <div className="mb-6">
          <ToolUsageChart data={toolUsage} />
        </div>
      )}

      <SessionTabs tabs={tabs} messages={messages} toolCalls={toolCalls} />
    </div>
  );
}

function SessionTabs({
  tabs,
  messages,
  toolCalls,
}: {
  tabs: { id: string; label: string }[];
  messages: {
    id: string;
    messageIndex: number;
    role: string;
    content: string;
    tokenEstimate: number | null;
    isSummary: boolean | null;
    compacted: boolean | null;
    timestamp: Date;
  }[];
  toolCalls: {
    id: string;
    toolIndex: number;
    callId: string | null;
    name: string;
    arguments: unknown;
    result: unknown;
    tokenEstimate: number | null;
    compacted: boolean | null;
    timestamp: Date;
  }[];
}) {
  const { activeTab, setActiveTab } = useTabSwitcher(tabs);

  return (
    <div className="space-y-4">
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      <TabPanel isActive={activeTab === "messages"}>
        <MessagesTimeline messages={messages} />
      </TabPanel>
      <TabPanel isActive={activeTab === "toolcalls"}>
        <ToolCallsTable toolCalls={toolCalls} />
      </TabPanel>
    </div>
  );
}

export default async function SessionDetailPage({ params }: DetailPageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={<DetailSkeleton />}>
      <SessionDetail id={id} />
    </Suspense>
  );
}
