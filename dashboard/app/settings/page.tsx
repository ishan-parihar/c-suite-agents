import Link from "next/link";
import {
  Database,
  Bot,
  Palette,
  HardDrive,
  Info,
  CheckCircle2,
  XCircle,
  Download,
  Upload,
  ExternalLink,
  Code2,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getDatabaseStatus,
  getAgentConfig,
  getSystemInfo,
  type DatabaseStatus,
  type AgentConfig,
  type SystemInfo,
} from "@/lib/server/settings";

const TABS = [
  { id: "database", label: "Database", icon: Database },
  { id: "agents", label: "Agent Config", icon: Bot },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "data", label: "Data", icon: HardDrive },
  { id: "about", label: "About", icon: Info },
] as const;

type TabId = (typeof TABS)[number]["id"];

function DatabaseTab({ status }: { status: DatabaseStatus }) {
  const isHealthy = status.connectionStatus === "healthy";
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {isHealthy ? (
          <CheckCircle2 className="h-5 w-5 text-healthy" />
        ) : (
          <XCircle className="h-5 w-5 text-critical" />
        )}
        <div>
          <h3 className="text-sm font-medium text-text-primary">Database Connection</h3>
          <Badge status={isHealthy ? "healthy" : "critical"}>{isHealthy ? "Healthy" : "Unhealthy"}</Badge>
        </div>
      </div>
      <Card>
        <CardHeader>
          <h4 className="text-sm font-medium text-text-primary">Table Overview</h4>
          <p className="text-xs text-text-muted">
            {status.tables.length} tables, {status.tables.reduce((s, t) => s + t.rowCount, 0).toLocaleString()} total rows
          </p>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wider text-text-muted">Table</th>
                  <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wider text-text-muted">Rows</th>
                  <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wider text-text-muted">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {status.tables.map((table) => (
                  <tr key={table.tableName} className="border-b border-border last:border-b-0 hover:bg-hover/50 transition-colors">
                    <td className="px-3 py-2 text-text-primary font-mono text-xs">{table.tableName}</td>
                    <td className="px-3 py-2 text-right tabular text-text-secondary">{table.rowCount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-xs text-text-muted">{table.lastUpdated || "\u2014"}</td>
                  </tr>
                ))}
                {status.tables.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-text-muted">No tables found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentTab({ config }: { config: AgentConfig }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Agent Kanban Boards</h3>
        <p className="text-xs text-text-muted">{config.agents.length} agent boards configured</p>
      </div>
      {config.agents.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Bot className="h-8 w-8 text-text-muted mx-auto mb-3" />
            <p className="text-sm text-text-secondary">No agent boards found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {config.agents.map((agent) => (
            <Card key={agent.agentId} className="p-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-healthy" />
                  <span className="text-sm font-mono font-medium text-text-primary">{agent.agentId}</span>
                </div>
                <p className="text-sm text-text-secondary">{agent.boardName}</p>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span className="flex items-center gap-1"><Code2 className="h-3 w-3" />{agent.cardCount} cards</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AppearanceTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Theme</h4></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Dark Mode</p>
              <p className="text-xs text-text-muted">Default theme for the Operant Dashboard</p>
            </div>
            <Badge status="healthy">Active</Badge>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Typography</h4></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Headings</p>
              <p className="text-xs text-text-muted">Monospace for data clarity</p>
            </div>
            <span className="text-sm font-mono text-text-secondary">Fira Code</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Body</p>
              <p className="text-xs text-text-muted">Sans-serif for readability</p>
            </div>
            <span className="text-sm text-text-secondary">Fira Sans</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Font Size</h4></CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {(["small", "medium", "large"] as const).map((size) => (
              <div
                key={size}
                className={cn(
                  "px-4 py-2 rounded-md border text-sm",
                  size === "medium"
                    ? "border-accent bg-accent/10 text-text-primary"
                    : "border-border bg-surface text-text-secondary"
                )}
              >
                {size.charAt(0).toUpperCase() + size.slice(1)}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DataTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Export & Import</h4></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="relative group">
              <button className="flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text-muted cursor-not-allowed" disabled>
                <Download className="h-4 w-4" />Export Data
              </button>
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded bg-elevated border border-border px-2 py-1 text-xs text-text-primary shadow-lg z-10">Coming soon</span>
            </div>
            <div className="relative group">
              <button className="flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text-muted cursor-not-allowed" disabled>
                <Upload className="h-4 w-4" />Import Data
              </button>
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded bg-elevated border border-border px-2 py-1 text-xs text-text-primary shadow-lg z-10">Coming soon</span>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Backup Status</h4></CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" />
            <span className="text-sm text-text-secondary">Automated backups are managed by PostgreSQL</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AboutTab({ systemInfo }: { systemInfo: SystemInfo }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Version</h4></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Operant Dashboard</span>
            <span className="text-sm font-mono text-text-primary">v{systemInfo.dashboardVersion}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">PostgreSQL</span>
            <span className="text-sm font-mono text-text-primary">{systemInfo.postgresVersion}</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Tech Stack</h4></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: "Framework", value: "Next.js 15" },
              { name: "Database", value: "PostgreSQL 16" },
              { name: "ORM", value: "Drizzle ORM" },
              { name: "Runtime", value: "Node.js 20+" },
            ].map((item) => (
              <div key={item.name} className="space-y-1">
                <p className="text-xs text-text-muted">{item.name}</p>
                <p className="text-sm text-text-primary">{item.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Resources</h4></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { label: "Architecture Docs", href: "/docs/architecture" },
              { label: "GitHub Repository", href: "https://github.com/ishan-parihar/operant" },
            ].map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
              >
                {link.label}
                <ExternalLink className="h-3.5 w-3.5 text-text-muted" />
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface SettingsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const activeTab = (params.tab as TabId) || "database";
  const validTab = TABS.some((t) => t.id === activeTab) ? activeTab : "database";

  const [databaseStatus, agentConfig, systemInfo] = await Promise.all([
    getDatabaseStatus(),
    getAgentConfig(),
    getSystemInfo(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary mt-1">System configuration and preferences</p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border pb-px">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={`?tab=${tab.id}`}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap",
                validTab === tab.id
                  ? "border-accent text-text-primary"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {validTab === "database" && <DatabaseTab status={databaseStatus} />}
      {validTab === "agents" && <AgentTab config={agentConfig} />}
      {validTab === "appearance" && <AppearanceTab />}
      {validTab === "data" && <DataTab />}
      {validTab === "about" && <AboutTab systemInfo={systemInfo} />}
    </div>
  );
}
