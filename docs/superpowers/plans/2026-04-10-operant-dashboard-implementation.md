# Operant Dashboard — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete self-hosted Next.js 15 operations dashboard replacing Notion + SQLite, with 40+ routes across 7 phases, dark-first design, TanStack Table, Recharts, @dnd-kit Kanban, and full PostgreSQL/Drizzle integration.

**Architecture:** Server-first Next.js 15 App Router with Server Components for data fetching, Client Components for interactivity (Kanban DnD, charts, tables), shared Drizzle ORM schema, PostgreSQL 16 with 48 tables, 29 functions, 5 views. Each phase produces independently working, testable software.

**Tech Stack:** Next.js 15, Tailwind CSS v4, Drizzle ORM, Recharts, @tanstack/react-table, @dnd-kit/core, Lucide icons, Fira Code + Fira Sans, sonner, clsx, tailwind-merge, date-fns.

**Design Spec:** `docs/superpowers/specs/2026-04-10-operant-dashboard-design.md`
**Live Schema:** `.sisyphus/notion-schema-extract.md`
**Drizzle Schema:** `drizzle/schema/` (symlinked from `dashboard/drizzle/schema`)

---

## Execution Strategy

This plan is divided into **7 independent phases**, each producing working, deployable software. Execute in order — each phase builds on the previous.

| Phase | Duration | Dependency | Sub-Project Plan |
|---|---|---|---|
| Phase 1: Foundation & Design System | Week 1 | None | See Task Group 1 |
| Phase 2: LifeOS Core | Week 2-3 | Phase 1 | See Task Group 2 |
| Phase 3: Projects & Tasks Hub | Week 3-4 | Phase 1 | See Task Group 3 |
| Phase 4: Financial Dashboard | Week 4-5 | Phase 1, Phase 2 | See Task Group 4 |
| Phase 5: Operations Suite | Week 5-7 | Phase 1 | See Task Group 5 |
| Phase 6: Content, Journals & Settings | Week 7-8 | Phase 1 | See Task Group 6 |
| Phase 7: Polish & Performance | Week 8 | All phases | See Task Group 7 |

---

## Task Group 1: Foundation & Design System

### Task 1.1: Install Dependencies

**Files:**
- Modify: `dashboard/package.json`

- [ ] **Step 1: Install all required packages**

Run:
```bash
cd dashboard && bun add @tanstack/react-table @tanstack/react-virtual @dnd-kit/core @dnd-kit/sortable recharts sonner clsx tailwind-merge date-fns lucide-react
```

Expected: All packages installed, no errors.

Verify:
```bash
cd dashboard && bun ls | grep -E "tanstack|dnd-kit|recharts|sonner|clsx|tailwind-merge|date-fns|lucide"
```

- [ ] **Step 2: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/package.json dashboard/bun.lockb
git commit -m "feat(dashboard): add foundation dependencies for tables, charts, DnD, and UI"
```

---

### Task 1.2: Dark-First Design System (globals.css)

**Files:**
- Rewrite: `dashboard/app/globals.css`

- [ ] **Step 1: Rewrite globals.css with dark-first tokens**

```css
@import "tailwindcss";

/* ============================================================
   OPERANT DESIGN SYSTEM — Dark-First Operations Dashboard
   Style: Dark Mode (OLED-optimized)
   Typography: Fira Code (headings/mono) + Fira Sans (body)
   ============================================================ */

:root {
  /* Background surfaces */
  --bg-primary: #0A0E27;      /* Page background (midnight blue) */
  --bg-surface: #121212;      /* Card backgrounds */
  --bg-elevated: #1A1A2E;     /* Modals, dropdowns, sidebar */
  --bg-hover: #1F2937;        /* Hover states */

  /* Borders */
  --border-default: rgba(255, 255, 255, 0.08);  /* Card borders, dividers */
  --border-strong: rgba(255, 255, 255, 0.16);   /* Active states */

  /* Text */
  --text-primary: #FFFFFF;      /* Headings, labels */
  --text-secondary: #A1A1AA;    /* Subtitles, metadata */
  --text-muted: #71717A;        /* Placeholders, disabled */

  /* Accent colors */
  --accent-primary: #1E40AF;    /* Primary buttons, links */
  --accent-hover: #2563EB;
  --accent-secondary: #3B82F6;  /* Secondary actions */
  --accent-cta: #D97706;        /* Highlights, warnings */

  /* Status — always paired with text labels, never color alone */
  --status-healthy: #10B981;
  --status-warning: #F59E0B;
  --status-critical: #EF4444;
  --status-neutral: #6B7280;

  /* Typography */
  --font-heading: var(--font-fira-code);
  --font-body: var(--font-fira-sans);
  --font-mono: var(--font-fira-code);

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  /* Z-index scale — never arbitrary values */
  --z-dropdown: 10;
  --z-sticky: 20;
  --z-overlay: 30;
  --z-modal: 40;
  --z-sidebar: 50;
  --z-toast: 100;
  --z-command: 200;

  /* Spacing — multiples of 4px only */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
}

/* Light mode override via prefers-color-scheme — NOT default */
@media (prefers-color-scheme: light) {
  :root {
    --bg-primary: #F8FAFC;
    --bg-surface: #FFFFFF;
    --bg-elevated: #F1F5F9;
    --bg-hover: #E2E8F0;
    --border-default: #E2E8F0;
    --border-strong: #CBD5E1;
    --text-primary: #0F172A;
    --text-secondary: #475569;
    --text-muted: #94A3B8;
  }
}

@theme inline {
  --color-background: var(--bg-primary);
  --color-foreground: var(--text-primary);
  --color-surface: var(--bg-surface);
  --color-elevated: var(--bg-elevated);
  --color-hover: var(--bg-hover);
  --color-border: var(--border-default);
  --color-border-strong: var(--border-strong);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-accent: var(--accent-primary);
  --color-accent-hover: var(--accent-hover);
  --color-healthy: var(--status-healthy);
  --color-warning: var(--status-warning);
  --color-critical: var(--status-critical);
  --color-neutral: var(--status-neutral);
  --font-sans: var(--font-fira-sans);
  --font-mono: var(--font-fira-code);
}

/* ============================================================
   Base styles
   ============================================================ */

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body), system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Tabular numbers for all data columns — prevents layout shift */
.tabular {
  font-variant-numeric: tabular-nums;
}

/* Focus-visible rings — 2px blue ring offset 2px on all interactive elements */
*:focus-visible {
  outline: 2px solid var(--accent-secondary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* Scrollbar — thin, subtle */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #a1a1aa;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #71717a;
}

/* Selection */
::selection {
  background: var(--accent-primary);
  color: var(--text-primary);
}

/* Print — hide sidebar */
@media print {
  .sidebar {
    display: none !important;
  }
}
```

- [ ] **Step 2: Verify CSS syntax**

Run:
```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard && bun run build 2>&1 | head -30
```

Expected: No CSS errors. Build may show other errors from existing pages — that's expected.

---

### Task 1.3: Font Configuration (Fira Code + Fira Sans)

**Files:**
- Modify: `dashboard/app/layout.tsx`

- [ ] **Step 1: Update layout.tsx with Fira fonts**

```tsx
import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Operant Dashboard",
  description: "Self-hosted PostgreSQL operations dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${firaSans.variable} ${firaCode.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-text-primary">
        <Sidebar />
        <main className="pl-64 min-h-screen">
          <div className="max-w-7xl mx-auto px-6 py-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard && bun run build 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/app/globals.css dashboard/app/layout.tsx
git commit -m "feat(dashboard): dark-first design system with Fira Code + Fira Sans fonts"
```

---

### Task 1.4: Navigation Configuration

**Files:**
- Create: `dashboard/lib/navigation.ts`

- [ ] **Step 1: Create navigation config**

```tsx
import {
  LayoutDashboard,
  Activity,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Sun,
  FolderKanban,
  CheckSquare,
  Users,
  Columns,
  BarChart3,
  Receipt,
  Landmark,
  Megaphone,
  FileText,
  Pen,
  UsersRound,
  Network,
  Apple,
  Users as UsersIcon,
  Mail,
  Cpu,
  FileBarChart,
  Settings,
  Target,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  separator?: boolean;
}

export interface NavSection {
  section: string;
  items: NavItem[];
}

export const navigation: NavSection[] = [
  {
    section: "Overview",
    items: [
      { href: "/", label: "Daily Briefing", icon: LayoutDashboard },
      { href: "/monitor", label: "Project Monitor", icon: Activity },
    ],
  },
  {
    section: "Temporal",
    items: [
      { href: "/years", label: "Years", icon: Calendar },
      { href: "/quarters", label: "Quarters", icon: CalendarClock },
      { href: "/months", label: "Months", icon: CalendarDays },
      { href: "/weeks", label: "Weeks", icon: CalendarRange },
      { href: "/days", label: "Days", icon: Sun },
    ],
  },
  {
    section: "Operations",
    items: [
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
      { href: "/people", label: "People", icon: Users },
      { href: "/kanban", label: "Kanban Board", icon: Columns },
    ],
  },
  {
    section: "Financial",
    items: [
      { href: "/financial", label: "Dashboard", icon: BarChart3 },
      { href: "/financial/transactions", label: "Transactions", icon: Receipt },
      { href: "/financial/accounts", label: "Accounts", icon: Landmark },
    ],
  },
  {
    section: "Marketing",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/content", label: "Content Pipeline", icon: FileText },
      { href: "/calendar", label: "Calendar", icon: Calendar },
    ],
  },
  {
    section: "Journals",
    items: [
      { href: "/journals/subjective", label: "Subjective", icon: Pen },
      { href: "/journals/relational", label: "Relational", icon: UsersRound },
      { href: "/journals/systemic", label: "Systemic", icon: Network },
      { href: "/journals/diet", label: "Diet Log", icon: Apple },
    ],
  },
  {
    section: "Goals",
    items: [
      { href: "/goals", label: "Goals Dashboard", icon: Target },
    ],
  },
  {
    section: "Ops",
    items: [
      { href: "/meetings", label: "Board Meetings", icon: UsersIcon },
      { href: "/messages", label: "Messages", icon: Mail },
      { href: "/sessions", label: "Agent Sessions", icon: Cpu },
      { href: "/ops-reports", label: "Reports", icon: FileBarChart },
    ],
  },
  {
    section: "",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, separator: true },
    ],
  },
];

export const allNavItems = navigation.flatMap((s) => s.items);
export const navItemMap = new Map(allNavItems.map((item) => [item.href, item]));
```

- [ ] **Step 2: Verify TypeScript**

Run:
```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard && npx tsc --noEmit 2>&1 | head -20
```

Expected: Navigation file compiles clean. Pre-existing errors from other files are OK.

- [ ] **Step 3: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/lib/navigation.ts
git commit -m "feat(dashboard): navigation configuration with all 40+ routes"
```

---

### Task 1.5: Sidebar Component (Collapsible + Mobile)

**Files:**
- Rewrite: `dashboard/components/sidebar.tsx`
- Create: `dashboard/components/sidebar-mobile.tsx`

- [ ] **Step 1: Rewrite sidebar.tsx with collapsible behavior**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, createContext, useContext, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Menu, X, Circle } from "lucide-react";
import { navigation, type NavSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface SidebarContextType {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  toggle: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

function SectionGroup({ section, items, collapsed }: { section: NavSection; collapsed: boolean }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

  if (collapsed) {
    return (
      <div className="mb-4">
        {items.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-center w-10 h-10 mx-auto rounded-md transition-colors",
                isActive
                  ? "bg-accent text-white"
                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
              )}
              title={item.label}
            >
              <Icon className="w-5 h-5" />
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mb-2">
      {section.section && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center w-full px-3 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 mr-1" />
          ) : (
            <ChevronRight className="w-3 h-3 mr-1" />
          )}
          {section.section}
        </button>
      )}
      {expanded && (
        <div className="mt-1">
          {items.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <div key={item.href}>
                {item.separator && (
                  <div className="mx-3 my-2 border-t border-border-default" />
                )}
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors mx-2",
                    isActive
                      ? "bg-accent/10 text-accent-secondary font-medium"
                      : "text-text-secondary hover:bg-hover hover:text-text-primary"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setCollapsed(!collapsed) }}>
      <aside
        className={cn(
          "sidebar fixed top-0 left-0 h-screen bg-elevated border-r border-border-default transition-all duration-200 z-sidebar",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Brand header */}
        <div className={cn(
          "flex items-center h-14 px-3 border-b border-border-default",
          collapsed && "justify-center"
        )}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
              <Circle className="w-4 h-4 text-white fill-white" />
            </div>
            {!collapsed && (
              <span className="font-heading font-semibold text-text-primary">Operant</span>
            )}
          </div>
        </div>

        {/* Navigation sections */}
        <nav className="overflow-y-auto h-[calc(100vh-3.5rem)] py-3 scrollbar-thin">
          {navigation.map((section) => (
            <SectionGroup key={section.section} section={section} collapsed={collapsed} />
          ))}
        </nav>
      </aside>
    </SidebarContext.Provider>
  );
}
```

- [ ] **Step 2: Create sidebar-mobile.tsx**

```tsx
"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { navigation, type NavSection } from "@/lib/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

function MobileSection({ section }: { section: NavSection }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-2">
      {section.section && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center w-full px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider"
        >
          {section.section}
        </button>
      )}
      {expanded && (
        <div>
          {items.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-sm",
                  isActive
                    ? "bg-accent/10 text-accent-secondary font-medium"
                    : "text-text-secondary"
                )}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MobileSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Hamburger trigger — visible only on mobile */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-sticky p-2 rounded-md bg-surface border border-border-default text-text-primary"
        aria-label="Open navigation"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-overlay">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <div className="absolute left-0 top-0 h-full w-72 bg-elevated border-r border-border-default overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between h-14 px-4 border-b border-border-default">
              <span className="font-heading font-semibold text-text-primary">Operant</span>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-md hover:bg-hover text-text-secondary"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation */}
            <nav className="py-3">
              {navigation.map((section) => (
                <MobileSection key={section.section} section={section} />
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
```

Wait — I need to fix the MobileSection to import `items`. Let me correct:

```tsx
"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { navigation } from "@/lib/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

function MobileSection({ section }: { section: { section: string; items: { href: string; label: string; icon: React.ComponentType<any>; separator?: boolean }[] } }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-2">
      {section.section && (
        <div className="px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
          {section.section}
        </div>
      )}
      {expanded && (
        <div>
          {section.items.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {}}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-sm",
                  isActive
                    ? "bg-accent/10 text-accent-secondary font-medium"
                    : "text-text-secondary"
                )}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MobileSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Hamburger trigger — visible only on mobile */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-sticky p-2 rounded-md bg-surface border border-border-default text-text-primary"
        aria-label="Open navigation"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-overlay">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <div className="absolute left-0 top-0 h-full w-72 bg-elevated border-r border-border-default overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between h-14 px-4 border-b border-border-default">
              <span className="font-heading font-semibold text-text-primary">Operant</span>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-md hover:bg-hover text-text-secondary"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation */}
            <nav className="py-3">
              {navigation.map((section) => (
                <MobileSection key={section.section} section={section} />
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Update layout.tsx to use both sidebars**

Modify `dashboard/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { MobileSidebar } from "@/components/sidebar-mobile";

const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Operant Dashboard",
  description: "Self-hosted PostgreSQL operations dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${firaSans.variable} ${firaCode.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-text-primary">
        <Sidebar />
        <MobileSidebar />
        <main className="pl-64 lg:pl-64 min-h-screen">
          <div className="max-w-7xl mx-auto px-6 py-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify build**

Run:
```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard && bun run build 2>&1 | head -40
```

Expected: Build may show errors from placeholder pages (that's OK — sidebar/layout should compile).

- [ ] **Step 5: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/components/sidebar.tsx dashboard/components/sidebar-mobile.tsx dashboard/app/layout.tsx
git commit -m "feat(dashboard): collapsible sidebar with mobile drawer navigation"
```

---

### Task 1.6: Utility Functions

**Files:**
- Rewrite: `dashboard/lib/utils.ts`
- Create: `dashboard/lib/constants.ts`
- Create: `dashboard/lib/formatters.ts`

- [ ] **Step 1: Rewrite utils.ts**

```tsx
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 2: Create constants.ts**

```tsx
export const Z_INDEX = {
  dropdown: 10,
  sticky: 20,
  overlay: 30,
  modal: 40,
  sidebar: 50,
  toast: 100,
  command: 200,
} as const;

export const STATUS_MAP = {
  healthy: { color: "var(--status-healthy)", label: "Healthy" },
  warning: { color: "var(--status-warning)", label: "Warning" },
  critical: { color: "var(--status-critical)", label: "Critical" },
  neutral: { color: "var(--status-neutral)", label: "Inactive" },
} as const;

export type StatusKey = keyof typeof STATUS_MAP;

export const PAGINATION_SIZES = [10, 25, 50, 100] as const;

export const DATE_FORMATS = {
  date: "yyyy-MM-dd",
  datetime: "yyyy-MM-dd HH:mm",
  time: "HH:mm",
  relative: "PP",
} as const;
```

- [ ] **Step 3: Create formatters.ts**

```tsx
import { format, formatDistanceToNow, isValid } from "date-fns";

export function formatDate(date: Date | string | null, pattern = "yyyy-MM-dd"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (!isValid(d)) return "—";
  return format(d, pattern);
}

export function formatRelative(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (!isValid(d)) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatCurrency(amount: number | null | undefined, currency = "₹"): string {
  if (amount == null) return "—";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}${currency}${abs.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN");
}
```

- [ ] **Step 4: Verify TypeScript**

Run:
```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard && npx tsc --noEmit lib/utils.ts lib/constants.ts lib/formatters.ts 2>&1
```

- [ ] **Step 5: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/lib/utils.ts dashboard/lib/constants.ts dashboard/lib/formatters.ts
git commit -m "feat(dashboard): utility functions — cn, formatters, constants"
```

---

### Task 1.7: Base UI Components

**Files:**
- Create: `dashboard/components/ui/card.tsx`
- Create: `dashboard/components/ui/badge.tsx`
- Create: `dashboard/components/ui/skeleton.tsx`
- Create: `dashboard/components/ui/stat-card.tsx`
- Create: `dashboard/components/ui/empty-state.tsx`
- Create: `dashboard/components/ui/progress-bar.tsx`
- Create: `dashboard/components/ui/chart-card.tsx`

- [ ] **Step 1: Create card.tsx**

```tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  variant?: "default" | "elevated" | "bordered";
  className?: string;
  onClick?: () => void;
}

export function Card({ children, variant = "default", className, onClick }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg transition-colors",
        variant === "default" && "bg-surface border border-border-default",
        variant === "elevated" && "bg-elevated border border-border-default shadow-lg",
        variant === "bordered" && "bg-surface border-2 border-accent/20",
        onClick && "cursor-pointer hover:border-border-strong",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3 border-b border-border-default", className)}>{children}</div>;
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3 border-t border-border-default", className)}>{children}</div>;
}
```

- [ ] **Step 2: Create badge.tsx**

```tsx
import { cn } from "@/lib/utils";
import { STATUS_MAP, type StatusKey } from "@/lib/constants";
import type { ReactNode } from "react";

interface BadgeProps {
  status: StatusKey;
  children?: ReactNode;
  className?: string;
}

export function Badge({ status, children, className }: BadgeProps) {
  const config = STATUS_MAP[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        className
      )}
      style={{ backgroundColor: `${config.color}20`, color: config.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: config.color }} />
      {children || config.label}
    </span>
  );
}
```

- [ ] **Step 3: Create skeleton.tsx**

```tsx
import { cn } from "@/lib/utils";

interface SkeletonProps {
  variant?: "card" | "table" | "text" | "chart" | "stat";
  lines?: number;
  className?: string;
}

export function Skeleton({ variant = "text", lines = 3, className }: SkeletonProps) {
  const base = "animate-pulse rounded-md bg-hover";

  if (variant === "card") {
    return (
      <div className={cn("rounded-lg bg-surface border border-border-default p-4 space-y-3", className)}>
        <div className={cn(base, "h-4 w-1/3")} />
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={cn(base, "h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className={cn("space-y-3", className)}>
        <div className={cn(base, "h-10 w-full")} />
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={cn(base, "h-8 w-full")} />
        ))}
      </div>
    );
  }

  if (variant === "chart") {
    return (
      <div className={cn("rounded-lg bg-surface border border-border-default p-4", className)}>
        <div className={cn(base, "h-4 w-1/4 mb-4")} />
        <div className={cn(base, "h-48 w-full")} />
      </div>
    );
  }

  if (variant === "stat") {
    return (
      <div className={cn("rounded-lg bg-surface border border-border-default p-4 space-y-2", className)}>
        <div className={cn(base, "h-3 w-1/2")} />
        <div className={cn(base, "h-6 w-2/3")} />
      </div>
    );
  }

  // text
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={cn(base, "h-3", `w-${Math.max(4, 12 - i * 2)}/12`)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create stat-card.tsx**

```tsx
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number | null;
  icon: LucideIcon;
  trend?: { value: number; positive: boolean };
  subtitle?: string;
  loading?: boolean;
  className?: string;
}

export function StatCard({ title, value, icon: Icon, trend, subtitle, loading, className }: StatCardProps) {
  if (loading) {
    return <Skeleton variant="stat" className={className} />;
  }

  return (
    <div className={cn("rounded-lg bg-surface border border-border-default p-4", className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider">{title}</p>
        <Icon className="w-4 h-4 text-text-muted" />
      </div>
      <p className="mt-2 text-2xl font-heading font-semibold text-text-primary tabular">
        {value ?? "—"}
      </p>
      {(trend || subtitle) && (
        <div className="mt-1 flex items-center gap-2">
          {trend && (
            <span className={cn("text-xs font-medium", trend.positive ? "text-healthy" : "text-critical")}>
              {trend.positive ? "↑" : "↓"} {Math.abs(trend.value)}%
            </span>
          )}
          {subtitle && <span className="text-xs text-text-secondary">{subtitle}</span>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create empty-state.tsx**

```tsx
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href: string };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <Icon className="w-12 h-12 text-text-muted mb-4" />
      <h3 className="text-lg font-medium text-text-primary">{title}</h3>
      <p className="mt-1 text-sm text-text-secondary max-w-sm">{description}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create progress-bar.tsx**

```tsx
import { cn } from "@/lib/utils";
import { clamp } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: "healthy" | "warning" | "critical" | "accent";
  label?: string;
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({ value, max = 100, color = "accent", label, showLabel = true, className }: ProgressBarProps) {
  const pct = clamp((value / max) * 100, 0, 100);

  const colorMap = {
    healthy: "bg-healthy",
    warning: "bg-warning",
    critical: "bg-critical",
    accent: "bg-accent",
  };

  return (
    <div className={cn("w-full", className)}>
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          {label && <span className="text-xs text-text-secondary">{label}</span>}
          <span className="text-xs font-medium text-text-primary tabular">{pct.toFixed(0)}%</span>
        </div>
      )}
      <div className="w-full h-2 bg-hover rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-300", colorMap[color])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create chart-card.tsx**

```tsx
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  loading?: boolean;
  error?: string | null;
  className?: string;
}

export function ChartCard({ title, subtitle, children, loading, error, className }: ChartCardProps) {
  if (loading) {
    return <Skeleton variant="chart" className={className} />;
  }

  if (error) {
    return (
      <Card className={cn("border-critical/30", className)}>
        <CardHeader>
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
          {subtitle && <p className="text-xs text-text-secondary">{subtitle}</p>}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-critical py-8 text-center">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        {subtitle && <p className="text-xs text-text-secondary">{subtitle}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: Verify build**

Run:
```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard && bun run build 2>&1 | head -40
```

- [ ] **Step 9: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/components/ui/
git commit -m "feat(dashboard): base UI components — Card, Badge, Skeleton, StatCard, EmptyState, ProgressBar, ChartCard"
```

---

### Task 1.8: DataTable Component (TanStack Table Wrapper)

**Files:**
- Create: `dashboard/components/ui/data-table.tsx`

- [ ] **Step 1: Create data-table.tsx**

```tsx
"use client";

import {
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type PaginationState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Search, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: keyof TData & string;
  searchPlaceholder?: string;
  filterColumn?: keyof TData & string;
  filterOptions?: { label: string; value: string }[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

function SortIcon({ isSorted }: { isSorted: false | "asc" | "desc" }) {
  if (isSorted === "asc") return <ChevronUp className="w-4 h-4" />;
  if (isSorted === "desc") return <ChevronDown className="w-4 h-4" />;
  return <ChevronsUpDown className="w-4 h-4 opacity-50" />;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Search...",
  filterColumn,
  filterOptions,
  loading,
  emptyTitle = "No data",
  emptyDescription = "No records found.",
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    state: { sorting, columnFilters, pagination, globalFilter },
  });

  if (loading) {
    return <Skeleton variant="table" lines={10} />;
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        {searchKey && (
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-border-default rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-secondary focus:ring-offset-2 focus:ring-offset-bg-primary"
            />
          </div>
        )}
        {filterColumn && filterOptions && (
          <select
            value={(table.getColumn(filterColumn)?.getFilterValue() as string) ?? ""}
            onChange={(e) => table.getColumn(filterColumn)?.setFilterValue(e.target.value)}
            className="px-3 py-2 text-sm bg-surface border border-border-default rounded-md text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-secondary"
          >
            <option value="">All</option>
            {filterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-elevated">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        "px-4 py-3 text-left font-medium text-text-muted whitespace-nowrap",
                        header.column.getCanSort() && "cursor-pointer select-none"
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && <SortIcon isSorted={header.column.getIsSorted()} />}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t border-border-default hover:bg-hover/50 transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 whitespace-nowrap text-text-secondary">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{" "}
          {Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, table.getFilteredRowModel().rows.length)}{" "}
          of {table.getFilteredRowModel().rows.length} results
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="px-3 py-1 text-xs rounded-md border border-border-default text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed hover:bg-hover transition-colors"
          >
            Previous
          </button>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="px-3 py-1 text-xs rounded-md border border-border-default text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed hover:bg-hover transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run:
```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard && npx tsc --noEmit components/ui/data-table.tsx 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/components/ui/data-table.tsx
git commit -m "feat(dashboard): DataTable component with TanStack Table (sorting, filtering, pagination)"
```

---

### Task 1.9: Responsive Layout Integration

**Files:**
- Modify: `dashboard/app/layout.tsx`
- Modify: `dashboard/components/sidebar.tsx` (add collapse button)

- [ ] **Step 1: Update layout.tsx with responsive main content**

Update the layout to use `lg:` breakpoints properly:

```tsx
// Replace the body content in layout.tsx:
<body className="min-h-full bg-background text-text-primary">
  <Sidebar />
  <MobileSidebar />
  <main className="lg:pl-64 min-h-screen">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {children}
    </div>
  </main>
</body>
```

- [ ] **Step 2: Add collapse toggle to sidebar header**

In `dashboard/components/sidebar.tsx`, add a collapse button:

```tsx
// Inside the brand header div, after the brand name:
{!collapsed && (
  <button
    onClick={() => setCollapsed(true)}
    className="ml-auto p-1 rounded hover:bg-hover text-text-muted"
    aria-label="Collapse sidebar"
  >
    <ChevronRight className="w-4 h-4" />
  </button>
)}
```

- [ ] **Step 3: Add expand button for collapsed state**

When collapsed, show a hover-expand indicator. Add to the sidebar:

```tsx
{collapsed && (
  <button
    onClick={() => setCollapsed(false)}
    className="absolute -right-3 top-6 p-1 rounded-full bg-elevated border border-border-default text-text-muted hover:text-text-primary transition-colors"
    aria-label="Expand sidebar"
  >
    <ChevronDown className="w-3 h-3 rotate-90" />
  </button>
)}
```

- [ ] **Step 4: Verify build**

Run:
```bash
cd /home/ishanp/Documents/GitHub/operant/dashboard && bun run build 2>&1 | head -40
```

Expected: Build passes with only expected errors from placeholder pages.

- [ ] **Step 5: Commit — Phase 1 Complete**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/
git commit -m "feat(dashboard): Phase 1 complete — responsive layout with collapsible sidebar

- Dark-first design system with semantic CSS tokens
- Fira Code + Fira Sans typography
- Collapsible sidebar with mobile drawer
- Base UI components (Card, Badge, Skeleton, StatCard, EmptyState, ProgressBar, ChartCard)
- DataTable with TanStack Table (sorting, filtering, pagination)
- Navigation config with 40+ routes
- Utility functions (cn, formatters, constants)
- Responsive layout (mobile-first with lg: breakpoint)"
```

---

## Task Group 2: LifeOS Core (Temporal + Goals)

### Task 2.1: Daily Briefing Upgrade

**Files:**
- Rewrite: `dashboard/app/page.tsx`
- Create: `dashboard/app/_components/daily-briefing.tsx`
- Create: `dashboard/app/_components/project-health.tsx`
- Create: `dashboard/app/_components/today-activities.tsx`

- [ ] **Step 1: Create server data fetchers**

Create `dashboard/lib/server/daily-briefing.ts`:

```tsx
import { db } from "@/lib/db";
import { days, activities, tasks, projects } from "@/drizzle/schema";
import { sql, eq, gte, lte, count, desc, asc } from "drizzle-orm";
import { subDays, startOfDay, endOfDay } from "date-fns";

export async function getDailyBriefingData() {
  const today = new Date();
  const weekStart = subDays(today, today.getDay());

  const [
    activeProjectsCount,
    dueTasksCount,
    todayActivities,
    todayTasks,
    upcomingDeadlines,
    healthScore,
  ] = await Promise.all([
    // Active projects
    db.select({ count: count() }).from(projects).where(eq(projects.status, 'active')),

    // Due tasks this week
    db.select({ count: count() }).from(tasks).where(
      sql`${tasks.status} = 'due' AND ${tasks.week_id} IS NOT NULL`
    ),

    // Today's activities
    db.select().from(activities).where(
      sql`${activities.date} = ${today.toISOString().split('T')[0]}`
    ).orderBy(asc(activities.start_time)),

    // Today's due tasks
    db.select({
      id: tasks.id,
      name: tasks.name,
      priority: tasks.priority,
    }).from(tasks).where(
      sql`${tasks.due_date} = ${today.toISOString().split('T')[0]}`
    ).limit(10),

    // Upcoming deadlines (next 7 days)
    db.select({
      name: projects.name,
      deadline: projects.deadline,
    }).from(projects).where(
      sql`${projects.deadline} >= ${today.toISOString().split('T')[0]} AND ${projects.deadline} <= ${(new Date(Date.now() + 7 * 86400000)).toISOString().split('T')[0]} AND ${projects.status} = 'active'`
    ).orderBy(asc(projects.deadline)).limit(10),

    // Today's health score
    db.select({ score: days.health_score }).from(days).where(
      sql`${days.date} = ${today.toISOString().split('T')[0]}`
    ).limit(1),
  ]);

  return {
    activeProjectsCount: activeProjectsCount[0]?.count ?? 0,
    dueTasksCount: dueTasksCount[0]?.count ?? 0,
    todayActivities: todayActivities ?? [],
    todayTasks: todayTasks ?? [],
    upcomingDeadlines: upcomingDeadlines ?? [],
    healthScore: healthScore[0]?.score ?? null,
    date: today,
  };
}
```

- [ ] **Step 2: Create daily-briefing.tsx server component**

```tsx
import { getDailyBriefingData } from "@/lib/server/daily-briefing";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";
import { FolderKanban, CheckSquare, TrendingUp, Heart, Calendar } from "lucide-react";

export async function DailyBriefing() {
  const data = await getDailyBriefingData();
  const today = data.date;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          {formatDate(today, "EEEE, MMMM d, yyyy")}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Your daily overview — what needs attention today
        </p>
      </div>

      {/* Stat Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Projects"
          value={data.activeProjectsCount}
          icon={FolderKanban}
        />
        <StatCard
          title="Due Tasks"
          value={data.dueTasksCount}
          icon={CheckSquare}
        />
        <StatCard
          title="Health Score"
          value={data.healthScore != null ? `${data.healthScore}/10` : "No data"}
          icon={Heart}
        />
        <StatCard
          title="Today's Income"
          value="₹0"
          icon={TrendingUp}
          subtitle="Connect financial data"
        />
      </div>

      {/* Upcoming Deadlines */}
      {data.upcomingDeadlines.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Upcoming Deadlines (7 days)
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.upcomingDeadlines.map((dl, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border-default last:border-0">
                  <span className="text-sm text-text-secondary">{dl.name}</span>
                  <span className="text-xs tabular text-text-muted">{formatDate(dl.deadline)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        {["View Projects", "Open Kanban", "People Directory", "Financial Dashboard"].map((action) => (
          <button
            key={action}
            className="px-4 py-2 text-sm font-medium rounded-md bg-surface border border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite page.tsx**

```tsx
import { Suspense } from "react";
import { DailyBriefing } from "./_components/daily-briefing";
import { Skeleton } from "@/components/ui/skeleton";

export default function HomePage() {
  return (
    <Suspense fallback={<Skeleton variant="card" lines={8} />}>
      <DailyBriefing />
    </Suspense>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/app/page.tsx dashboard/app/_components/ dashboard/lib/server/
git commit -m "feat(dashboard): Daily Briefing with real PostgreSQL data and Suspense boundaries"
```

---

### Task 2.2: Temporal Pages (Years, Quarters, Months, Weeks, Days)

**Files:**
- Create: `dashboard/app/years/page.tsx`
- Create: `dashboard/app/years/[id]/page.tsx`
- Create: `dashboard/app/quarters/page.tsx`
- Create: `dashboard/app/quarters/[id]/page.tsx`
- Create: `dashboard/app/months/page.tsx`
- Create: `dashboard/app/months/[id]/page.tsx`
- Create: `dashboard/app/weeks/page.tsx`
- Create: `dashboard/app/weeks/[id]/page.tsx`
- Create: `dashboard/app/days/page.tsx`
- Create: `dashboard/app/days/[id]/page.tsx`

- [ ] **Step 1: Create temporal data fetchers**

Create `dashboard/lib/server/temporal.ts` with functions for:
- `getYearsList()`
- `getYearDetail(yearId)`
- `getQuartersList()`
- `getQuarterDetail(quarterId)`
- `getMonthsList()`
- `getMonthDetail(monthId)`
- `getWeeksList()`
- `getWeekDetail(weekId)`
- `getDaysList()`
- `getDayDetail(dayId)`

Each function queries the appropriate Drizzle table and returns typed data.

- [ ] **Step 2: Create years list page**

```tsx
// dashboard/app/years/page.tsx
import { Suspense } from "react";
import { getYearsList } from "@/lib/server/temporal";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";

async function YearsList() {
  const years = await getYearsList();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Years</h1>
        <p className="text-sm text-text-secondary mt-1">Annual overview with goals and financial trends</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {years.map((year) => (
          <Link key={year.id} href={`/years/${year.id}`} className="block">
            <Card className="hover:border-border-strong transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h3 className="font-heading text-lg font-semibold text-text-primary">{year.year_number}</h3>
                  <Badge status={year.status === 'current' ? 'healthy' : year.status === 'past' ? 'neutral' : 'warning'}>
                    {year.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-text-secondary">
                  {year.goals_count} annual goals
                </p>
                {year.report_summary && (
                  <p className="text-xs text-text-muted mt-2 line-clamp-2">{year.report_summary}</p>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function YearsPage() {
  return (
    <Suspense fallback={<Skeleton variant="card" lines={6} />}>
      <YearsList />
    </Suspense>
  );
}
```

- [ ] **Step 3: Create remaining temporal pages following the same pattern**

Each temporal page follows the same Server Component + Suspense pattern. The detail pages include:
- Header with status badge
- Goals table
- Financial rollup from appropriate `fn_*` function
- Child temporal units (e.g., year detail shows quarters)

- [ ] **Step 4: Commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/app/years/ dashboard/app/quarters/ dashboard/app/months/ dashboard/app/weeks/ dashboard/app/days/ dashboard/lib/server/temporal.ts
git commit -m "feat(dashboard): Temporal pages — Years, Quarters, Months, Weeks, Days with list and detail views"
```

---

### Task 2.3: Goals Dashboard

**Files:**
- Create: `dashboard/app/goals/page.tsx`
- Create: `dashboard/app/_components/goals-dashboard.tsx`

- [ ] **Step 1: Create goals data fetcher**

`dashboard/lib/server/goals.ts`:
- `getAnnualGoals()`
- `getQuarterlyGoals()`

- [ ] **Step 2: Create goals page with annual/quarterly tables and completion chart**

- [ ] **Step 3: Commit**

---

## Task Group 3: Projects & Tasks Hub

### Task 3.1: Projects List

**Files:**
- Rewrite: `dashboard/app/projects/page.tsx`
- Create: `dashboard/app/_components/projects-table.tsx`
- Create: `dashboard/lib/server/projects.ts`

- [ ] **Step 1: Create projects data fetcher querying `v_project_health`**
- [ ] **Step 2: Create projects table with DataTable component**
- [ ] **Step 3: Add stat row with health distribution**
- [ ] **Step 4: Commit**

---

### Task 3.2: Project Detail (7 Tabs)

**Files:**
- Create: `dashboard/app/projects/[id]/page.tsx`
- Create: `dashboard/app/projects/[id]/_components/project-tabs.tsx`
- Create: `dashboard/app/projects/[id]/_components/tab-overview.tsx`
- Create: `dashboard/app/projects/[id]/_components/tab-monitor.tsx`
- Create: `dashboard/app/projects/[id]/_components/tab-progress.tsx`
- Create: `dashboard/app/projects/[id]/_components/tab-budget.tsx`
- Create: `dashboard/app/projects/[id]/_components/tab-risks.tsx`
- Create: `dashboard/app/projects/[id]/_components/tab-opportunities.tsx`
- Create: `dashboard/app/projects/[id]/_components/tab-activity.tsx`

- [ ] **Step 1: Create tabbed layout component**
- [ ] **Step 2: Implement each tab with appropriate data queries**
- [ ] **Step 3: Add Recharts for task status pie chart, cost trend line chart**
- [ ] **Step 4: Commit**

---

### Task 3.3: Tasks Page

**Files:**
- Create: `dashboard/app/tasks/page.tsx`
- Create: `dashboard/lib/server/tasks.ts`

- [ ] **Step 1: Create tasks DataTable with sprint grouping**
- [ ] **Step 2: Add filters for status, sprint, project, priority**
- [ ] **Step 3: Commit**

---

### Task 3.4: People Directory

**Files:**
- Rewrite: `dashboard/app/people/page.tsx`
- Create: `dashboard/app/people/[id]/page.tsx`
- Create: `dashboard/lib/server/people.ts`

- [ ] **Step 1: Create people card grid with status badges**
- [ ] **Step 2: Create person detail page with all 33 properties**
- [ ] **Step 3: Commit**

---

## Task Group 4: Financial Dashboard

### Task 4.1: Financial Overview

**Files:**
- Create: `dashboard/app/financial/page.tsx`
- Create: `dashboard/lib/server/financial.ts`

- [ ] **Step 1: Create financial data fetcher with rollup functions**
- [ ] **Step 2: Create area chart for income vs expenses (Recharts)**
- [ ] **Step 3: Create donut chart for category breakdown**
- [ ] **Step 4: Create stat cards and quarterly summary table**
- [ ] **Step 5: Commit**

---

### Task 4.2: Transactions Ledger

**Files:**
- Create: `dashboard/app/financial/transactions/page.tsx`

- [ ] **Step 1: Create transactions DataTable with advanced filtering**
- [ ] **Step 2: Add CSV export functionality**
- [ ] **Step 3: Add bulk selection with totals**
- [ ] **Step 4: Commit**

---

### Task 4.3: Accounts

**Files:**
- Create: `dashboard/app/financial/accounts/page.tsx`
- Create: `dashboard/app/financial/accounts/[id]/page.tsx`

- [ ] **Step 1: Create account cards grid**
- [ ] **Step 2: Create account detail with balance trend chart**
- [ ] **Step 3: Commit**

---

## Task Group 5: Operations Suite

### Task 5.1: Kanban Board (DnD)

**Files:**
- Rewrite: `dashboard/app/kanban/page.tsx`
- Create: `dashboard/app/kanban/_components/kanban-board.tsx`
- Create: `dashboard/app/kanban/_components/kanban-column.tsx`
- Create: `dashboard/app/kanban/_components/kanban-card.tsx`
- Create: `dashboard/app/kanban/_components/kanban-card-modal.tsx`
- Create: `dashboard/app/api/kanban/cards/route.ts`
- Create: `dashboard/lib/server/kanban.ts`

- [ ] **Step 1: Create Kanban server component with initial data fetch**
- [ ] **Step 2: Create client KanbanBoard with @dnd-kit**
- [ ] **Step 3: Implement optimistic updates with rollback**
- [ ] **Step 4: Create card detail modal**
- [ ] **Step 5: Create API route for card mutations**
- [ ] **Step 6: Commit**

---

### Task 5.2: Messages Center

**Files:**
- Create: `dashboard/app/messages/page.tsx`

- [ ] **Step 1: Create two-panel layout (thread list + message view)**
- [ ] **Step 2: Implement thread list with search/filter**
- [ ] **Step 3: Implement message view with compose**
- [ ] **Step 4: Commit**

---

### Task 5.3: Board Meetings

**Files:**
- Create: `dashboard/app/meetings/page.tsx`
- Create: `dashboard/app/meetings/[id]/page.tsx`

- [ ] **Step 1: Create meetings list table**
- [ ] **Step 2: Create meeting detail with accordion turns**
- [ ] **Step 3: Commit**

---

### Task 5.4: Agent Sessions

**Files:**
- Create: `dashboard/app/sessions/page.tsx`
- Create: `dashboard/app/sessions/[id]/page.tsx`

- [ ] **Step 1: Create sessions list table**
- [ ] **Step 2: Create session detail with message timeline**
- [ ] **Step 3: Add tool calls table with JSON view**
- [ ] **Step 4: Commit**

---

### Task 5.5: Ops Reports

**Files:**
- Create: `dashboard/app/ops-reports/page.tsx`
- Create: `dashboard/app/ops-reports/[id]/page.tsx`

- [ ] **Step 1: Create reports list table**
- [ ] **Step 2: Create report detail view**
- [ ] **Step 3: Commit**

---

## Task Group 6: Content, Journals & Settings

### Task 6.1: Campaigns & Content Pipeline

**Files:**
- Rewrite: `dashboard/app/campaigns/page.tsx`
- Create: `dashboard/app/campaigns/[id]/page.tsx`
- Rewrite: `dashboard/app/content/page.tsx`

- [ ] **Step 1: Create campaigns card grid with calendar view**
- [ ] **Step 2: Create content pipeline DataTable**
- [ ] **Step 3: Commit**

---

### Task 6.2: Unified Calendar

**Files:**
- Rewrite: `dashboard/app/calendar/page.tsx`

- [ ] **Step 1: Create month/week/day calendar view**
- [ ] **Step 2: Add multi-domain event sources (deadlines, campaigns, activities)**
- [ ] **Step 3: Commit**

---

### Task 6.3: Journals (4 Types)

**Files:**
- Create: `dashboard/app/journals/subjective/page.tsx`
- Create: `dashboard/app/journals/relational/page.tsx`
- Create: `dashboard/app/journals/systemic/page.tsx`
- Create: `dashboard/app/journals/diet/page.tsx`
- Create: `dashboard/app/journals/[type]/[id]/page.tsx`

- [ ] **Step 1: Create reusable journal page component**
- [ ] **Step 2: Instantiate for all 4 journal types**
- [ ] **Step 3: Create journal entry detail with prev/next navigation**
- [ ] **Step 4: Commit**

---

### Task 6.4: Settings

**Files:**
- Rewrite: `dashboard/app/settings/page.tsx`

- [ ] **Step 1: Create settings page with sections (Database, Agent Config, Appearance, Data, About)**
- [ ] **Step 2: Implement database connection status and row counts**
- [ ] **Step 3: Add export/import buttons**
- [ ] **Step 4: Commit**

---

## Task Group 7: Polish & Performance

### Task 7.1: Error Boundaries

**Files:**
- Create: `dashboard/components/error-boundary.tsx`
- Create: `dashboard/app/error.tsx`
- Create: `dashboard/app/not-found.tsx`
- Create: `dashboard/app/loading.tsx`

- [ ] **Step 1: Create global error boundary**
- [ ] **Step 2: Create 404 page**
- [ ] **Step 3: Create global loading skeleton**
- [ ] **Step 4: Commit**

---

### Task 7.2: Performance Optimization

**Files:**
- Modify: `dashboard/next.config.ts`

- [ ] **Step 1: Add dynamic imports for Recharts charts (ssr: false)**
- [ ] **Step 2: Enable bundle splitting in next.config.ts**
- [ ] **Step 3: Add virtualization for large tables (@tanstack/react-virtual)**
- [ ] **Step 4: Verify build and analyze bundle size**
- [ ] **Step 5: Commit**

---

### Task 7.3: Accessibility

- [ ] **Step 1: Audit all pages for keyboard navigation (Tab, Enter, Escape)**
- [ ] **Step 2: Add aria-labels to all interactive elements**
- [ ] **Step 3: Ensure focus management in modals and drawers**
- [ ] **Step 4: Test with screen reader (VoiceOver/NVDA)**
- [ ] **Step 5: Commit**

---

### Task 7.4: Final Verification

- [ ] **Step 1: Run `bun run build` — must pass with 0 errors**
- [ ] **Step 2: Run `docker compose up` — must start PostgreSQL + dashboard**
- [ ] **Step 3: Verify all 40+ routes load (with or without data)**
- [ ] **Step 4: Verify mobile responsive at 375px**
- [ ] **Step 5: Verify keyboard navigation across all pages**
- [ ] **Step 6: Final commit**

```bash
cd /home/ishanp/Documents/GitHub/operant
git add dashboard/
git commit -m "feat(dashboard): Phase 7 complete — polish, performance, accessibility

- Global error boundaries and 404 page
- Recharts SSR-safe dynamic imports
- Bundle splitting and virtualization
- Full keyboard navigation and aria labels
- Mobile responsive at 375px
- All 40+ routes functional with graceful fallbacks"
```

---

## Success Criteria Checklist

- [ ] All 48 tables have at least one dashboard page displaying their data
- [ ] All 5 PostgreSQL views are rendered on the dashboard
- [ ] All 29 functions are accessible via dashboard pages or chart data
- [ ] Zero TypeScript errors across all dashboard files
- [ ] All pages load with or without database connection (graceful fallback)
- [ ] Mobile responsive — usable on 375px width
- [ ] Keyboard navigable — all interactive elements reachable via Tab
- [ ] Dark mode default — light mode available via preference
- [ ] Build passes — `bun run build` succeeds
- [ ] Docker Compose — `docker compose up` starts PostgreSQL + dashboard
