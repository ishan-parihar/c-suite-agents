'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { MobileSidebar } from '@/components/sidebar-mobile';

const LOGIN_PATHS = new Set(['/login']);

export function DashboardChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = LOGIN_PATHS.has(pathname);

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-accent focus:text-text-primary focus:text-sm focus:font-medium focus:rounded-md focus:outline-none"
      >
        Skip to main content
      </a>
      <Sidebar />
      <MobileSidebar />
      <main id="main-content" role="main" className="lg:pl-64 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </div>
      </main>
    </>
  );
}
