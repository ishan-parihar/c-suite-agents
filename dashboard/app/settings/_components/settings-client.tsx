"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Download,
  Upload,
  Clock,
  Database,
  Bot,
  Palette,
  HardDrive,
  Info,
  Code2,
  ExternalLink,
  RefreshCw,
  Save,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DatabaseStatus, AgentConfig, SystemInfo, AgentBoard } from "@/lib/server/settings";

const TABS = [
  { id: "database", label: "Database", icon: Database },
  { id: "agents", label: "Agent Config", icon: Bot },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "data", label: "Data", icon: HardDrive },
  { id: "about", label: "About", icon: Info },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ── Database Tab (unchanged) ────────────────────────────────────────────────

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

// ── Agent Config Tab (with forms) ───────────────────────────────────────────

interface AgentConfigClientProps {
  config: AgentConfig;
}

function AgentTabClient({ config }: AgentConfigClientProps) {
  const [agents, setAgents] = useState<AgentBoard[]>(config.agents);
  const [agentSettings, setAgentSettings] = useState<Record<string, { autonomy: string; heartbeat: string; model: string }>>({});
  const [saving, setSaving] = useState(false);
  const [savedAgentId, setSavedAgentId] = useState<string | null>(null);

  const AGENT_MODELS = ["llama3.1:8b", "qwen2.5:7b", "qwen3:8b", "qwen-proxy/llama-4-maverick", "qwen-proxy/gpt-4o"];
  const AUTONOMY_LEVELS = ["autonomous", "supervised", "manual"];

  const updateSetting = (agentId: string, field: string, value: string) => {
    setAgentSettings((prev) => ({
      ...prev,
      [agentId]: { ...prev[agentId], [field]: value },
    }));
  };

  const handleSave = async (agentId: string) => {
    const settings = agentSettings[agentId];
    if (!settings) return;
    setSaving(true);
    try {
      const existing = JSON.parse(localStorage.getItem("agent-config") || "{}");
      existing[agentId] = settings;
      localStorage.setItem("agent-config", JSON.stringify(existing));
      setSavedAgentId(agentId);
      setTimeout(() => setSavedAgentId(null), 2000);
    } catch {
      // silent fail
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Agent Kanban Boards</h3>
        <p className="text-xs text-text-muted">{agents.length} agent boards configured</p>
      </div>
      {agents.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Bot className="h-8 w-8 text-text-muted mx-auto mb-3" />
            <p className="text-sm text-text-secondary">No agent boards found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {agents.map((agent) => {
            const settings = agentSettings[agent.agentId] || { autonomy: "supervised", heartbeat: "30", model: "qwen3:8b" };
            return (
              <Card key={agent.agentId} className="p-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-healthy" />
                      <span className="text-sm font-mono font-medium text-text-primary">{agent.agentId}</span>
                    </div>
                    {savedAgentId === agent.agentId ? (
                      <Badge status="healthy">Saved</Badge>
                    ) : (
                      <button
                        onClick={() => handleSave(agent.agentId)}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-text-primary rounded-md hover:bg-accent-hover transition-colors disabled:opacity-40"
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-text-secondary">{agent.boardName}</p>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span className="flex items-center gap-1"><Code2 className="h-3 w-3" />{agent.cardCount} cards</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Autonomy Level</label>
                      <select
                        value={settings.autonomy}
                        onChange={(e) => updateSetting(agent.agentId, "autonomy", e.target.value)}
                        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-border-strong focus:outline-none"
                      >
                        {AUTONOMY_LEVELS.map((level) => (
                          <option key={level} value={level}>{level.charAt(0).toUpperCase() + level.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Heartbeat (min)</label>
                      <input
                        type="number"
                        min={5}
                        max={120}
                        value={settings.heartbeat}
                        onChange={(e) => updateSetting(agent.agentId, "heartbeat", e.target.value)}
                        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-border-strong focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Model</label>
                      <select
                        value={settings.model}
                        onChange={(e) => updateSetting(agent.agentId, "model", e.target.value)}
                        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-border-strong focus:outline-none"
                      >
                        {AGENT_MODELS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Appearance Tab (unchanged) ──────────────────────────────────────────────

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

// ── Data Tab (with backup/export) ───────────────────────────────────────────

function DataTabClient() {
  const [exporting, setExporting] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const handleExport = async (format: "json" | "csv") => {
    setExporting(true);
    try {
      const res = await fetch(`/api/crud/message-threads?limit=1000`);
      if (!res.ok) return;
      const data = await res.json();
      const items = data.data.items || [];

      if (format === "json") {
        const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `operant-export-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const headers = Object.keys(items[0] || {}).join(",");
        const rows = items.map((item: Record<string, unknown>) =>
          Object.values(item).map((v) => `"${JSON.stringify(v).replace(/"/g, '""')}"`).join(",")
        );
        const csv = [headers, ...rows].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `operant-export-${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setLastAction(`Exported ${items.length} records as ${format.toUpperCase()}`);
    } catch {
      setLastAction("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleBackup = async () => {
    setBackupRunning(true);
    try {
      const [threadsRes, agentConfig] = await Promise.all([
        fetch(`/api/crud/message-threads?limit=1000`),
        Promise.resolve(JSON.parse(localStorage.getItem("agent-config") || "{}")),
      ]);

      const data: Record<string, unknown> = {
        backupTimestamp: new Date().toISOString(),
        agentConfig,
        messageThreads: threadsRes.ok ? await threadsRes.json() : null,
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `operant-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setLastAction("Backup exported successfully");
    } catch {
      setLastAction("Backup export failed");
    } finally {
      setBackupRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Export Data</h4></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleExport("json")}
              disabled={exporting}
              className="flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text-primary hover:bg-hover transition-colors disabled:opacity-40"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export JSON
            </button>
            <button
              onClick={() => handleExport("csv")}
              disabled={exporting}
              className="flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text-primary hover:bg-hover transition-colors disabled:opacity-40"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export CSV
            </button>
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
        <CardHeader><h4 className="text-sm font-medium text-text-primary">Backup Management</h4></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" />
            <span className="text-sm text-text-secondary">Automated backups are managed by PostgreSQL</span>
          </div>
          <button
            onClick={handleBackup}
            disabled={backupRunning}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text-primary hover:bg-hover transition-colors disabled:opacity-40"
          >
            {backupRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Trigger Manual Backup
          </button>
          {lastAction && (
            <p className="text-xs text-text-muted">{lastAction}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── About Tab (unchanged) ───────────────────────────────────────────────────

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

// ── Main Settings Client ────────────────────────────────────────────────────

interface SettingsClientProps {
  databaseStatus: DatabaseStatus;
  agentConfig: AgentConfig;
  systemInfo: SystemInfo;
  activeTab: TabId;
}

export function SettingsClient({ databaseStatus, agentConfig, systemInfo, activeTab }: SettingsClientProps) {
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
                activeTab === tab.id
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

      {activeTab === "database" && <DatabaseTab status={databaseStatus} />}
      {activeTab === "agents" && <AgentTabClient config={agentConfig} />}
      {activeTab === "appearance" && <AppearanceTab />}
      {activeTab === "data" && <DataTabClient />}
      {activeTab === "about" && <AboutTab systemInfo={systemInfo} />}
    </div>
  );
}
