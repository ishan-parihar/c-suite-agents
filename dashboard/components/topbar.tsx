'use client';

import { usePathname } from 'next/navigation';
import { navItemMap } from '@/lib/navigation';

export function TopBar() {
  const pathname = usePathname();
  const currentPage = navItemMap.get(pathname);

  return (
    <header className="h-14 border-b border-border bg-surface/80 backdrop-blur-sm flex items-center px-4 sm:px-6 sticky top-0 z-sticky">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {currentPage && (
          <>
            <currentPage.icon className="w-4 h-4 text-text-muted shrink-0" />
            <h1 className="font-heading text-sm font-semibold text-text-primary truncate">
              {currentPage.label}
            </h1>
          </>
        )}
      </div>
    </header>
  );
}
