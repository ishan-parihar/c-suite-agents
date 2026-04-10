'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigation } from '@/lib/navigation';

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => Object.fromEntries(navigation.map((s) => [s.section, true]))
  );

  const toggleSection = (section: string) => {
    if (!collapsed) {
      setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
    }
  };

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 h-screen z-sidebar bg-elevated border-r border-border-default flex flex-col transition-all duration-200',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Brand header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border-default shrink-0">
        <span
          className={cn(
            'font-heading text-text-primary text-sm font-semibold tracking-tight whitespace-nowrap overflow-hidden transition-opacity duration-200',
            collapsed ? 'opacity-0 w-0' : 'opacity-100'
          )}
        >
          Operant
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            'shrink-0 p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-hover transition-colors',
            collapsed && 'mx-auto'
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4 rotate-90" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 scrollbar-thin">
        {navigation.map((navSection) => {
          const isSeparatorSection = navSection.section === '';
          const isOpen = openSections[navSection.section] ?? true;

          if (isSeparatorSection) {
            return (
              <div key="separator" className="mt-2 pt-2 border-t border-border-default">
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

          return (
            <div key={navSection.section} className="mb-1">
              {/* Section header */}
              <button
                type="button"
                onClick={() => toggleSection(navSection.section)}
                className={cn(
                  'flex items-center w-full px-3 py-1.5 text-text-muted text-[11px] font-medium uppercase tracking-wider hover:text-text-secondary transition-colors',
                  collapsed ? 'justify-center' : 'gap-2'
                )}
                aria-expanded={isOpen}
              >
                {collapsed ? null : (
                  isOpen ? (
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 shrink-0" />
                  )
                )}
                {!collapsed && (
                  <span className="truncate">{navSection.section}</span>
                )}
              </button>

              {/* Section items */}
              {isOpen && (
                <ul className="space-y-0.5 px-1">
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
          className="flex items-center justify-center w-10 h-10 mx-auto rounded-md text-text-secondary hover:text-text-primary hover:bg-hover transition-colors relative group"
          aria-label={item.label}
        >
          <item.icon className="w-5 h-5" />
          {/* Tooltip */}
          <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 bg-elevated border border-border-default rounded-md text-text-primary text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[calc(var(--z-sidebar)+1)] shadow-lg">
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
          'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
          isActive
            ? 'bg-accent/10 text-accent-secondary font-medium'
            : 'text-text-secondary hover:text-text-primary hover:bg-hover'
        )}
      >
        <item.icon className="w-4 h-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
  );
}
