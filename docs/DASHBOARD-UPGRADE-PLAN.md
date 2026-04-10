# Operant Dashboard — Read/Write Upgrade Plan

**Version**: v0.6.0 (from v0.5.0)
**Date**: 2026-04-11
**Scope**: Transform the read-only Operant dashboard into a full CRUD workspace with rich text editing, real-time updates, and agent-centric UI.

---

## 1. Executive Summary

The existing Operant dashboard (`dashboard/`) is a polished, read-only Next.js 16 application with 20+ routes, a complete design system, and Drizzle schemas for all 37 PostgreSQL tables. This upgrade adds:

1. **Full CRUD** — Create, edit, delete for all 24 entities via generic API routes
2. **Rich text editing** — BlockNote block editor for journals, meetings, goals, projects
3. **Data management** — TanStack React Query for caching, mutations, optimistic updates
4. **Form validation** — Zod schemas derived from Drizzle (stay in sync automatically)
5. **Real-time updates** — SSE with exponential backoff for live Kanban, messages, agent status

**Reuse ratio**: 60% existing code kept as-is, 20% modified, 20% new.

---

## 2. Architecture

### Current State
```
┌─────────────────────────────────────┐
│  Next.js 16 App Router (RSC-first)  │
│  ┌─────────────┐  ┌──────────────┐  │
│  │ 18 read-only│  │ 9 UI         │  │
│  │ server funcs│  │ components   │  │
│  └──────┬──────┘  └──────────────┘  │
│         │ Drizzle ORM + pg pool     │
│         ↓                           │
│  PostgreSQL (37 tables)             │
└─────────────────────────────────────┘
```

### Target State
```
┌─────────────────────────────────────────────────────────┐
│  Next.js 16 App Router (RSC + Client hybrid)            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ 18 read-only│  │ 9 UI         │  │ TanStack React │  │
│  │ server funcs│  │ components   │  │ Query provider │  │
│  │ (KEEP)      │  │ (KEEP)       │  │ (NEW)          │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
│         │                │                   │           │
│  ┌──────▼────────────────▼───────────────────▼────────┐  │
│  │  Generic CRUD API factory (4 route files)           │  │
│  │  + Zod validation (drizzle-zod)                     │  │
│  │  + BlockNote rich text editor                       │  │
│  │  + SSE real-time client                             │  │
│  └──────────────────────────┬─────────────────────────┘  │
│                             ↓                            │
│  PostgreSQL (37 tables) ← Drizzle ORM + pg pool         │
└─────────────────────────────────────────────────────────┘
```

---

## 3. New Dependencies

```bash
cd dashboard
npm install @tanstack/react-query drizzle-zod react-hook-form @hookform/resolvers \
            @blocknote/core @blocknote/react @blocknote/shadcn
```

| Package | Purpose | Size |
|---|---|---|
| `@tanstack/react-query@5` | Data fetching, caching, mutations, optimistic updates | 14 KB gzipped |
| `drizzle-zod` | Auto-generate Zod schemas from Drizzle table definitions | 2 KB |
| `react-hook-form@7` | Performant form state management (no re-renders) | 10 KB |
| `@hookform/resolvers` | Bridge Zod → react-hook-form | 1 KB |
| `@blocknote/core@0.47` | ProseMirror-based block editor engine | 64 KB gzipped |
| `@blocknote/react@0.47` | React hooks and block rendering | 366 KB gzipped |
| `@blocknote/shadcn@0.47` | Tailwind-compatible UI components | ~40 KB |

**Total added**: ~497 KB gzipped (loaded only on pages that use the editor — code-split via Next.js dynamic imports).

### License Notes
- All core BlockNote packages: **MPL-2.0** (safe for commercial/closed-source)
- BlockNote `xl-*` packages (PDF/DOCX export): **GPL-3.0** — do NOT install

---

## 4. Reuse Map

### KEEP AS-IS (zero changes)

| Path | Description |
|---|---|
| `components/ui/` (9 files) | Card, Badge, DataTable, StatCard, ProgressBar, Skeleton, EmptyState, ChartCard, Toaster |
| `components/sidebar.tsx` | Collapsible sidebar with 20+ nav routes |
| `components/mobile-sidebar.tsx` | Responsive mobile navigation |
| `app/globals.css` | Design system: 50+ CSS variables, dark-first theme |
| `drizzle/schema/lifeos/` (26 files) | All 26 LifeOS table schemas |
| `drizzle/schema/operations/` (5 files) | Kanban, messaging, meetings, sessions, reports |
| `drizzle/schema/relations/` (6 files) | Junction tables |
| `lib/db.ts` | Drizzle + pg pool connection |
| `lib/constants.ts` | STATUS_MAP, PAGINATION_SIZES, DATE_FORMATS |
| `lib/formatters.ts` | formatPercent, formatNumber, formatDate |
| `lib/utils.ts` | cn(), clamp() |
| `drizzle.config.ts` | Drizzle Kit configuration |

### MODIFY (minimal changes)

| Path | Change |
|---|---|
| `app/layout.tsx` | Wrap children in `<QueryClientProvider>` |
| `app/kanban/page.tsx` | Add delete card, column management |
| `app/goals/page.tsx` | Add create/edit buttons + modal |
| `app/calendar/page.tsx` | Add event create/edit modal |
| `app/messages/_components/messages-client.tsx` | Wire compose to Operant messaging API |
| `app/settings/page.tsx` | Add agent configuration forms, database management |
| `app/journals/[type]/page.tsx` | Add new entry button + BlockNote editor |
| `app/projects/page.tsx` | Add CRUD actions |
| `app/tasks/page.tsx` | Add CRUD actions |
| `app/people/page.tsx` | Add CRUD actions |
| `app/campaigns/page.tsx` | Add CRUD actions |
| `app/financial/transactions/page.tsx` | Add transaction create/edit |

### NEW FILES

| Path Pattern | Count | Purpose |
|---|---|---|
| `app/api/crud/[entity]/route.ts` | 1 | Generic GET list + POST create for all 24 entities |
| `app/api/crud/[entity]/[id]/route.ts` | 1 | Generic GET single + PATCH update + DELETE |
| `lib/zod/[entity].ts` | 24 | Zod schemas derived from Drizzle (insert/select/update) |
| `hooks/use-[entity].ts` | 24 | React Query hooks (list, single, create, update, delete) |
| `components/forms/` | ~8 | Form primitives: input, select, textarea, form wrapper |
| `components/rich-text/` | ~6 | BlockNote editor wrapper + custom domain blocks |
| `components/crud/` | ~4 | DataTable action column, delete confirm dialog, create modal |
| `lib/sse/client.ts` | 1 | SSE event source with exponential backoff |
| `lib/api-client.ts` | 1 | Typed fetch wrapper for CRUD API |

---

## 5. CRUD API Architecture

### Generic Route Factory

Instead of creating 48+ individual route files, a single pair of catch-all routes handles all entities:

**`app/api/crud/[...path]/route.ts`**

```
GET  /api/crud/goals                  → list goals
POST /api/crud/goals                  → create goal
GET  /api/crud/goals/{id}             → get single goal
PATCH /api/crud/goals/{id}            → update goal
DELETE /api/crud/goals/{id}           → delete goal
GET  /api/crud/tasks?status=active    → list with filters
```

### Entity Registry

```typescript
// lib/crud/entities.ts
import { annualGoals, quarterlyGoals } from '@/drizzle/schema/lifeos/goals';
import { tasks } from '@/drizzle/schema/lifeos/tasks';
// ... all 24 imports

export const entityRegistry = {
  'goals-annual': {
    table: annualGoals,
    idColumn: annualGoals.id,
    listFields: ['id', 'name', 'status', 'goalProgress', 'goalArchetype'],
    sortableFields: ['name', 'status', 'goalProgress', 'created_at'],
    filterableFields: ['status', 'goalArchetype'],
  },
  'goals-quarterly': { /* same pattern */ },
  tasks: { /* same pattern */ },
  // ... 24 entries
};
```

### Request Flow

```
Client → React Query mutation
  → POST /api/crud/goals
    → lib/crud/handler.ts: validate(req.body, insertSchema)
    → db.insert(entity.table).values(validated).returning()
    → JSON response: { data: [...], error: null }
  ← React Query: update cache, show toast
```

### Error Response Shape

```typescript
{
  data: null,
  error: {
    code: "VALIDATION_ERROR" | "NOT_FOUND" | "FOREIGN_KEY_VIOLATION" | "INTERNAL_ERROR",
    message: "Human-readable description",
    details?: Record<string, string[]>  // Zod field errors
  }
}
```

---

## 6. BlockNote Integration

### Where BlockNote is used

| Entity | Field | Content Type |
|---|---|---|
| Journals (all 4 types) | `content` | Full rich text — paragraphs, headings, lists, images |
| Meetings | `notes`, `agenda` | Structured notes with agenda items |
| Goals (annual) | `strategicApproach` | Strategic context, approach documentation |
| Projects | `description` | Project overview, scope, milestones |
| Campaigns | `brief` | Campaign brief with embedded references |

### Where BlockNote is NOT used

| Entity | Reason |
|---|---|
| Tasks | Structured fields only (title, assignee, status, due date) |
| People | Structured profile data |
| Financial transactions | Numeric + category fields |
| Kanban cards | Single-line descriptions (existing pattern) |

### Custom BlockNote Blocks

| Block Type | Purpose | Schema |
|---|---|---|
| `goal-ref` | Inline link to a goal | `{ goalId, type: "annual" | "quarterly" }` |
| `task-ref` | Inline task reference | `{ taskId }` |
| `person-ref` | @mention person with avatar | `{ personId }` |
| `project-ref` | Project reference card | `{ projectId }` |
| `meeting-ref` | Link to a meeting record | `{ meetingId }` |

### Storage Pattern

```typescript
// On save:
const json = editor.document;  // BlockNote's native JSON format
await db.update(annualGoals)
  .set({ content: jsonb(json) })
  .where(eq(annualGoals.id, goalId));

// On load:
const goal = await db.select().from(annualGoals).where(eq(annualGoals.id, id));
const initialContent = goal.content;  // Already JSON, pass directly to BlockNote
```

### Server-Side Rendering

For static page views (e.g., goal detail without editor):
```typescript
import { BlockNoteEditor } from '@blocknote/core';
const editor = new BlockNoteEditor();
const html = await editor.blocksToFullHTML(content);
// Render HTML in Server Component, no JS needed
```

### Component

```tsx
// components/rich-text/editor.tsx
'use client';

import { BlockNoteView } from '@blocknote/shadcn';
import { useCreateBlockNote } from '@blocknote/react';
import { useCallback, useMemo } from 'react';
import debounce from 'lodash/debounce';

interface RichTextEditorProps {
  initialContent?: any[];
  onChange: (content: any[]) => void;
  placeholder?: string;
  readOnly?: boolean;
  customBlocks?: Record<string, any>;
}

export function RichTextEditor({ initialContent, onChange, placeholder, readOnly, customBlocks }: RichTextEditorProps) {
  const editor = useCreateBlockNote({
    initialContent,
    editable: !readOnly,
    // customBlocks registration here
  });

  const debouncedSave = useMemo(
    () => debounce(() => onChange(editor.document), 500),
    [editor, onChange]
  );

  return (
    <BlockNoteView
      editor={editor}
      onChange={debouncedSave}
      placeholder={placeholder}
      theme="light"  // or detect from CSS variable
      className="min-h-[300px]"
    />
  );
}
```

---

## 7. TanStack React Query Integration

### Provider Setup

```tsx
// app/layout.tsx (modification)
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,           // Consider fresh for 30s
          refetchOnWindowFocus: false, // Don't refetch on tab switch
          retry: 1,                     // Retry failed requests once
        },
        mutations: {
          retry: 1,
        },
      },
    })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

### Hook Pattern (per entity)

```typescript
// hooks/use-goals.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useGoals(filters?: { status?: string; archetype?: string }) {
  return useQuery({
    queryKey: ['goals', filters],
    queryFn: () => api.get('/api/crud/goals', filters),
    staleTime: 30_000,
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post('/api/crud/goals', data),
    onMutate: async (newGoal) => {
      await qc.cancelQueries({ queryKey: ['goals'] });
      const previous = qc.getQueryData(['goals']);
      qc.setQueryData(['goals'], (old: any[]) => [...old, { ...newGoal, id: 'temp' }]);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      qc.setQueryData(['goals'], context?.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export function useDeleteGoal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/api/crud/goals/${id}`),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['goals'] });
      const previous = qc.getQueryData(['goals']);
      qc.setQueryData(['goals'], (old: any[]) => old.filter((g) => g.id !== id));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      qc.setQueryData(['goals'], context?.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}
```

### Borrowed from openclaw-mission-control

- Optimistic delete with rollback on failure
- URL-state sorting (sortable columns persisted in query params)
- Background refetch with stale-while-revalidate semantics
- Loading states derived from `isPending` + `isFetching` flags

---

## 8. Zod Validation Layer

### Schema Generation

```typescript
// lib/zod/goals.ts
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { annualGoals } from '@/drizzle/schema/lifeos/goals';

export const insertGoalSchema = createInsertSchema(annualGoals, {
  name: (s) => s.min(1, 'Name is required').max(200),
  status: (s) => s.default('active'),
  goalProgress: (s) => s.min(0).max(100).default(0),
});

export const selectGoalSchema = createSelectSchema(annualGoals);
export const updateGoalSchema = createUpdateSchema(annualGoals);

export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type SelectGoal = z.infer<typeof selectGoalSchema>;
export type UpdateGoal = z.infer<typeof updateGoalSchema>;
```

### Why drizzle-zod

- Schemas stay in sync with Drizzle table definitions automatically
- When a column is added/removed/renamed in Drizzle, Zod updates on next build
- No duplicate type definitions
- Can add custom validations on top (min length, regex, etc.)

### Form Integration

```tsx
// components/forms/goal-form.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { insertGoalSchema, type InsertGoal } from '@/lib/zod/goals';

export function GoalForm({ initial, onSubmit }: { initial?: Partial<InsertGoal>; onSubmit: (data: InsertGoal) => void }) {
  const form = useForm<InsertGoal>({
    resolver: zodResolver(insertGoalSchema),
    defaultValues: {
      name: initial?.name ?? '',
      status: initial?.status ?? 'active',
      goalProgress: initial?.goalProgress ?? 0,
      goalArchetype: initial?.goalArchetype ?? '',
      strategicApproach: initial?.strategicApproach ?? '',
    },
  });

  const { register, handleSubmit, formState: { errors } } = form;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text-secondary">Name</label>
        <input {...register('name')} className="w-full px-3 py-2 rounded border border-border-default bg-surface text-text-primary" />
        {errors.name && <p className="text-xs text-status-critical mt-1">{errors.name.message}</p>}
      </div>
      {/* ... more fields */}
      <RichTextEditor
        initialContent={initial?.content}
        onChange={(content) => form.setValue('content', content as any)}
        placeholder="Strategic approach..."
      />
      <button type="submit" className="px-4 py-2 bg-accent text-white rounded">
        {initial ? 'Update' : 'Create'} Goal
      </button>
    </form>
  );
}
```

---

## 9. SSE Real-Time Integration

### Client

```typescript
// lib/sse/client.ts
import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useSSE(url: string, queryKeys: string[][]) {
  const queryClient = useQueryClient();
  const reconnectRef = useRef(true);
  const backoffRef = useRef(1000);

  const connect = useCallback(() => {
    const es = new EventSource(url);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      // Invalidate relevant query caches
      queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      backoffRef.current = 1000; // Reset backoff on success
    };

    es.onerror = () => {
      es.close();
      if (reconnectRef.current) {
        setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, 30000);
      }
    };

    return es;
  }, [url, queryKeys, queryClient]);

  useEffect(() => {
    const es = connect();
    return () => {
      reconnectRef.current = false;
      es.close();
    };
  }, [connect]);
}
```

### Usage

```tsx
// In Kanban page
useSSE('/api/sse/kanban', [['kanban']]);
// In Messages page
useSSE('/api/sse/messages', [['messages', threadId]]);
// In Dashboard
useSSE('/api/sse/agent-status', [['agents']]);
```

### Server Endpoint (added to Operant server)

The Operant MCP server (`src/mcp/server.ts`) needs SSE endpoints:

```typescript
// src/mcp/sse.ts
import { Router } from 'express';

const sseRouter = Router();

const clients = new Map<string, Response[]>();

function broadcast(event: string, data: any, scope: string) {
  const subs = clients.get(scope) || [];
  subs.forEach((res) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

sseRouter.get('/:scope', (req, res) => {
  const scope = req.params.scope;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Keep-alive ping
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);

  if (!clients.has(scope)) clients.set(scope, []);
  clients.get(scope)!.push(res);

  req.on('close', () => {
    clearInterval(ping);
    const subs = clients.get(scope) || [];
    clients.set(scope, subs.filter((r) => r !== res));
  });
});

// Called by CRUD handlers to broadcast changes
export { broadcast, sseRouter };
```

---

## 10. Per-Entity CRUD Enhancement Plan

### Phase 2: Goals + Journals + Meetings

#### Goals (`app/goals/page.tsx`)
- Add "+ New Goal" button → modal with `GoalForm`
- Annual goals table: add Edit (pencil icon) + Delete (trash icon) action column
- Quarterly goals table: same actions
- Annual goal detail page (`/goals/annual/[id]`): BlockNote editor for strategic approach
- Quarterly goal detail page (`/goals/quarterly/[id]`): BlockNote for key results notes

#### Journals (`app/journals/[type]/page.tsx`)
- Add "+ New Entry" button → page with full BlockNote editor
- Fields: title, date, mood selector (emoji), tags, BlockNote content
- Existing entries: click to edit in-place with BlockNote
- Delete: confirmation dialog with undo toast

#### Meetings (`app/meetings/page.tsx`)
- Create modal: title, date/time, attendees (multi-select from people), BlockNote agenda
- Meeting detail page (`/meetings/[id]`): BlockNote notes, decisions, action items
- Edit: inline BlockNote editor
- Delete: confirmation dialog

### Phase 3: Kanban + Tasks + Projects

#### Kanban (`app/kanban/`)
- Already has create + update. Add:
  - Delete card button (trash icon on card hover)
  - Column management: add/rename/delete columns via header menu
  - Drag column headers to reorder columns
  - Card modal: upgrade description to mini BlockNote editor

#### Tasks (`app/tasks/page.tsx`)
- Add create modal: title, assignee (people select), priority, due date, status
- DataTable action column: Edit modal, Delete confirmation
- Status change: inline dropdown (To Do → In Progress → Done → Blocked)

#### Projects (`app/projects/page.tsx`)
- Create/Edit page with: name, status, start/end dates, team members, BlockNote description
- DataTable with action column
- Project detail page (`/projects/[id]`): full view with BlockNote, linked tasks, team

### Phase 4: People + Campaigns + Financial

#### People (`app/people/page.tsx`)
- Create/Edit form: name, role, relationship type, contact info, BlockNote bio
- DataTable with search, filter by role/relationship
- Person detail page (`/people/[id]`): profile, linked projects/tasks/meetings, message history

#### Campaigns (`app/campaigns/page.tsx`)
- Full CRUD with: name, status, timeline, budget, BlockNote brief
- Content pipeline integration (existing `content_pipeline` table)
- Campaign detail page with performance metrics

#### Financial (`app/financial/transactions/page.tsx`)
- Transaction create/edit: amount, category, date, description, account
- Accounts management: create/edit/delete accounts
- Bulk import: CSV upload for transactions

### Phase 5: Calendar + Messages + Real-Time

#### Calendar (`app/calendar/page.tsx`)
- Click empty time slot → create event modal
- Click existing event → edit modal
- Event form: title, date/time range, type (color), BlockNote description, attendees
- Drag to reschedule (DnD Kit)

#### Messages (`app/messages/`)
- Wire `handleComposeSend` to Operant async messaging API
- Reply functionality
- Mark thread as read
- Delete thread
- Search within thread

#### Settings (`app/settings/page.tsx`)
- Agent configuration: autonomy level, heartbeat interval, model selection
- Database management: backup trigger, data export (JSON/CSV)
- Appearance: theme toggle (already partially there)
- Data: import from Notion (link to existing migration script)

---

## 11. install.sh Updates

### Development Mode

```bash
# In install.sh, add DEV_MODE detection
DEV_MODE="${DEV_MODE:-false}"

create_dashboard_systemd_service() {
    if [ "$DEV_MODE" = "true" ]; then
        ExecStart=/usr/bin/npx next dev -p $DASHBOARD_PORT --turbo
        Environment=NODE_ENV=development
        Environment=NEXT_TELEMETRY_DISABLED=1
    else
        ExecStart=/usr/bin/node $DEV_DIR/dashboard/node_modules/next/dist/bin/next start -p $DASHBOARD_PORT
        Environment=NODE_ENV=production
    fi
}
```

### Dashboard Dependency Install

```bash
install_dashboard() {
    cd "$DEV_DIR/dashboard"
    su - "$DEV_USER" -c "cd $DEV_DIR/dashboard && npm install"  # includes new deps
    su - "$DEV_USER" -c "cd $DEV_DIR/dashboard && npm run build"
}
```

### Dev Server Auto-Restart

- `Restart=always` + `RestartSec=5` in systemd unit — handles process crashes
- `next dev --turbo` has built-in HMR — file changes trigger instant reload
- No additional restart logic needed

---

## 12. Database Changes

### New Columns

| Table | Column | Type | Purpose |
|---|---|---|---|
| `annual_goals` | `content` | JSONB | BlockNote document for strategic approach |
| `quarterly_goals` | `content` | JSONB | BlockNote document for key results notes |
| `projects` | `content` | JSONB | BlockNote project description |
| `meetings` | `agenda` | JSONB | BlockNote agenda items |
| `meetings` | `notes` | JSONB | BlockNote meeting notes |
| `journal_subjective` | `content` | JSONB | BlockNote journal entry (replaces plain text) |
| `journal_relational` | `content` | JSONB | Same |
| `journal_systemic` | `content` | JSONB | Same |
| `journal_diet` | `content` | JSONB | Same |
| `campaigns` | `brief` | JSONB | BlockNote campaign brief |

### Migration

```typescript
// drizzle/migrations/00XX_add_blocknote_content.sql
ALTER TABLE annual_goals ADD COLUMN IF NOT EXISTS content JSONB;
ALTER TABLE quarterly_goals ADD COLUMN IF NOT EXISTS content JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS content JSONB;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS agenda JSONB;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS notes JSONB;
ALTER TABLE journal_subjective ADD COLUMN IF NOT EXISTS content JSONB;
ALTER TABLE journal_relational ADD COLUMN IF NOT EXISTS content JSONB;
ALTER TABLE journal_systemic ADD COLUMN IF NOT EXISTS content JSONB;
ALTER TABLE journal_diet ADD COLUMN IF NOT EXISTS content JSONB;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS brief JSONB;
```

Run via:
```bash
cd dashboard
npx drizzle-kit generate
npx drizzle-kit push
```

---

## 13. Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| BlockNote bundle size bloat | Medium | Lazy-load via `next/dynamic`, only on editor routes |
| Drizzle-zod schema drift | Low | CI check: `npx drizzle-kit generate --strict` |
| SSE connection leaks | Medium | Proper cleanup in `useEffect`, max connection limits server-side |
| Optimistic mutation inconsistency | Medium | Always invalidate cache on `onSettled`, rollback on error |
| Generic CRUD route too generic | Low | Entity registry with explicit field lists prevents over-fetching |
| PostgreSQL JSONB query performance | Low | Add GIN indexes on content columns if full-text search needed |
| Form validation gaps | Low | drizzle-zod derives from Drizzle — stays in sync |

---

## 14. Effort Estimate

| Phase | Tasks | Effort |
|---|---|---|
| **Phase 1: Infrastructure** | React Query provider, Zod schemas, CRUD API factory, form primitives | 2-3 days |
| **Phase 2: Goals + Journals + Meetings** | BlockNote integration, create/edit UI for 3 domains | 3-4 days |
| **Phase 3: Kanban + Tasks + Projects** | Complete Kanban CRUD, task/project CRUD | 2-3 days |
| **Phase 4: People + Campaigns + Financial** | Relationship management, campaign CRUD, transaction CRUD | 3-4 days |
| **Phase 5: Polish + Real-Time** | Calendar CRUD, messages completion, SSE, settings forms | 2-3 days |
| **Total** | | **12-17 days** |

---

## 15. Success Criteria

| Criterion | Measurement |
|---|---|
| All 24 entities have create, read, update, delete | Manual test per entity |
| BlockNote editor works for journals, meetings, goals | Rich text, custom blocks, JSON persistence |
| Zod validation catches invalid input | Test form submission with bad data |
| Optimistic mutations show instant UI feedback | Create/delete shows immediately, rolls back on error |
| SSE updates propagate within 1 second | Create card in Kanban → appears in other tab < 1s |
| install.sh completes with zero errors | `sudo ./install.sh` exits 0 |
| Dashboard accessible at `https://dashboard.ishanparihar.com` | 200 response, all pages render |
| No TypeScript errors | `npx tsc --noEmit` clean |
| No LSP errors on changed files | `lsp_diagnostics` clean |

---

## 16. What This Does NOT Cover

| Out of Scope | Reason |
|---|---|
| Authentication / RBAC | Separate concern; dashboard is currently unauthenticated |
| Mobile-responsive redesign | Existing responsive layout is adequate; refine later |
| Multi-language / i18n | Not needed for single-user deployment |
| Offline support / PWA | Nice-to-have, not critical for CRUD |
| PDF/DOCX export | BlockNote xl-* packages are GPL-3.0; use browser print instead |
| Vector search on BlockNote content | Future: embed JSON content for semantic search |
| Agent self-modification UI | Agents configure themselves via Telegram/WS; dashboard is human-facing |
