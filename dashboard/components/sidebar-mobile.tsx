'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigation } from '@/lib/navigation';

export function MobileSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Hamburger button — mobile only */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-sticky p-2 rounded-md bg-elevated border border-border-default text-text-secondary hover:text-text-primary transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-overlay bg-black/60"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        >
          {/* Drawer panel */}
          <div
            role="dialog"
            aria-label="Mobile navigation menu"
            className="absolute left-0 top-0 h-full w-72 bg-elevated border-r border-border-default flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-4 border-b border-border-default shrink-0">
              <span className="font-heading text-text-primary text-sm font-semibold tracking-tight">
                Operant
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-3">
              {navigation.map((navSection) => {
                if (navSection.section === '') {
                  return (
                    <div key="separator" className="mt-2 pt-2 border-t border-border-default px-3">
                      {navSection.items.map((item) => (
                        <MobileNavItem
                          key={item.href}
                          item={item}
                          pathname={pathname}
                          onClick={() => setOpen(false)}
                        />
                      ))}
                    </div>
                  );
                }

                return (
                  <div key={navSection.section} className="mb-4">
                    <div className="px-4 py-1.5 text-text-muted text-[11px] font-medium uppercase tracking-wider">
                      {navSection.section}
                    </div>
                    <ul className="space-y-0.5 px-2">
                      {navSection.items.map((item) => (
                        <MobileNavItem
                          key={item.href}
                          item={item}
                          pathname={pathname}
                          onClick={() => setOpen(false)}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

interface MobileNavItemProps {
  item: {
    href: string;
    label: string;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    separator?: boolean;
  };
  pathname: string;
  onClick: () => void;
}

function MobileNavItem({ item, pathname, onClick }: MobileNavItemProps) {
  const isActive = pathname === item.href;

  return (
    <li className="list-none">
      <Link
        href={item.href}
        onClick={onClick}
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
