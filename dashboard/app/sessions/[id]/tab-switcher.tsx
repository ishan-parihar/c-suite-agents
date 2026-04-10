"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function useTabSwitcher(tabs: { id: string; label: string }[], defaultTab?: string) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id ?? "");
  return { activeTab, setActiveTab };
}

export function TabBar({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: { id: string; label: string }[];
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === tab.id
              ? "border-accent-secondary text-text-primary"
              : "border-transparent text-text-muted hover:text-text-secondary"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  isActive,
  children,
}: {
  isActive: boolean;
  children: ReactNode;
}) {
  if (!isActive) return null;
  return <>{children}</>;
}
