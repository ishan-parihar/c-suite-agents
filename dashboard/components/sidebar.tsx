'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigation } from '@/lib/navigation';

const PILLAR_SECTIONS = new Set(['Mission Control']);
const AGENT_SECTIONS = new Set(['CEO', 'Operations Team', 'Agent Operations']);

function isPillarSection(section: string) {
  return PILLAR_SECTIONS.has(section);
}

function isAgentSection(section: string) {
  return AGENT_SECTIONS.has(section);
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => Object.fromEntries(navigation.map((s) => [s.section, true]))
  );
  const [search, setSearch] = useState('');

  const filteredNavigation = useMemo(() => {
    if (!search.trim()) return navigation;
    const q = search.toLowerCase();
    return navigation
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          item.label.toLowerCase().includes(q) ||
          item.href.toLowerCase().includes(q)
        ),
      }))
      .filter((section) => section.items.length > 0 || section.section === '');
  }, [search]);

  const toggleSection = (section: string) => {
    if (!collapsed) {
      setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
    }
  };

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 h-screen z-sidebar bg-elevated border-r border-border flex flex-col transition-all duration-200',
        collapsed ? 'w-[60px]' : 'w-64'
      )}
    >
      {/* Brand header */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-border shrink-0">
        <span
          className={cn(
            'font-heading text-text-primary text-sm font-semibold tracking-tight whitespace-nowrap transition-opacity duration-200',
            collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
          )}
        >
          Operant
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            'shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors',
            collapsed && 'mx-auto'
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4 rotate-90" />
          )}
        </button>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-3 py-2 border-b border-border">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter..."
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        </div>
      )}

      {/* Navigation */}
      <nav
        role="navigation"
        aria-label="Main navigation"
        className="flex-1 overflow-y-auto overflow-x-hidden py-2"
      >
        {filteredNavigation.map((navSection) => {
          const isSeparatorSection = navSection.section === '';
          const isOpen = openSections[navSection.section] ?? true;

          if (isSeparatorSection) {
            return (
              <div key="separator" className="mt-2 pt-2 border-t border-border">
                {navSection.items.map((item) => (
                  <SidebarItem
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            );
          }

          const isPillar = isPillarSection(navSection.section);
          const isAgent = isAgentSection(navSection.section);

          return (
            <div
              key={navSection.section}
              className={cn(
                'mb-0.5',
                isPillar && 'mb-1',
                isAgent && 'mb-0.5',
                isPillar && 'pb-1 border-b border-border/50'
              )}
            >
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleSection(navSection.section)}
                  className={cn(
                    'flex items-center w-full px-3 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors',
                    isPillar
                      ? 'text-accent/80 font-semibold'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 shrink-0" />
                  )}
                  <span className="truncate ml-1">{navSection.section}</span>
                </button>
              )}

              {isOpen && (
                <ul className="space-y-px px-1.5">
                  {navSection.items.map((item) => (
                    <SidebarItem
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      collapsed={collapsed}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

interface SidebarItemProps {
  item: {
    href: string;
    label: string;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    separator?: boolean;
  };
  pathname: string;
  collapsed: boolean;
}

function SidebarItem({ item, pathname, collapsed }: SidebarItemProps) {
  const isActive = pathname === item.href;

  if (collapsed) {
    return (
      <li>
        <Link
          href={item.href}
          className={cn(
            'flex items-center justify-center w-9 h-9 mx-auto rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors relative group',
            isActive && 'bg-accent/15 text-accent'
          )}
          aria-label={item.label}
        >
          <item.icon className="w-4.5 h-4.5" />
          <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 bg-elevated border border-border rounded text-text-primary text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[calc(var(--z-sidebar)+1)]">
            {item.label}
          </span>
        </Link>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors relative',
          isActive
            ? 'bg-accent/10 text-accent font-medium'
            : 'text-text-secondary hover:text-text-primary hover:bg-hover'
        )}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-accent rounded-r" />
        )}
        <item.icon className="w-4 h-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
  );
}
