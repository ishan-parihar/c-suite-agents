# Operant Revenue OS — Implementation Blueprint

**Version:** 1.0
**Date:** April 11, 2026
**Status:** Ready for Execution
**Author:** Ishan Parihar + Sisyphus

---

## 0. Executive Summary

You have **Operant** (AI C-Suite orchestrator), **TradeBridge** (MT5 trading infrastructure), **OpenScript** (AI video pipeline), and **5+ MCP servers**. You have $0 revenue.

This document specifies the Revenue OS — the system that transforms Operant from a personal assistant into a **revenue-generating business operating system**. It adds CRM, pipeline management, invoicing, financial tracking, and content agency operations to the CFO and CMO agents.

**The Rule:** Build only what directly generates or tracks revenue. Everything else is distraction.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        OPERANT REVENUE OS                        │
│                                                                  │
│  ┌─────────────────────┐    ┌──────────────────────────────┐     │
│  │   CFO-Financial     │    │      CMO-Content             │     │
│  │   (Revenue Ops)     │    │   (Content Agency)           │     │
│  │                     │    │                              │     │
│  │  ┌───────────────┐  │    │  ┌────────────────────────┐  │     │
│  │  │ Revenue MCP   │  │    │  │ Copywriter-AI          │  │     │
│  │  │ Pipeline MCP  │  │    │  │ Video-Producer         │  │     │
│  │  │ Invoice MCP   │  │    │  │ Analytics-Lead         │  │     │
│  │  │ Expense MCP   │  │    │  │ Distribution-Manager   │  │     │
│  │  │ Financial MCP │  │    │  │ Creative-Director      │  │     │
│  │  └───────┬───────┘  │    │  └──────────┬─────────────┘  │     │
│  │          │           │    │             │                 │     │
│  │  ┌───────▼───────┐  │    │  ┌──────────▼─────────────┐  │     │
│  │  │ Revenue SQLite│  │    │  │ OpenScript MCP Bridge  │  │     │
│  │  │ (5 tables)    │  │    │  │ + Carousel-MCP         │  │     │
│  │  │               │  │    │  │ + Instagram-MCP        │  │     │
│  │  │ Kanban:       │  │    │  └────────────────────────┘  │     │
│  │  │ Pipeline      │  │    │                              │     │
│  │  │ Invoices      │  │    │  Kanban: Content Pipeline    │     │
│  │  └───────┬───────┘  │    └──────────────┬───────────────┘     │
│          ┌─┴────────────┴──────────────────┴──────────────┐      │
│          │          Operant MCP Server (42+ tools)         │      │
│          │          + 30 Revenue Tools (72 total)          │      │
│          └─┬────────────┬──────────────────┬───────────────┘      │
│            │            │                  │                       │
│     ┌──────▼──────┐ ┌──▼──────────┐ ┌────▼──────────────┐        │
│     │ TradeBridge │ │ OpenScript  │ │   MCP Suite       │        │
│     │ (Trading)   │ │ (Video)     │ │ (Gog/WA/IGS)      │        │
│     └─────────────┘ └─────────────┘ └───────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. CFO Revenue Operations — Full Specification

### 2.1 SQLite Schema

New file: `src/revenue/db.ts`

Five tables, ~200 lines of TypeScript:

```sql
-- 1. Revenue Streams (products/services that generate income)
CREATE TABLE IF NOT EXISTS revenue_streams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'productized', 'service', 'trading', 'content', 'consulting', 'other'
  )),
  pricing_model TEXT NOT NULL CHECK(pricing_model IN (
    'subscription', 'one-time', 'usage', 'project', 'retainer'
  )),
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK(status IN (
    'active', 'paused', 'testing', 'archived'
  )) DEFAULT 'testing',
  description TEXT,
  mrr REAL NOT NULL DEFAULT 0,
  arr REAL NOT NULL DEFAULT 0,
  total_revenue REAL NOT NULL DEFAULT 0,
  customer_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Pipeline Deals (leads → closed)
CREATE TABLE IF NOT EXISTS pipeline_deals (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL REFERENCES revenue_streams(id),
  client_name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  contact_company TEXT,
  stage TEXT NOT NULL CHECK(stage IN (
    'lead', 'qualified', 'proposal', 'negotiation',
    'closed-won', 'closed-lost', 'retained'
  )) DEFAULT 'lead',
  value REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  probability REAL NOT NULL DEFAULT 0.1,
  expected_close_date TEXT,
  source TEXT,
  notes TEXT,
  last_contact_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. Deal Activity Log
CREATE TABLE IF NOT EXISTS deal_activity (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES pipeline_deals(id),
  activity_type TEXT NOT NULL CHECK(activity_type IN (
    'call', 'email', 'meeting', 'proposal_sent',
    'follow_up', 'note', 'status_change'
  )),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  deal_id TEXT REFERENCES pipeline_deals(id),
  stream_id TEXT NOT NULL REFERENCES revenue_streams(id),
  invoice_number TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK(status IN (
    'draft', 'sent', 'partial', 'paid', 'overdue', 'written-off'
  )) DEFAULT 'draft',
  items TEXT NOT NULL,  -- JSON: [{description, quantity, unit_price}]
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at TEXT,
  paid_at TEXT,
  payment_method TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN (
    'infra', 'api', 'tools', 'contractors', 'marketing', 'office', 'other'
  )),
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  date TEXT NOT NULL,
  receipt_url TEXT,
  recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_interval TEXT CHECK(recurrence_interval IN (
    'daily', 'weekly', 'monthly', 'quarterly', 'yearly'
  )),
  stream_id TEXT REFERENCES revenue_streams(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Financial Snapshots (daily P&L capture)
CREATE TABLE IF NOT EXISTS financial_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL UNIQUE,
  total_revenue REAL NOT NULL DEFAULT 0,
  total_expenses REAL NOT NULL DEFAULT 0,
  net_profit REAL NOT NULL DEFAULT 0,
  mrr REAL NOT NULL DEFAULT 0,
  arr REAL NOT NULL DEFAULT 0,
  cash_balance REAL NOT NULL DEFAULT 0,
  runway_days INTEGER,
  pipeline_value REAL NOT NULL DEFAULT 0,
  weighted_pipeline_value REAL NOT NULL DEFAULT 0,
  deal_count INTEGER NOT NULL DEFAULT 0,
  invoice_count_paid INTEGER NOT NULL DEFAULT 0,
  invoice_count_overdue INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.2 MCP Tools (30 New Tools)

New file: `src/revenue/tools.ts`

#### Revenue Stream Tools (5)

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `revenue.stream.create` | Add new income stream | name, type, pricing_model, price, currency, description | Stream ID + confirmation |
| `revenue.stream.list` | List all streams with metrics | status filter (optional) | Array of streams with MRR/ARR |
| `revenue.stream.update` | Update stream details | stream_id, fields to update | Updated stream |
| `revenue.stream.delete` | Archive a stream | stream_id | Confirmation |
| `revenue.stream.metrics` | Get detailed metrics for one stream | stream_id, period | MRR, ARR, customers, growth |

#### Pipeline Tools (7)

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `pipeline.deal.create` | Add deal to pipeline | stream_id, client_name, value, contact info, stage | Deal ID |
| `pipeline.deal.move` | Move deal between stages | deal_id, new_stage | Confirmation + stage history |
| `pipeline.deal.list` | Filter deals | stage, stream_id, date range | Filtered deals |
| `pipeline.deal.get` | Get deal details with activity | deal_id | Full deal + activity log |
| `pipeline.deal.update` | Update deal fields | deal_id, fields | Updated deal |
| `pipeline.deal.forecast` | Weighted revenue forecast | days (30/60/90) | Forecast: optimistic/realistic/pessimistic |
| `pipeline.deal.activity` | Log interaction with deal | deal_id, type, description | Activity entry |

#### Invoice Tools (6)

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `invoice.create` | Generate invoice from deal | deal_id or stream_id, items, due_date | Invoice number + details |
| `invoice.send` | Mark invoice as sent | invoice_id, delivery_channel | Confirmation |
| `invoice.list` | Filter invoices | status, date range, client | Filtered invoices |
| `invoice.status` | Check payment status | invoice_id | Status + history |
| `invoice.mark_paid` | Record payment | invoice_id, amount, method, date | Updated invoice |
| `invoice.overdue_report` | List overdue invoices | days_overdue (optional) | Overdue list + total |

#### Expense Tools (5)

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `expense.track` | Log new expense | category, description, amount, date, stream_id | Expense ID |
| `expense.list` | Filter expenses | category, date range, recurring flag | Filtered expenses |
| `expense.report` | Category breakdown + totals | period (week/month/quarter) | Category totals + chart data |
| `expense.recurring` | List recurring expenses | — | Recurring expense list + monthly total |
| `expense.budget` | Budget vs actual | period, category (optional) | Budget utilization % |

#### Financial Dashboard Tools (4)

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `financial.dashboard` | Full P&L snapshot | — | Revenue, expenses, profit, MRR, runway |
| `financial.project` | Revenue projection | days (30/60/90) | Projected revenue by stream |
| `financial.pnl` | Profit & Loss statement | period | Full P&L with line items |
| `financial.health` | Financial health score | — | Score (0-100), alerts, recommendations |

#### Tool Registration (in `src/mcp/server.ts`)

Add to the `createSessionServer` factory function, following the existing pattern:

```typescript
// After existing tool imports, add:
import { createRevenueTools } from "../revenue/tools.js";

// Inside createSessionServer, after existing tool registrations:
const revenueTools = createRevenueTools(kanban, memoryFacade);
Object.assign(sessionToolImpls, revenueTools.impls);
for (const [name, tool] of Object.entries(revenueTools.definitions)) {
  sessionServer.tool(name, tool.schema, tool.handler);
}
```

### 2.3 CFO Kanban Board — Revenue Columns

Modify `src/staff/core-staff.ts`, line 48:

**Current:**
```typescript
kanbanColumns: ["To Log", "This Week", "Reconciling", "Budget Review", "Approved", "Forecasting", "Complete"],
```

**New (dual-board approach):**

The CFO gets TWO boards. The existing board stays for operational finance. A new "Revenue Pipeline" board is added:

```typescript
// Keep existing board columns
kanbanColumns: ["To Log", "This Week", "Reconciling", "Budget Review", "Approved", "Forecasting", "Complete"],

// Revenue Pipeline columns are registered separately during Revenue OS init
// Board name: "cfo-revenue-pipeline"
// Columns: ["Lead", "Qualified", "Proposal", "Negotiation", "Closed-Won", "Closed-Lost", "Retained"]
// Board name: "cfo-invoices"  
// Columns: ["Draft", "Sent", "Partial", "Paid", "Overdue", "Written-Off"]
```

Implementation: Add `ensureRevenueBoards()` in `src/revenue/db.ts` that creates these two additional boards for the CFO agent.

### 2.4 CFO Role Definition Update

Modify `src/staff/core-staff.ts`, lines 44-49:

**Current:**
```typescript
"cfo-financial": {
  id: "cfo-financial", name: "CFO", title: "CFO — Financial", avatar: "💰",
  boardSeat: true, reportsTo: "ceo-strategic",
  databases: ["financial_log", "weeks", "months", "projects"],
  kanbanColumns: ["To Log", "This Week", "Reconciling", "Budget Review", "Approved", "Forecasting", "Complete"],
  systemPrompt: "You're the CFO, the money person. Make finances clear and actionable. No jargon dumps. Explain what numbers MEAN for decisions. Be approachable - money talks can be stressful."
},
```

**New:**
```typescript
"cfo-financial": {
  id: "cfo-financial", name: "CFO", title: "CFO — Financial & Revenue", avatar: "💰",
  boardSeat: true, reportsTo: "ceo-strategic",
  databases: ["financial_log", "weeks", "months", "projects", "revenue_streams", "pipeline_deals", "invoices", "expenses"],
  kanbanColumns: ["To Log", "This Week", "Reconciling", "Budget Review", "Approved", "Forecasting", "Complete"],
  systemPrompt: "You're the CFO — you manage money AND revenue. Track income streams, manage the sales pipeline, generate invoices, monitor expenses, and produce financial reports. Make finances clear and actionable. No jargon dumps. Explain what numbers MEAN for decisions. Be approachable - money talks can be stressful. You have tools to create revenue streams, track deals in the pipeline, generate invoices, log expenses, and pull financial dashboards. Use them proactively — don't wait to be asked."
},
```

### 2.5 Revenue OS Initialization

New function in `src/revenue/db.ts`:

```typescript
export class RevenueDB {
  private db: Database.Database;

  private constructor(db: Database.Database) { this.db = db; }

  static async init(dbPath: string = "revenue.db"): Promise<RevenueDB> {
    // Initialize database, create all 6 tables
    // Return RevenueDB instance
  }

  async ensureRevenueBoards(kanban: Kanban): Promise<void> {
    // Create CFO revenue pipeline board
    await kanban.ensureBoard("cfo-financial", "CFO — Revenue Pipeline", [
      "Lead", "Qualified", "Proposal", "Negotiation",
      "Closed-Won", "Closed-Lost", "Retained"
    ]);
    // Create CFO invoices board
    await kanban.ensureBoard("cfo-financial", "CFO — Invoices", [
      "Draft", "Sent", "Partial", "Paid", "Overdue", "Written-Off"
    ]);
  }
}
```

Initialize in `src/mcp/server.ts` during `startOperant()`:

```typescript
// After kanban init, add:
import { RevenueDB } from "../revenue/db.js";
const revenueDB = await RevenueDB.init("revenue.db");
await revenueDB.ensureRevenueBoards(kanban);
```

---

## 3. CMO Content Agency — Full Specification

### 3.1 Five Auxiliary Agents

New entries in `src/staff/core-staff.ts` — added to `CORE_STAFF_ROLES`:

```typescript
// === CMO CONTENT AGENCY STAFF ===

"cmo-copywriter": {
  id: "cmo-copywriter", name: "Copywriter", title: "Copywriter — Scripts & Hooks", avatar: "✍️",
  boardSeat: false, reportsTo: "cmo-content",
  databases: ["content_pipeline", "campaigns"],
  kanbanColumns: ["Idea", "Research", "Draft", "Review", "Approved", "Scheduled"],
  systemPrompt: "You are a direct-response copywriter specializing in short-form video scripts. You write hooks that stop the scroll, scripts that retain viewers, and CTAs that convert. You understand platform-specific formats: Instagram Reels (7-30s), YouTube Shorts (15-60s), TikTok (15-90s). You write for the Indian market in Hinglish, English, and Hindi. Your style: conversational, punchy, no fluff. Every script has: (1) a pattern-interrupt hook in the first 3 seconds, (2) a clear value delivery in the body, (3) a specific CTA at the end. You receive briefs from the CMO and deliver scripts ready for production."
},

"cmo-video-producer": {
  id: "cmo-video-producer", name: "Video Producer", title: "Video Producer — OpenScript Operations", avatar: "🎬",
  boardSeat: false, reportsTo: "cmo-content",
  databases: ["content_pipeline", "campaigns", "projects"],
  kanbanColumns: ["Raw Footage", "Transcription", "Timeline", "Review", "Render", "Published"],
  systemPrompt: "You are an AI video producer with access to the OpenScript editing pipeline — a 44-tool MCP-powered video production system. Your job: take scripts from the Copywriter, combine with raw footage, and produce polished 9:16 short-form videos. You use OpenScript's reelize.timeline() for one-call production or reelize.brief() + reelize.direct() for AI-directed editing. You manage b-roll selection, music assignment, SFX placement, caption burning, and FFmpeg rendering. You deliver production-ready MP4 files. Quality bar: every video must pass audio verification, caption sync check, and render fidelity test before delivery."
},

"cmo-analytics-lead": {
  id: "cmo-analytics-lead", name: "Analytics Lead", title: "Analytics Lead — Content Performance", avatar: "📊",
  boardSeat: false, reportsTo: "cmo-content",
  databases: ["content_pipeline", "campaigns"],
  kanbanColumns: ["Data Collection", "Analysis", "Insights", "Recommendations", "Actioned"],
  systemPrompt: "You are a content analytics specialist who transforms engagement data into strategy. You track: views, watch time, retention curves, engagement rate, follower growth, and conversion rate per piece of content. You identify top-performing formats, underperforming content, optimal posting times, and audience preferences. You produce weekly performance reports with actionable recommendations. You connect content performance to revenue — which videos drove leads, which drove sales. Data-driven, insight-focused, zero fluff."
},

"cmo-distribution-manager": {
  id: "cmo-distribution-manager", name: "Distribution Manager", title: "Distribution Manager — Multi-Platform Publishing", avatar: "📡",
  boardSeat: false, reportsTo: "cmo-content",
  databases: ["content_pipeline", "campaigns"],
  kanbanColumns: ["Ready", "Scheduled", "Published", "Monitoring", "Optimizing"],
  systemPrompt: "You manage the distribution of content across all platforms. You optimize posting times based on audience activity data, adapt content formats per platform (9:16 for Reels/Shorts, 1:1 for feed, 16:9 for YouTube), write platform-specific captions and hashtags, schedule content for maximum reach, and monitor post-publish performance to optimize future distribution. You use Instagram-MCP for Instagram publishing, Telegram-MCP for Telegram distribution, and Carousel-MCP for carousel content. You ensure no published content goes unmonitored."
},

"cmo-creative-director": {
  id: "cmo-creative-director", name: "Creative Director", title: "Creative Director — Brand & Quality", avatar: "🎨",
  boardSeat: false, reportsTo: "cmo-content",
  databases: ["content_pipeline", "campaigns"],
  kanbanColumns: ["Brief", "Concept", "Production", "QA", "Approved", "Archive"],
  systemPrompt: "You ensure all content adheres to brand guidelines while pushing creative boundaries. You define and maintain visual identity (colors, fonts, styles), review all content before publication for quality and brand consistency, approve or reject creative work with specific feedback, maintain a swipe file of high-performing content for inspiration, and ensure the content strategy aligns with the CEO's vision and the CMO's campaign goals. You are the final quality gate before anything goes public."
},
```

### 3.2 CMO Board Columns Update

Modify line 55 in `src/staff/core-staff.ts`:

**Current:**
```typescript
kanbanColumns: ["Ideas", "Scheduled", "Writing", "Recording", "Editing", "Ready", "Published", "Performing"],
```

**New (dual-board for CMO too):**

```typescript
// Main CMO board (keep as-is)
kanbanColumns: ["Ideas", "Scheduled", "Writing", "Recording", "Editing", "Ready", "Published", "Performing"],
```

The auxiliary agents each get their own board (handled by `ensureBoard` during init).

### 3.3 OpenScript MCP Bridge

New file: `src/integrations/openscript.ts`

```typescript
import { spawn } from "child_process";
import { logger } from "../logger.js";

// OpenScript runs as a separate MCP server over stdio
// The Video Producer agent bridges to it via MCP client

export interface OpenScriptConfig {
  binaryPath: string;    // Path to openscript binary (cargo run -p openscript-mcp --bin mcp-server)
  enabled: boolean;
}

export class OpenScriptBridge {
  private config: OpenScriptConfig;

  constructor(config: OpenScriptConfig) {
    this.config = config;
  }

  // One-call pipeline: raw video → complete reel
  async reelizeTimeline(videoPath: string): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    if (!this.config.enabled) {
      return { success: false, error: "OpenScript integration not enabled" };
    }
    // Execute: cargo run -p openscript-cli -- reelize <videoPath>
    // Return output path or error
  }

  // AI Director mode: brief then direct
  async reelizeBrief(videoPath: string): Promise<any> {
    // Returns structured brief with segments, timing, b-roll concepts
  }

  async reelizeDirect(videoPath: string, brief: any): Promise<{ success: boolean; outputPath?: string }> {
    // Executes creative direction from brief
  }

  health(): Promise<{ status: string; error?: string }> {
    // Check if OpenScript binary is available
  }
}
```

Configuration in `config.example.json`:
```json
{
  "integrations": {
    "openscript": {
      "binaryPath": "/home/ishanp/Documents/GitHub/openscript/target/release/openscript-mcp",
      "enabled": true
    }
  }
}
```

### 3.4 CMO Cron Tasks

Add to `src/scheduler/`:

| Task | Schedule | Description |
|------|----------|-------------|
| `cmo-daily-content-check` | Daily 9 AM | Check content pipeline status, flag bottlenecks |
| `cmo-weekly-analytics` | Monday 10 AM | Generate weekly content performance report |
| `cmo-publishing-queue` | Daily 6 PM | Review tomorrow's scheduled content |

---

## 4. TradeBridge Integration

### 4.1 P&L Reporting

New file: `src/integrations/tradebridge.ts`

```typescript
export interface TradeBridgeConfig {
  baseUrl: string;       // http://127.0.0.1:8020
  enabled: boolean;
}

export class TradeBridgeClient {
  private config: TradeBridgeConfig;

  constructor(config: TradeBridgeConfig) {
    this.config = config;
  }

  // Get current positions and P&L
  async getDailyPnL(): Promise<{
    totalPnL: number;
    openPositions: number;
    closedTrades: Array<{symbol: string, pnl: number, duration: string}>;
  }> {
    // Call TradeBridge gateway: GET /bridge/account/positions
    // Call TradeBridge gateway: GET /bridge/account/pnl
  }

  health(): Promise<{ status: string; error?: string }> {
    // GET /bridge/health
  }
}
```

The CFO agent calls this daily via cron task `cfo-daily-trading-pnl` and records the result in `financial_snapshots`.

### 4.2 Trading as Revenue Stream

Register "Algorithmic Trading" as a revenue stream in Operant:
- Type: `trading`
- Pricing model: `usage` (P&L-based)
- Status: `testing` (until AlphaForge validated)
- CFO tracks daily P&L automatically

---

## 5. MCP Suite Integration

### 5.1 Integration Map

| MCP Server | Used By | Purpose |
|-----------|---------|---------|
| **wacli-mcp** (28 tools) | CFO (invoice delivery), CMO (client outreach) | WhatsApp invoicing and client communication |
| **gog-cli-mcp** (53 tools) | CFO (calendar for meetings), CEO (email ops) | Google Workspace operations |
| **IGS** (223 RSS sources) | CIO (intelligence), CMO (trend research) | Market intelligence and content research |
| **carousel-mcp** | CMO Distribution Manager | Carousel content creation and publishing |
| **instagram-mcp-server** | CMO Distribution Manager | Instagram publishing and analytics |

### 5.2 MCP Bridge Configuration

Add to Operant's MCP bridge (`src/mcp/bridge.ts`):

```json
{
  "mcpServers": {
    "wacli": { "command": "node", "args": ["/home/ishanp/Documents/GitHub/wacli-mcp/dist/index.js"] },
    "gog": { "command": "node", "args": ["/home/ishanp/Documents/GitHub/gog-cli-mcp/dist/index.js"] },
    "igs": { "command": "node", "args": ["/home/ishanp/Documents/GitHub/IGS/dist/index.js"] },
    "carousel": { "command": "python", "args": ["-m", "carousel_mcp"] },
    "openscript": { "command": "cargo", "args": ["run", "-p", "openscript-mcp", "--bin", "mcp-server"] }
  }
}
```

---

## 6. Implementation Phases

### Phase 1: Revenue Foundation (Days 1-3) — IMMEDIATE

**Goal:** CFO can track revenue streams, deals, and expenses via Telegram.

| Task | Files Changed | Effort |
|------|--------------|--------|
| 1. Create `src/revenue/db.ts` with 6-table schema | New file | 200 LOC |
| 2. Implement 10 core MCP tools (stream create/list, deal create/move/list, expense track/list, financial dashboard, invoice create) | `src/revenue/tools.ts` | 800 LOC |
| 3. Register revenue tools in MCP server | `src/mcp/server.ts` | 20 LOC |
| 4. Update CFO role definition | `src/staff/core-staff.ts` | 10 LOC |
| 5. Create CFO revenue pipeline Kanban board | `src/revenue/db.ts` (ensureRevenueBoards) | 30 LOC |
| 6. Initialize RevenueDB in startOperant() | `src/mcp/server.ts` | 5 LOC |
| 7. Add `operant revenue` CLI command | `src/cli/revenue.ts` | 150 LOC |
| 8. Update config.example.json with revenue section | `config.example.json` | 15 LOC |

**Total: ~1,230 LOC, 3 days**

### Phase 2: CMO Content Agency (Days 4-7)

**Goal:** CMO can manage content production through 5 specialized agents.

| Task | Files Changed | Effort |
|------|--------------|--------|
| 9. Add 5 auxiliary agent definitions | `src/staff/core-staff.ts` | 80 LOC |
| 10. Ensure Kanban boards for all 5 agents | `src/mcp/server.ts` (init) | 15 LOC |
| 11. Create `src/integrations/openscript.ts` bridge | New file | 150 LOC |
| 12. Configure MCP bridge for OpenScript | `src/mcp/bridge.ts` | 20 LOC |
| 13. Update CMO role definition with agency management | `src/staff/core-staff.ts` | 15 LOC |
| 14. Add CMO cron tasks (daily check, weekly analytics) | `src/scheduler/` | 100 LOC |
| 15. Create content pipeline Kanban for Video Producer | Auto via ensureBoard | 0 LOC |

**Total: ~380 LOC, 4 days**

### Phase 3: Advanced Revenue Ops (Days 8-14)

**Goal:** Full invoicing, forecasting, expense budgeting, TradeBridge P&L.

| Task | Files Changed | Effort |
|------|--------------|--------|
| 16. Implement remaining 20 MCP tools (invoice send/status/mark_paid/overdue_report, expense report/recurring/budget, financial project/pnl/health, pipeline forecast/activity, stream update/delete/metrics) | `src/revenue/tools.ts` | 1,200 LOC |
| 17. Create `src/integrations/tradebridge.ts` | New file | 100 LOC |
| 18. Add CFO daily trading P&L cron task | `src/scheduler/` | 50 LOC |
| 19. Invoice template system | `src/revenue/templates/` | 200 LOC |
| 20. Financial snapshot cron (daily auto-capture) | `src/scheduler/` | 80 LOC |

**Total: ~1,630 LOC, 7 days**

### Phase 4: Scale & Automate (Days 15-21)

**Goal:** Automated reporting, multi-platform distribution, pipeline forecasting.

| Task | Files Changed | Effort |
|------|--------------|--------|
| 21. Automated daily/weekly/monthly reports to Telegram | `src/scheduler/` + `src/revenue/` | 300 LOC |
| 22. MCP bridge for wacli-mcp (WhatsApp invoice delivery) | `src/mcp/bridge.ts` | 50 LOC |
| 23. MCP bridge for IGS (content research for CMO) | `src/mcp/bridge.ts` | 30 LOC |
| 24. Carousel-MCP integration for Distribution Manager | `src/integrations/carousel.ts` | 100 LOC |
| 25. Revenue dashboard CLI command | `src/cli/revenue.ts` (extend) | 100 LOC |

**Total: ~580 LOC, 7 days**

---

## 7. Revenue Generation Playbook

### 7.1 Five Income Streams

| Stream | Product | Price | ICP | Distribution | Timeline |
|--------|---------|-------|-----|-------------|----------|
| **Operant** | AI C-Suite orchestrator | $99/mo or $499 self-hosted | Solopreneurs $5-50K/mo | Twitter, IndieHackers, PH | Week 2+ |
| **Content Agency** | AI-produced short-form video | ₹15-20K/mo per client | Local businesses, coaches, D2C | WhatsApp outreach, IG DMs | Week 1 |
| **TradeBridge** | MT5 MCP trading bridge | $99 one-time or $29/mo | Retail algo traders | r/algotrading, GitHub, Twitter | Week 3+ |
| **MCP Consulting** | Custom MCP server development | $500-2000/engagement | Companies wanting AI integrations | GitHub portfolio, LinkedIn | Week 1 |
| **Algorithmic Trading** | Automated trading (TradeBridge + AlphaForge) | P&L-based | Self (capital needed: $500+) | Internal | Month 2+ |

### 7.2 Week 1 Revenue Sprint

**Day 1-2: Setup**
- [ ] Register 3 revenue streams in Operant CFO:
  1. "Content Agency" — service, retainer, ₹15,000/mo, INR
  2. "MCP Consulting" — consulting, project, $1,000, USD
  3. "Operant Licenses" — productized, one-time, $99, USD
- [ ] Create 10 pipeline deals (3 content agency prospects, 4 consulting leads, 3 Operant prospects)
- [ ] Log existing expenses (API costs, infra, tools)

**Day 3-4: Content Production**
- [ ] Use OpenScript to produce 3 free sample reels for target clients
- [ ] CMO Copywriter writes personalized outreach messages
- [ ] CMO Video Producer produces samples via OpenScript

**Day 5-7: Outreach**
- [ ] Send samples + proposals via WhatsApp (wacli-mcp) to 10 prospects
- [ ] Log all outreach as deal activity in pipeline
- [ ] Track responses, move deals through stages
- [ ] Goal: Close 1 content client (₹15K/mo) + 1 consulting gig ($500)

**Week 1 Target: ₹15K + $500 = ~₹57K**

### 7.3 Month 1 Targets

| Metric | Target |
|--------|--------|
| Content clients | 3 (₹45K/mo) |
| Consulting deals | 2 ($1,000 = ₹83K) |
| Operant licenses | 5 ($495 = ₹41K) |
| **Total** | **₹169K/month** |

### 7.4 Month 3 Targets

| Metric | Target |
|--------|--------|
| Content clients | 8 (₹1.2L/mo) |
| Consulting deals | 3 ($1,500/mo = ₹1.25L) |
| Operant SaaS | 20 ($1,980/mo = ₹1.65L) |
| TradeBridge sales | 10 ($990 = ₹83K one-time) |
| Trading P&L | $500-1000/mo (₹42K-83K) |
| **Total** | **₹5.35L/month** |

---

## 8. File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/revenue/db.ts` | **NEW** | Revenue SQLite schema + CRUD operations (~200 LOC) |
| `src/revenue/tools.ts` | **NEW** | 30 MCP tool implementations (~2,000 LOC) |
| `src/revenue/templates/` | **NEW** | Invoice + proposal templates |
| `src/integrations/openscript.ts` | **NEW** | OpenScript MCP bridge (~150 LOC) |
| `src/integrations/tradebridge.ts` | **NEW** | TradeBridge HTTP client (~100 LOC) |
| `src/integrations/carousel.ts` | **NEW** | Carousel-MCP bridge (~100 LOC) |
| `src/staff/core-staff.ts` | **MODIFY** | Update CFO role, add 5 CMO auxiliary agents (~100 LOC added) |
| `src/mcp/server.ts` | **MODIFY** | Register revenue tools, init RevenueDB (~50 LOC added) |
| `src/mcp/bridge.ts` | **MODIFY** | Add MCP server configs for OpenScript, wacli, IGS, carousel (~30 LOC added) |
| `src/scheduler/` | **MODIFY** | Add 8 new cron tasks (~300 LOC added) |
| `src/cli/revenue.ts` | **NEW** | `operant revenue` and `operant pipeline` commands (~250 LOC) |
| `config.example.json` | **MODIFY** | Add revenue + integration configs (~20 LOC added) |

**Total: ~3,300 LOC across 12 files (6 new, 6 modified)**

---

## 9. Risk Assessment & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Over-engineering before revenue | HIGH | HIGH | Revenue gates: don't build Phase N until Phase N-1 generates income |
| LLM costs for 14 agents exceed revenue | MEDIUM | HIGH | Use Ollama for auxiliary agents, premium models only for CEO/CFO/CMO |
| OpenScript bridge complexity | MEDIUM | MEDIUM | Start with CLI child_process integration, upgrade to MCP bridge in Phase 3 |
| User distraction (60 projects, 0 revenue) | HIGH | CRITICAL | This document is the ONLY build plan. No new projects until Revenue OS generates ₹1L+/month |
| TradeBridge not running | LOW | LOW | Graceful degradation — CFO logs "no data" and retries next cycle |
| Client acquisition slower than expected | MEDIUM | HIGH | Free sample strategy lowers barrier. If 50 outreach → 0 closes, pivot pricing or ICP |

---

## 10. Decision Log

| Decision | Rationale |
|----------|-----------|
| SQLite for Revenue data (not Notion) | Speed, offline operation, matches Kanban pattern |
| Dual-board approach for CFO (operational + pipeline) | Separates day-to-day finance from revenue generation |
| 5 CMO auxiliary agents (not 3, not 8) | Covers full content lifecycle without over-complexity |
| Phase 1 = 10 MCP tools (not 30) | Ship fast, add rest as needed |
| Week 1 Revenue Sprint as first deliverable | Forces commercial action, not just building |
| Keep "Operant" name | Distinctive, defensible, premium positioning. "Operant — Your AI C-Suite." |
| Open-source 4 MCP servers | Marketing engine — GitHub stars → profile visits → Operant customers |

---

## 11. Next Action

**Implement Phase 1 (Days 1-3).** This adds:
- Revenue SQLite database with 6 tables
- 10 core MCP tools for the CFO
- Updated CFO role definition
- Revenue pipeline Kanban board
- `operant revenue` CLI command

After Phase 1, you can:
1. Register revenue streams via Telegram
2. Add deals to the pipeline
3. Track expenses
4. View financial dashboard
5. Start the Week 1 Revenue Sprint

**Shall I proceed with Phase 1 implementation?**
