'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu,
  X,
  LayoutDashboard,
  Crown,
  Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigation } from '@/lib/navigation';

type MobileTab = 'dashboard' | 'agents' | 'database' | 'more';

const TAB_CONFIG: Record<MobileTab, { label: string; icon: typeof Crown }> = {
  dashboard: { label: 'Home', icon: LayoutDashboard },
  agents: { label: 'Agents', icon: Crown },
  database: { label: 'Data', icon: Database },
  more: { label: 'More', icon: Menu },
};

const AGENT_SECTION_KEYS = ['CEO', 'Operations Team'];
const DB_SECTION_KEYS = ['Strategic', 'Productivity', 'Temporal', 'Journaling', 'Knowledge', 'Financial', 'Marketing'];

export function MobileSidebar() {
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<MobileTab | null>(null);

  const visibleSections = activeTab === 'agents'
    ? navigation.filter((s) => AGENT_SECTION_KEYS.includes(s.section) || s.section === '')
    : activeTab === 'database'
    ? navigation.filter((s) => DB_SECTION_KEYS.includes(s.section))
    : activeTab === 'more'
    ? navigation
    : [];

  return (
    <>
      {/* Bottom tab bar — mobile only */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-sticky bg-elevated border-t border-border flex" role="navigation" aria-label="Mobile navigation">
        {(Object.keys(TAB_CONFIG) as MobileTab[]).map((tab) => {
          const { label, icon: Icon } = TAB_CONFIG[tab];
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(isActive ? null : tab)}
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors',
                isActive ? 'text-accent' : 'text-text-muted'
              )}
              aria-label={label}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px]">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Slide-up panel */}
      {activeTab && (
        <div className="lg:hidden fixed inset-0 z-overlay" onClick={() => setActiveTab(null)}>
          <div
            className="absolute bottom-14 left-0 right-0 max-h-[70vh] bg-elevated border-t border-border flex flex-col rounded-t-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
              <span className="font-heading text-sm font-semibold text-text-primary capitalize">
                {activeTab === 'dashboard' ? 'Quick Links' : activeTab}
              </span>
              <button
                type="button"
                onClick={() => setActiveTab(null)}
                className="p-1 rounded text-text-muted hover:text-text-primary"
                aria-label="Close panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {activeTab === 'dashboard' && (
                <div className="px-3">
                  <MobileLink href="/" pathname={pathname} onClick={() => setActiveTab(null)}>
                    <LayoutDashboard className="w-4 h-4" /> Dashboard
                  </MobileLink>
                  <MobileLink href="/monitor" pathname={pathname} onClick={() => setActiveTab(null)}>
                    <LayoutDashboard className="w-4 h-4" /> System Monitor
                  </MobileLink>
                </div>
              )}

              {visibleSections.length > 0 && visibleSections.map((navSection) => {
                if (navSection.section === '') {
                  return navSection.items.map((item) => (
                    <MobileLink
                      key={item.href}
                      href={item.href}
                      pathname={pathname}
                      onClick={() => setActiveTab(null)}
                    >
                      <item.icon className="w-4 h-4" /> {item.label}
                    </MobileLink>
                  ));
                }

                return (
                  <div key={navSection.section} className="mb-2">
                    <div className="px-4 py-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                      {navSection.section}
                    </div>
                    <div className="px-3">
                      {navSection.items.map((item) => (
                        <MobileLink
                          key={item.href}
                          href={item.href}
                          pathname={pathname}
                          onClick={() => setActiveTab(null)}
                        >
                          <item.icon className="w-4 h-4" /> {item.label}
                        </MobileLink>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileLink({ href, pathname, onClick, children }: { href: string; pathname: string; onClick: () => void; children: React.ReactNode }) {
  const isActive = pathname === href;
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors',
        isActive
          ? 'bg-accent/10 text-accent font-medium'
          : 'text-text-secondary hover:text-text-primary hover:bg-hover'
      )}
    >
      {children}
    </Link>
  );
}
