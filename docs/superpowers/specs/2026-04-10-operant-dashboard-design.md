# Operant Dashboard — Full-Scale Design Document

**Date**: 2026-04-10
**Author**: Sisyphus
**Status**: Draft — awaiting review
**Scope**: Complete Next.js 15 dashboard replacing Notion + SQLite for the Operant system
**Target**: PostgreSQL 16, 48 tables, 5 views, 29 functions, self-hosted

---

## 1. System Overview

### 1.1 Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Operant Dashboard                  │
│                    (Next.js 15)                       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │   Server    │  │   Client     │  │  Shared    │  │
│  │ Components  │  │ Components   │  │  Schema    │  │
│  │             │  │              │  │            │  │
│  │ - Pages     │  │ - Kanban DnD │  │ - Drizzle  │  │
│  │ - Data      │  │ - Search     │  │ - ORM      │  │
│  │   fetching  │  │ - Charts     │  │ - Types    │  │
│  │ - Skeletons │  │ - Forms      │  │            │  │
│  │ - SSR       │  │ - DragDrop   │  │            │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬─────┘  │
│         │                │                   │        │
│         └────────────────┼───────────────────┘        │
│                          │                            │
│                 ┌────────▼────────┐                   │
│                 │   lib/db.ts     │                   │
│                 │  (pg Pool)      │                   │
│                 └────────┬────────┘                   │
└──────────────────────────┼────────────────────────────┘
                           │
                  ┌────────▼────────┐
                  │    PostgreSQL   │
                  │     v16         │
                  │                 │
                  │ 48 tables       │
                  │ 29 functions    │
                  │  5 views        │
                  │ RLS policies    │
                  └─────────────────┘
```

### 1.2 Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server-first rendering, streaming |
| Styling | Tailwind CSS v4 | Utility-first with custom design tokens |
| ORM | Drizzle ORM + pg | Type-safe PostgreSQL queries |
| Charts | Recharts | Financial trends, KPIs, distributions |
| Tables | @tanstack/react-table | Sorting, filtering, pagination, virtualization |
| Drag & Drop | @dnd-kit/core + sortable | Kanban board interactions |
| Icons | Lucide React | Consistent SVG icon family |
| Dates | date-fns | Formatting, relative time, arithmetic |
| Fonts | Fira Code + Fira Sans | Technical monospace + human-readable body |
| Package manager | bun | Fast installs, already in project |

### 1.3 Design System

**Style**: Dark-first operations dashboard (OLED-optimized)

| Token | Value | Usage |
|---|---|---|
| `--bg-primary` | `#0A0E27` | Page background (midnight blue) |
| `--bg-surface` | `#121212` | Card backgrounds |
| `--bg-elevated` | `#1A1A2E` | Modals, dropdowns, sidebar |
| `--bg-hover` | `#1F2937` | Hover states |
| `--border-default` | `rgba(255,255,255,0.08)` | Card borders, dividers |
| `--text-primary` | `#FFFFFF` | Headings, labels |
| `--text-secondary` | `#A1A1AA` | Subtitles, metadata |
| `--text-muted` | `#71717A` | Placeholders, disabled |
| `--accent-primary` | `#1E40AF` | Primary buttons, links |
| `--accent-secondary` | `#3B82F6` | Secondary actions |
| `--accent-cta` | `#D97706` | Highlights, warnings |
| `--status-healthy` | `#10B981` + "Healthy" | Green status (always paired with text) |
| `--status-warning` | `#F59E0B` + "Warning" | Amber status |
| `--status-critical` | `#EF4444` + "Critical" | Red status |
| `--status-neutral` | `#6B7280` + "Inactive" | Gray status |
| `--font-heading` | Fira Code | Headings, data labels, monospace precision |
| `--font-body` | Fira Sans | Body text, descriptions, paragraphs |
| `--font-mono` | Fira Code | Code snippets, IDs, hashes |
| `--radius-sm` | `6px` | Small elements (badges, inputs) |
| `--radius-md` | `8px` | Default (buttons, small cards) |
| `--radius-lg` | `12px` | Cards, modals |
| `--radius-xl` | `16px` | Large panels, page sections |
| `--z-sidebar` | `50` | Fixed sidebar |
| `--z-modal` | `100` | Modals, dialogs |
| `--z-toast` | `200` | Toast notifications |
| `--z-command` | `300` | Command palette |
| `--space-unit` | `4px` | Base spacing unit (4/8/12/16/24/32/48) |

### 1.4 Layout Structure

```
┌──────────────────────────────────────────────────────┐
│  Sidebar (w-64, collapsible → w-16)                  │
│  ┌─────────────────────┐                             │
│  │  O  Operant         │  ← Brand header             │
│  ├─────────────────────┤                             │
│  │  📋 Overview        │                             │
│  │     Daily Briefing  │  ← Section + items          │
│  │     Project Monitor │                             │
│  │  📦 Operations      │                             │
│  │     Projects        │                             │
│  │     Tasks           │                             │
│  │     People          │                             │
│  │     Kanban Board    │                             │
│  │  📈 Marketing       │                             │
│  │     Campaigns       │                             │
│  │     Content Pipeline│                             │
│  │     Calendar        │                             │
│  │  📊 Financial       │                             │
│  │     Dashboard       │                             │
│  │     Transactions    │                             │
│  │     Accounts        │                             │
│  │  📓 Journals        │                             │
│  │     Subjective      │                             │
│  │     Relational      │                             │
│  │     Systemic        │                             │
│  │     Diet Log        │                             │
│  │  ⚙️ Ops             │                             │
│  │     Board Meetings  │                             │
│  │     Messages        │                             │
│  │     Agent Sessions  │                             │
│  │     Reports         │                             │
│  ├─────────────────────┤                             │
│  │  ⚙️ Settings        │  ← Footer section           │
│  └─────────────────────┘                             │
│                                                      │
│  Main Content (max-w-7xl, px-6 py-8)                 │
│  ┌──────────────────────────────────────────┐        │
│  │  Page Header (h1 + subtitle + actions)    │        │
│  │  ┌────────┐ ┌────────┐ ┌────────┐        │        │
│  │  │ Stat   │ │ Stat   │ │ Stat   │ ...    │        │
│  │  └────────┘ └────────┘ └────────┘        │        │
│  │  ┌──────────────────┐ ┌────────────────┐ │        │
│  │  │   Chart / Table  │ │   Chart / List │ │        │
│  │  └──────────────────┘ └────────────────┘ │        │
│  │  ┌────────────────────────────────────┐  │        │
│  │  │         Detail Table               │  │        │
│  │  └────────────────────────────────────┘  │        │
│  └──────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘
```

---

## 2. Sub-Project 1: Foundation & Design System

### 2.1 Scope

The foundation layer that every other sub-project depends on. Replaces the current light-mode scaffold with a professional dark-first operations dashboard.

### 2.2 Files Changed/Created

| File | Action | Purpose |
|---|---|---|
| `dashboard/app/globals.css` | Rewrite | Dark-first CSS variables, semantic tokens, focus-visible, scrollbar, tabular-nums |
| `dashboard/app/layout.tsx` | Rewrite | Responsive layout with collapsible sidebar, client provider |
| `dashboard/components/sidebar.tsx` | Rewrite | Collapsible, section-grouped, icon+text, active state, mobile drawer |
| `dashboard/components/sidebar-mobile.tsx` | Create | Mobile overlay drawer with hamburger trigger |
| `dashboard/components/skeleton.tsx` | Create | Reusable skeleton loader matching card/table shapes |
| `dashboard/components/card.tsx` | Create | Base card with variant support (default, elevated, bordered) |
| `dashboard/components/badge.tsx` | Create | Status badge (healthy/warning/critical/neutral) with emoji + text |
| `dashboard/components/data-table.tsx` | Create | TanStack Table wrapper with sorting, filtering, pagination |
| `dashboard/components/chart-card.tsx` | Create | Chart container with title, subtitle, loading, empty, error states |
| `dashboard/components/toast.tsx` | Create | Toast notification system (sonner or custom) |
| `dashboard/components/modal.tsx` | Create | Dialog/modal with backdrop, keyboard escape, focus trap |
| `dashboard/components/command-palette.tsx` | Create | Cmd+K command palette with fuzzy search |
| `dashboard/components/empty-state.tsx` | Create | Standardized empty state with icon, message, CTA |
| `dashboard/components/progress-bar.tsx` | Create | Progress bar with color semantics and label |
| `dashboard/lib/utils.ts` | Extend | Add cn() with tailwind-merge, generateId, truncate, clamp |
| `dashboard/lib/keyboard-shortcuts.ts` | Create | Keyboard shortcut registry and handler |
| `dashboard/lib/constants.ts` | Create | Z-index scale, spacing scale, status map, nav config |
| `dashboard/drizzle/schema/` | Symlink | Shared schema (already exists) |
| `dashboard/package.json` | Update | Add @tanstack/react-table, @dnd-kit, recharts, clsx, tailwind-merge, sonner |

### 2.3 Design Rules

- **No emojis as structural icons** — use Lucide SVGs exclusively
- **Status always has text** — color + label, never color alone
- **Dark-first** — light mode via `prefers-color-scheme: light` override, not default
- **Tabular numbers** for all data columns (prevents layout shift)
- **Focus-visible rings** — 2px blue ring offset 2px on all interactive elements
- **Z-index scale** — 10/20/30/40/50/100/200/300, never arbitrary values
- **Spacing** — multiples of 4px only (4/8/12/16/20/24/32/40/48)

### 2.4 Sidebar Navigation Structure

```typescript
const navigation = [
  { section: 'Overview', items: [
    { href: '/', label: 'Daily Briefing', icon: LayoutDashboard },
    { href: '/monitor', label: 'Project Monitor', icon: Activity },
  ]},
  { section: 'Temporal', items: [
    { href: '/years', label: 'Years', icon: Calendar },
    { href: '/quarters', label: 'Quarters', icon: CalendarClock },
    { href: '/months', label: 'Months', icon: CalendarDays },
    { href: '/weeks', label: 'Weeks', icon: CalendarRange },
    { href: '/days', label: 'Days', icon: Sun },
  ]},
  { section: 'Operations', items: [
    { href: '/projects', label: 'Projects', icon: FolderKanban },
    { href: '/tasks', label: 'Tasks', icon: CheckSquare },
    { href: '/people', label: 'People', icon: Users },
    { href: '/kanban', label: 'Kanban Board', icon: Columns },
  ]},
  { section: 'Financial', items: [
    { href: '/financial', label: 'Dashboard', icon: BarChart3 },
    { href: '/financial/transactions', label: 'Transactions', icon: Receipt },
    { href: '/financial/accounts', label: 'Accounts', icon: Landmark },
  ]},
  { section: 'Marketing', items: [
    { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
    { href: '/content', label: 'Content Pipeline', icon: FileText },
    { href: '/calendar', label: 'Calendar', icon: Calendar },
  ]},
  { section: 'Journals', items: [
    { href: '/journals/subjective', label: 'Subjective', icon: Pen },
    { href: '/journals/relational', label: 'Relational', icon: UsersRound },
    { href: '/journals/systemic', label: 'Systemic', icon: Network },
    { href: '/journals/diet', label: 'Diet Log', icon: Apple },
  ]},
  { section: 'Ops', items: [
    { href: '/meetings', label: 'Board Meetings', icon: Users },
    { href: '/messages', label: 'Messages', icon: Mail },
    { href: '/sessions', label: 'Agent Sessions', icon: Cpu },
    { href: '/ops-reports', label: 'Reports', icon: FileBarChart },
  ]},
  { section: '', items: [
    { href: '/settings', label: 'Settings', icon: Settings, separator: true },
  ]},
];
```

---

## 3. Sub-Project 2: LifeOS Core (Temporal + Goals)

### 3.1 Pages

#### 3.1.1 Daily Briefing (`/` — Upgrade)

**Purpose**: Operator's morning overview — what needs attention today.

**Data Sources**: `v_daily_briefing`, `v_project_health`, `fn_year_status()`, `days` table

**Sections** (top to bottom):
1. **Header**: Date, day name, temporal status badge (Today/Past/Future)
2. **Stat Row** (4 cards):
   - Active Projects (count from `v_project_health` where health != stalled)
   - Due Tasks (count from `tasks` where status = 'due' and week_id = current)
   - Today's Income (from `fn_day_income()` if exists, else financial_log sum)
   - Health Score (average from `days` where date = current_date)
3. **Project Health** (table, top 10):
   - Columns: Project, Health (🟢🟡🔴 + text), Score, Progress bar, Status
   - Sorted by health_score DESC
4. **Today's Activities** (list):
   - Activity type, title, time range, energy level, mood delta
   - Color-coded by priority
5. **Due Tasks** (list):
   - Task name, project, due date, priority badge
6. **Upcoming Deadlines** (next 7 days):
   - Project name, deadline, days remaining
7. **Quick Actions** (button row):
   - View Projects, Open Kanban, People Directory, Financial Dashboard

**Layout**: 2-column grid on desktop (health + activities), single column on mobile

**Loading**: Each section has independent Suspense boundary with skeleton

#### 3.1.2 Years (`/years`)

**Purpose**: Year-level overview with goals and financial trends.

**Data Sources**: `years`, `annual_goals`, `fn_year_json()`, `fn_year_status()`

**Sections**:
1. **Year Grid** (cards, one per year):
   - Year number, status badge (Current/Past/Future), annual goals count
   - Year report summary (truncated)
   - Click → year detail page
2. **Financial Trend** (area chart):
   - Income vs expenses across all years
   - Recharts AreaChart with gradient fill

#### 3.1.3 Year Detail (`/years/[year_id]`)

**Purpose**: Deep dive into a specific year.

**Sections**:
1. Year header with status badge and year range
2. Annual goals table (goal, status, completion %, related projects)
3. Quarterly breakdown (4 cards linking to quarter detail)
4. Financial summary (total income, expenses, net, by quarter)

#### 3.1.4 Quarters (`/quarters`), Months (`/months`), Weeks (`/weeks`)

**Pattern**: Same structure as Years but filtered to the temporal unit.

**Columns for all**:
- Name/Range, Status badge, Goals count, Financial summary, Link to detail

**Quarter detail adds**:
- Quarterly goals table
- Financial rollup from `fn_quarter_income/expenses/net_cashflow`
- Projects active during quarter

**Month detail adds**:
- Financial rollup from `fn_month_income/expenses/net_cashflow`
- Category summary from `fn_category_summary`
- Weeks contained

**Week detail adds**:
- Financial rollup from `fn_week_income/expenses/net_cashflow`
- Tasks due this week
- Activities logged this week

#### 3.1.5 Days (`/days` + `/days/[day_id]`)

**Purpose**: Day-level detail with health tracking.

**Day list page**:
- Calendar-style grid or table view
- Columns: Date, Day name, Health score, Status, Activities count
- Filter by month/week

**Day detail page**:
- Health metrics (score, weight, sleep, exercise, water)
- Activities logged (type, duration, energy, mood delta)
- Journal entries (subjective, relational, systemic)
- Diet log entries

#### 3.1.6 Goals Dashboard (`/goals`)

**Purpose**: Unified view of annual and quarterly goals.

**Sections**:
1. **Annual Goals** (table):
   - Goal, status, completion %, related projects, progress bar
   - Filter by status, sort by priority
2. **Quarterly Goals** (grouped by quarter):
   - Same columns, with quarter header
   - Expandable sections
3. **Goal Completion Chart** (bar chart):
   - Completion rate by quarter

### 3.2 Data Tables

| Table | Data Source | Sortable Columns | Filters |
|---|---|---|---|
| Annual Goals | `annual_goals` | name, status, completion | status |
| Quarterly Goals | `quarterly_goals` | name, status, quarter | status, quarter |
| Days | `days` + `v_daily_briefing` | date, health_score, status | date range, status |
| Years | `years` + `fn_year_status` | year_number, status | status |
| Quarters | `quarters` + `fn_quarter_status` | quarter_range, status | status |
| Months | `months` + `fn_month_status` | month_range, status | status |

### 3.3 Charts

| Chart | Type | Data Source | Placement |
|---|---|---|---|
| Year Financial Trend | Area (gradient) | `financial_log` grouped by year | `/years` |
| Quarterly Income/Expenses | Grouped Bar | `fn_quarter_*` functions | `/quarters/[id]` |
| Monthly Category Breakdown | Pie | `fn_category_summary` | `/months/[id]` |
| Weekly Net Cashflow | Line | `fn_week_net_cashflow` | `/weeks/[id]` |
| Goal Completion Rate | Horizontal Bar | `annual_goals` + `quarterly_goals` | `/goals` |

---

## 4. Sub-Project 3: Projects & Tasks Hub

### 4.1 Pages

#### 4.1.1 Projects List (`/projects` — Upgrade)

**Purpose**: Overview of all projects with health scoring.

**Data Source**: `v_project_health`, `v_project_progress`, `projects`

**Sections**:
1. **Header**: Title, subtitle, search input, filter dropdowns
2. **Stat Row** (4 cards):
   - Total Projects (count)
   - On Track (🟢 count)
   - At Risk (🟡 count)
   - Off Track (🔴 count)
3. **Health Distribution** (horizontal bar chart):
   - Shows proportion of projects in each health state
4. **Projects Table** (TanStack Table):
   - Columns: Project, Health (emoji + label), Score, Progress bar, Status, Phase, Deadline, Team size, Budget
   - Sortable: all columns
   - Filters: health status, phase, status
   - Search: project name
   - Pagination: 10/25/50 per page
   - Row click → project detail

#### 4.1.2 Project Detail (`/projects/[id]`)

**Purpose**: Complete project view with monitor, progress, budget, risks.

**Tabs**: Overview | Monitor | Progress | Budget | Risks | Opportunities | Activity

**Tab 1: Overview**
- Project header: name, status badge, health emoji, progress %
- Summary, justification, strategy, KPI
- Key metrics: deadline, days remaining, team size, budget allocated/spent
- Related entities: goals, campaigns, people, directives, opportunities

**Tab 2: Monitor** (from `v_project_monitor`)
- Status, phase, deadline proximity (days)
- Deadline status badge (On Track / Due Soon / Overdue)
- Task completion % (from task stats)
- Budget remaining and utilization %
- Activity count (linked activities)
- Projected profit/loss

**Tab 3: Progress** (from `v_project_progress`)
- Task progress bar (actual completion %)
- Time progress bar (elapsed % from start to deadline)
- Pacing badge: Ahead / On Track / Behind
- Pacing explanation (task_progress vs time_progress comparison)
- Tasks breakdown by status (pie chart)

**Tab 4: Budget**
- Budget allocated vs spent (bullet chart)
- Required budget vs projected revenue
- Financial log entries linked to this project (table)
- Cost to date trend (line chart)

**Tab 5: Risks**
- Directives/Risk Log entries linked to project (table)
- Columns: Title, threat_level, likelihood, impact, mitigation
- Threat level distribution (bar chart)

**Tab 6: Opportunities**
- Opportunities/Strengths entries linked to project (table)
- Columns: Title, strength, impact, action plan

**Tab 7: Activity**
- Activity log entries linked to project (table)
- Columns: Date, type, duration, energy, mood, notes
- Activity type distribution (pie chart)

### 4.1.3 Tasks (`/tasks`)

**Purpose**: Task management with sprint awareness.

**Data Source**: `tasks`, `projects` (for project names)

**Sections**:
1. **Header**: Title, search, filters (status, sprint, project, priority)
2. **Task Table** (TanStack Table):
   - Columns: Task, Project, Status, Sprint, Priority, Due date, Week
   - Sortable: all columns
   - Filters: status, sprint_status, priority, project
   - Row click → task detail or inline expand
3. **Sprint View** (toggle):
   - Grouped by sprint status
   - Cards per sprint showing task count and completion %

### 4.2 Charts

| Chart | Type | Data Source | Placement |
|---|---|---|---|
| Health Distribution | Horizontal Bar | `v_project_health` | `/projects` |
| Task Status Breakdown | Pie | `tasks` grouped by status | `/projects/[id]` tab 3 |
| Budget Bullet | Bullet Chart | `projects.budget_allocated` vs `budget_spent` | `/projects/[id]` tab 4 |
| Cost Trend | Line | `financial_log` filtered by project | `/projects/[id]` tab 4 |
| Threat Level Distribution | Bar | `directives_risk_log` threat_level | `/projects/[id]` tab 5 |
| Activity Type Distribution | Pie | `activity_log` filtered by project | `/projects/[id]` tab 7 |

---

## 5. Sub-Project 4: Financial Dashboard

### 5.1 Pages

#### 5.1.1 Financial Dashboard (`/financial`)

**Purpose**: Executive financial overview.

**Data Sources**: `financial_log`, `financial_accounts`, `v_quarterly_report`, financial rollup functions

**Sections**:
1. **Stat Row** (4 cards):
   - Total Income (sum signed_amount > 0, current period)
   - Total Expenses (sum ABS(signed_amount < 0), current period)
   - Net Cashflow (income + expenses)
   - Number of Accounts (count from financial_accounts)
2. **Income vs Expenses** (area chart, 12 months):
   - Two series: income (green gradient) and expenses (red gradient)
   - Net line overlay (blue)
   - Toggle: Monthly / Weekly / Daily
3. **Category Breakdown** (donut chart):
   - Expense categories with percentages
   - Click to filter transactions
4. **Recent Transactions** (table, top 10):
   - Date, amount, category, account, description
   - Link to transactions page
5. **Account Balances** (cards):
   - One card per account: name, balance, type
   - Link to accounts page
6. **Quarterly Summary** (table):
   - Quarter, income, expenses, net cashflow
   - From `v_quarterly_report`

#### 5.1.2 Transactions (`/financial/transactions`)

**Purpose**: Full transaction ledger with advanced filtering.

**Data Source**: `financial_log`

**Table** (TanStack Table):
- Columns: Date, Signed Amount, Category, Account, Week, Month, Project, Capital Engine, Description
- Sortable: all columns
- Filters: category, account, project, capital_engine, date range, amount range
- Search: description
- Pagination: 25/50/100 per page
- Export: CSV button
- Bulk selection with totals

#### 5.1.3 Accounts (`/financial/accounts`)

**Purpose**: Account management and balances.

**Data Source**: `financial_accounts`

**Sections**:
1. **Account Cards** (one per account):
   - Account name, type, status, balance
   - Total income, total expenses (from rollup functions)
   - Transaction count
   - Link to account detail
2. **Account Detail** (`/financial/accounts/[id]`):
   - Account info header
   - Transaction history (filtered table)
   - Balance trend (line chart)

### 5.2 Charts

| Chart | Type | Data Source | Placement |
|---|---|---|---|
| Income vs Expenses | Area (dual gradient) | `financial_log` by date | `/financial` |
| Category Breakdown | Donut | `financial_log.category` | `/financial` |
| Balance Trend | Line | `financial_accounts` + transactions | `/financial/accounts/[id]` |
| Net Cashflow by Quarter | Bar | `v_quarterly_report` | `/financial` |
| Amount Distribution | Histogram | `financial_log.signed_amount` | `/financial/transactions` |

---

## 6. Sub-Project 5: Operations Suite

### 6.1 Pages

#### 6.1.1 Kanban Board (`/kanban` — Upgrade)

**Purpose**: Interactive task management with drag-and-drop.

**Data Sources**: `kanban_boards`, `kanban_columns`, `kanban_cards`, `kanban_card_activity`, `kanban_reporting_lines`

**Sections**:
1. **Board Selector** (dropdown): Select agent's board
2. **Board** (horizontal columns):
   - Columns from `kanban_columns` (ordered by `ord`)
   - Cards from `kanban_cards` grouped by `column_id`
   - Drag-and-drop between columns using @dnd-kit
3. **Card Detail** (click opens modal):
   - Title, description, priority, due date
   - Tags, assignee, linked project
   - Activity history (timeline)
   - Edit form
4. **Add Card** (button per column):
   - Quick-add form in column
   - Title (required), description, priority, due, tags

**Interaction Model**:
- Drag card between columns → updates `column_id` in DB
- Optimistic update with rollback on failure
- Visual feedback during drag (card lifts, drop zone highlights)
- Double-click card → detail modal
- Inline edit for title (click to edit)

#### 6.1.2 Messages (`/messages`)

**Purpose**: Inter-agent messaging center.

**Data Sources**: `message_threads`, `messages`, `message_escalations`

**Sections**:
1. **Thread List** (left panel, 320px wide):
   - Subject, participants, status, last message preview, unread count
   - Filter by status (active, archived), tags
   - Search by subject or content
2. **Message View** (main panel):
   - Thread header: subject, participants, status, tags
   - Messages in chronological order
   - Each message: from, to, content, priority, requires_response, responded, read
   - Compose reply at bottom
3. **Compose** (button → modal or slide-over):
   - To, subject, content, priority, tags
   - Requires response toggle
   - Send button

#### 6.1.3 Board Meetings (`/meetings`)

**Purpose**: Board meeting management and history.

**Data Sources**: `board_meetings`, `board_meeting_turns`, `board_meeting_responses`

**Sections**:
1. **Meeting List** (table):
   - Date, status, objective, started at, concluded at
   - Click → meeting detail
2. **Meeting Detail** (`/meetings/[id]`):
   - Meeting header: date, status, objective
   - Turns (accordion): each turn shows CEO directive, CEO response, synthesis
   - Agent responses per turn: agent ID, content, tool calls made, timestamp
   - User decision and feedback fields

#### 6.1.4 Agent Sessions (`/sessions`)

**Purpose**: Session management and monitoring.

**Data Sources**: `agent_sessions`, `session_messages`, `session_tool_calls`, `ops_sessions`, `session_steps`

**Sections**:
1. **Session List** (table):
   - Agent, title, status, message count, last used, has real conversation
   - Filter by agent, status
2. **Session Detail** (`/sessions/[id]`):
   - Session header: agent, title, workspace, compaction count
   - Messages timeline (scrollable):
     - Role, content (truncated, expandable), token estimate, is summary
   - Tool calls table:
     - Tool name, arguments (JSON view), result, token estimate, compacted

#### 6.1.5 Ops Reports (`/ops-reports`)

**Purpose**: Operational reports and analytics.

**Data Sources**: `ops_reports`, `ops_sessions`, `tool_correlations`, `oc_sessions`

**Sections**:
1. **Reports List** (table):
   - Agent, period, summary, metrics (JSON preview), actions count
   - Click → report detail
2. **Report Detail**:
   - Full report content
   - Metrics visualization (if structured)
   - Actions list
3. **Tool Correlations** (table):
   - Tool name, args hash (truncated), result pattern
   - Frequency count

### 6.2 Charts

| Chart | Type | Data Source | Placement |
|---|---|---|---|
| Card Distribution | Bar | `kanban_cards` grouped by column | `/kanban` header |
| Message Volume | Line | `messages` by date | `/messages` |
| Meeting Turn Duration | Bar | `board_meeting_turns` count per meeting | `/meetings` |
| Session Activity | Line | `session_messages` by date | `/sessions` |
| Tool Usage | Horizontal Bar | `session_tool_calls` by name | `/sessions/[id]` |

---

## 7. Sub-Project 6: Content, Journals & Settings

### 7.1 Pages

#### 7.1.1 Campaigns (`/campaigns`)

**Purpose**: Campaign calendar and content association.

**Data Sources**: `campaigns`, `campaign_platforms` (junction)

**Sections**:
1. **Campaign Cards** (grid):
   - Name, status, start/end dates, duration, platform(s), content count
   - Color-coded by status
2. **Campaign Calendar** (calendar view):
   - Month/week view
   - Campaigns shown as blocks on date range
3. **Campaign Detail** (`/campaigns/[id]`):
   - Campaign info header
   - Associated content (table)
   - Platform list
   - Performance metrics (if available)

#### 7.1.2 Content Pipeline (`/content`)

**Purpose**: Content creation and publishing tracking.

**Data Sources**: `content_pipeline`, `content_platforms` (junction)

**Table** (TanStack Table):
- Columns: Title, type, status, platform(s), engagement rate, reach, engagement, publish date
- Sortable: all columns
- Filters: status, type, platform
- Search: title

#### 7.1.3 Calendar (`/calendar`)

**Purpose**: Unified temporal calendar view.

**Data Sources**: `days`, `weeks`, `months`, project deadlines, campaign dates

**Features**:
- Month/week/day view toggle
- Events: project deadlines, campaign start/end, scheduled activities
- Click event → detail page
- Color-coded by domain (projects=blue, campaigns=amber, activities=green)

#### 7.1.4 Journals (`/journals/*`)

**Pages**:
- `/journals/subjective` — `subjective_journal` table
- `/journals/relational` — `relational_journal` table (with people links)
- `/journals/systemic` — `systemic_journal` table
- `/journals/diet` — `diet_log` table (with health metrics)

**Each journal page**:
1. **Entry List** (table):
   - Date, content preview (truncated), related entities, mood/energy (if applicable)
   - Sortable by date
   - Search in content
2. **Entry Detail** (`/journals/[type]/[id]`):
   - Full content (markdown rendering if applicable)
   - Related entities (day, people, projects)
   - Navigation: prev/next entry

#### 7.1.5 People Detail (`/people/[id]`)

**Purpose**: Complete person profile with all 33 properties.

**Data Source**: `people`, `project_people` (junction), `relational_journal`

**Sections**:
1. **Header**: Name, avatar placeholder, relationship type, status
2. **Contact Info**: Email, phone, location, social links
3. **Relationship Intel**: How we met, influence, connection frequency, last connected
4. **Projects** (table): Projects this person is linked to
5. **Journal Entries** (list): Relational journal entries mentioning this person
6. **Notes**: Any notes associated with this person

#### 7.1.6 Settings (`/settings`)

**Purpose**: System configuration.

**Sections**:
1. **Database**: Connection status, row counts per table, last migration
2. **Agent Config**: Agent IDs, workspace paths
3. **Appearance**: Theme toggle (dark/light), font size
4. **Data**: Export/Import buttons, backup status
5. **About**: Version info, links to documentation

---

## 8. Component Specifications

### 8.1 Reusable Components

| Component | Props | States | Dependencies |
|---|---|---|---|
| `Skeleton` | `variant: 'card' \| 'table' \| 'text' \| 'chart'`, `lines?: number` | Always loading | None |
| `Card` | `variant: 'default' \| 'elevated' \| 'bordered'`, `children`, `className` | Default, hover | None |
| `StatCard` | `title`, `value`, `icon`, `trend?`, `subtitle?`, `loading?` | Loading, loaded, error | `Skeleton` |
| `Badge` | `status: 'healthy' \| 'warning' \| 'critical' \| 'neutral'`, `children` | Default | None |
| `DataTable<T>` | `data`, `columns`, `sorting?`, `filtering?`, `pagination?`, `search?`, `loading?` | Loading, empty, loaded, error | TanStack Table, `Skeleton` |
| `ChartCard` | `title`, `subtitle`, `children (Recharts)`, `loading?`, `error?` | Loading, empty, loaded, error | `Skeleton`, Recharts |
| `ProgressBar` | `value`, `max`, `color?`, `label?`, `showLabel?` | Default | None |
| `EmptyState` | `icon`, `title`, `description`, `action?` (label + href) | Always empty | Lucide icon |
| `Modal` | `open`, `onClose`, `title`, `children`, `size?: 'sm' \| 'md' \| 'lg'` | Open, closed | None |
| `Toast` | (via sonner) | Auto-dismiss, manual dismiss | sonner |
| `CommandPalette` | `open`, `onClose`, `commands` | Open, closed, searching | None |
| `Sidebar` | `collapsed`, `onToggle` | Expanded, collapsed, mobile overlay | None |

### 8.2 Chart Specifications

All charts share these properties:
- **Loading**: Skeleton placeholder matching chart shape
- **Empty**: EmptyState with "No data available"
- **Error**: ErrorState with retry button
- **Responsive**: Reflow on window resize
- **Accessible**: aria-label, screen reader summary, keyboard navigable
- **No color-only meaning**: Labels, patterns, or tooltips always present

### 8.3 Table Specifications

All tables use TanStack Table with these defaults:
- **Sorting**: Client-side for < 1000 rows, server-side for > 1000
- **Filtering**: Text search + column-specific filters
- **Pagination**: 10/25/50/100 per page, default 25
- **Virtualization**: Enabled for > 50 rows
- **Row actions**: Click to view detail, context menu for actions
- **Column visibility**: Toggle which columns are shown
- **Export**: CSV download button

---

## 9. Data Flow Architecture

### 9.1 Server Components (Data Fetching)

```typescript
// Pattern: Server Component with Suspense boundary
export default async function ProjectsPage() {
  return (
    <div>
      <PageHeader title="Projects" subtitle="..." />
      <Suspense fallback={<StatRowSkeleton />}>
        <ProjectStats />
      </Suspense>
      <Suspense fallback={<DataTableSkeleton />}>
        <ProjectsTable />
      </Suspense>
    </div>
  );
}

async function ProjectStats() {
  const data = await db.select(...).from(v_project_health);
  return <StatRow data={data} />;
}

async function ProjectsTable() {
  const data = await db.select().from(projects);
  return <DataTable data={data} columns={projectColumns} />;
}
```

### 9.2 Client Components (Interactivity)

```typescript
// Pattern: Client component for interactivity
'use client';

export function KanbanBoard({ initialData }) {
  const [cards, setCards] = useState(initialData);

  const handleDragEnd = async (event) => {
    // Optimistic update
    const newCards = moveCard(cards, event);
    setCards(newCards);

    try {
      await updateCardColumn(event.active.id, event.over.id);
    } catch {
      // Rollback
      setCards(cards);
      toast.error('Failed to move card');
    }
  };

  return <DndContext onDragEnd={handleDragEnd}>...</DndContext>;
}
```

### 9.3 API Routes (Mutations)

```typescript
// Pattern: Next.js App Router route handlers for mutations
// app/api/kanban/cards/route.ts
export async function POST(request: Request) {
  const body = await request.json();
  const card = await db.insert(kanbanCards).values(body).returning();
  return Response.json(card);
}

// For direct DB access from Server Components, no API route needed
// API routes only for client-side mutations
```

### 9.4 Error Handling

```
Server Component:
  try/catch → return EmptyState or ErrorState with retry
  Never throw to the user

Client Component:
  try/catch → toast.error + UI state update
  Optimistic update with rollback

API Route:
  try/catch → JSON error response with status code
  Log error to console (future: structured logging)
```

---

## 10. Implementation Order

### Phase 1: Foundation (Week 1-2)
1. Design system: CSS variables, dark-first theme, typography, spacing
2. Layout: Responsive sidebar, mobile nav, main content area
3. Components: Card, Badge, Skeleton, StatCard, EmptyState, ProgressBar
4. Keyboard shortcuts: Cmd+K command palette, / search focus
5. Shared utilities: cn(), formatDate, formatCurrency, status helpers
6. Navigation: Full sidebar with all sections and routes

### Phase 2: LifeOS Core (Week 2-3)
7. Daily Briefing: Upgrade home page with real data, Suspense boundaries
8. Temporal pages: Years, Quarters, Months, Weeks (list + detail)
9. Goals dashboard: Annual + quarterly goals with progress
10. Days detail: Health metrics, activities, journals

### Phase 3: Projects & Tasks (Week 3-4)
11. Projects list: TanStack Table, health integration, search/filter
12. Project detail: Tabbed interface with monitor, progress, budget
13. Tasks page: Task table with sprint grouping
14. People directory: Card grid, detail page, project associations

### Phase 4: Financial Dashboard (Week 4-5)
15. Financial overview: Area charts, stat cards, category breakdown
16. Transactions: Full ledger table with advanced filtering
17. Accounts: Account cards, balance trends, transaction history
18. Charts integration: Recharts for all financial visualizations

### Phase 5: Operations Suite (Week 5-7)
19. Kanban board: Drag-and-drop with @dnd-kit, optimistic updates
20. Messaging: Thread list, message view, compose
21. Board meetings: Meeting list, detail with turns and responses
22. Agent sessions: Session list, message timeline, tool calls
23. Ops reports: Reports list, detail, tool correlations

### Phase 6: Content, Journals & Settings (Week 7-8)
24. Campaigns: Card grid, calendar view, detail
25. Content pipeline: Table with sorting/filtering
26. Unified calendar: Month/week/day view with multi-domain events
27. Journals: 4 journal pages with search and navigation
28. Settings: Database status, appearance, data management

### Phase 7: Polish & Performance (Week 8)
29. Loading states: Suspense boundaries on all pages
30. Error boundaries: Graceful error handling everywhere
31. Performance: Bundle splitting, virtualization, font optimization
32. Accessibility: Full keyboard navigation, aria labels, focus management
33. Testing: Visual regression, E2E smoke tests

---

## 11. Routing Map

```
/                           Daily Briefing (home)
/monitor                    Project Monitor
/years                      Years list
/years/[id]                 Year detail
/quarters                   Quarters list
/quarters/[id]              Quarter detail
/months                     Months list
/months/[id]                Month detail
/weeks                      Weeks list
/weeks/[id]                 Week detail
/days                       Days list
/days/[id]                  Day detail
/goals                      Goals dashboard
/projects                   Projects list
/projects/[id]              Project detail (7 tabs)
/tasks                      Tasks list
/people                     People directory
/people/[id]                Person detail
/kanban                     Kanban board (drag-and-drop)
/financial                  Financial dashboard
/financial/transactions     Transactions ledger
/financial/accounts         Accounts
/financial/accounts/[id]    Account detail
/campaigns                  Campaigns list
/campaigns/[id]             Campaign detail
/content                    Content pipeline
/calendar                   Unified calendar
/journals/subjective        Subjective journal
/journals/relational        Relational journal
/journals/systemic          Systemic journal
/journals/diet              Diet log
/journals/[type]/[id]       Journal entry detail
/meetings                   Board meetings list
/meetings/[id]              Meeting detail
/messages                   Messages center
/sessions                   Agent sessions list
/sessions/[id]              Session detail
/ops-reports                Operational reports
/ops-reports/[id]           Report detail
/settings                   Settings
```

**Total: 40+ routes**

---

## 12. Dependencies (New Packages)

```json
{
  "dependencies": {
    "@tanstack/react-table": "^8.x",
    "@tanstack/react-virtual": "^3.x",
    "@dnd-kit/core": "^6.x",
    "@dnd-kit/sortable": "^8.x",
    "recharts": "^2.x",
    "sonner": "^1.x",
    "clsx": "^2.x",
    "tailwind-merge": "^2.x"
  },
  "devDependencies": {}
}
```

All packages are well-maintained, have TypeScript types, and are compatible with Next.js 15 App Router.

---

## 13. Migration from Current Scaffold

| Current State | Target State | Action |
|---|---|---|
| Light mode default | Dark-first | Rewrite `globals.css` with dark tokens |
| Geist fonts | Fira Code + Fira Sans | Update `layout.tsx` font imports |
| Fixed sidebar | Collapsible + mobile drawer | Rewrite `sidebar.tsx`, add `sidebar-mobile.tsx` |
| 8 placeholder pages | 40+ functional routes | Create page files per routing map |
| Native HTML tables | TanStack Table | Replace with `DataTable` component |
| No charts | Recharts integration | Create `ChartCard` wrapper, add charts per spec |
| Decorative search | Functional search | Wire to URL params + server-side filtering |
| `<a>` navigation | `<Link>` with prefetch | Replace all internal links |
| No loading states | Suspense + Skeleton | Add boundaries per page |
| Emoji health status | SVG + text badges | Replace `getHealthEmoji` with `Badge` component |

---

## 14. Success Criteria

1. **All 48 tables** have at least one dashboard page that displays their data
2. **All 5 PostgreSQL views** are rendered on the dashboard (daily_briefing, project_health, project_monitor, project_progress, quarterly_report)
3. **All 29 functions** are accessible via dashboard pages or chart data
4. **Zero TypeScript errors** across all dashboard files
5. **All pages load** with or without database connection (graceful fallback)
6. **Mobile responsive** — usable on 375px width
7. **Keyboard navigable** — all interactive elements reachable via Tab
8. **Dark mode default** — light mode available via preference
9. **Build passes** — `bun run build` succeeds in dashboard/
10. **Docker Compose** — `docker compose up` starts PostgreSQL + dashboard

---

## 15. Risk Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Circular schema imports in Drizzle | Build failure | Exclude drizzle/schema from dashboard TS check (already done via next.config.ts) |
| TanStack Table performance with 1000+ rows | Slow rendering | Enable virtualization, server-side pagination |
| @dnd-kit complexity | Development time | Start with basic drag-drop, add polish later |
| Recharts SSR compatibility | Hydration errors | Wrap charts in dynamic import with ssr: false |
| Too many routes for single spec | Scope creep | This spec covers ALL pages; implementation will be phased |
| PostgreSQL connection limits | Connection pool exhaustion | Use PgBouncer or limit pool max connections |
