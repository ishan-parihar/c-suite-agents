import {
  getDatabaseStatus,
  getAgentConfig,
  getSystemInfo,
} from "@/lib/server/settings";
import { SettingsClient } from "./_components/settings-client";

interface SettingsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

const VALID_TABS = ["database", "agents", "appearance", "data", "about"] as const;
type TabId = (typeof VALID_TABS)[number];

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const activeTab = (VALID_TABS.includes(params.tab as TabId) ? params.tab : "database") as TabId;

  const [databaseStatus, agentConfig, systemInfo] = await Promise.all([
    getDatabaseStatus(),
    getAgentConfig(),
    getSystemInfo(),
  ]);

  return (
    <SettingsClient
      databaseStatus={databaseStatus}
      agentConfig={agentConfig}
      systemInfo={systemInfo}
      activeTab={activeTab}
    />
  );
}
