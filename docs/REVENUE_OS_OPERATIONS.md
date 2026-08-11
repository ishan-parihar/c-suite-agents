# Operant Revenue OS — Automation-First Operations Manual

**Version:** 1.0
**Date:** April 11, 2026
**Status:** Reality-Adjusted
**Purpose:** What you can ACTUALLY do with what you HAVE — automated for minimum manual work.

---

## Reality Check

You called it out. I was wrong to assume production readiness. Here's the honest assessment:

| System | Actual State | What It Can Do NOW | What It Can't Do Yet |
|--------|-------------|-------------------|---------------------|
| **OpenScript** | MVP — produces "fine" videos | Drafts, personal content, rough cuts | Client-ready, agency-quality output |
| **Operant** | MVP — 8 agents, basic ops | Personal task mgmt, journaling, basic tracking | Autonomous business operations, multi-tenant SaaS |
| **TradeBridge** | Infrastructure ready, unvalidated | Demo trading, strategy testing | Live money, community, paid support |
| **MCP Servers** | Built, functional, documented | Consulting deliverables, open-source proof | Self-serve products |
| **n8n Workflows** | 10+ production workflows | Your own automation, consulting templates | Productized SaaS |
| **IGS** | 223 RSS sources, npm published | Intelligence gathering, trend monitoring | Autonomous lead gen (needs configuration) |

**The Brutal Truth:** You can't sell products that aren't ready. But you CAN sell the ENGINEERING SKILL that built them — and automate the hell out of that process.

---

## The Core Insight

> "If I can make automations and infrastructure for companies, why not make it for myself so that I can start earning just like I would help them earn."

This is exactly right. You are your own first client. Build the revenue machine for yourself, using the same tools and patterns you'd use for a paying client.

---

## The Automation Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    THE REVENUE MACHINE                              │
│                                                                     │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐       │
│  │   DETECT    │───▶│   ENGAGE     │───▶│     DELIVER       │       │
│  │             │    │              │    │                   │       │
│  │ IGS monitors│    │ Auto-outreach│    │ Template-based    │       │
│  │ Twitter/RSS │    │ + personal-  │    │ MCP/n8n delivery  │       │
│  │ for signals │    │ ization      │    │ 80% template      │       │
│  │             │    │              │    │ 20% custom        │       │
│  └─────────────┘    └──────────────┘    └─────────┬─────────┘       │
│                                                    │                 │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────▼─────────┐       │
│  │   RETAIN    │◀───│   COLLECT    │◀───│     INVOICE       │       │
│  │             │    │              │    │                   │       │
│  │ Follow-up   │    │ Testimonials │    │ Auto-generated    │       │
│  │ sequences   │    │ Case studies │    │ Payment tracking  │       │
│  │ Referrals   │    │ Portfolio    │    │ P&L tracking      │       │
│  └─────────────┘    └──────────────┘    └───────────────────┘       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              OPERANT CFO — Financial Brain                  │    │
│  │  Tracks: Revenue, Pipeline, Invoices, Expenses, Projections │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## What You're Actually Selling

### Productized Consulting (Your Primary Revenue Engine)

**Not "custom consulting" — productized, template-driven, repeatable.**

| Product | What It Is | Price | Delivery Time | Manual Effort |
|---------|-----------|-------|---------------|---------------|
| **MCP Server in a Week** | Custom MCP server for their tools | $1,000-1,500 | 5-7 days | 8-12 hours |
| **n8n Automation Pack** | 3-5 workflows for their business | $500-800 | 3-5 days | 4-6 hours |
| **AI Integration Blueprint** | Audit + implementation plan | $750 | 2-3 days | 3-4 hours |
| **MCP + n8n Bundle** | Full AI automation setup | $2,000-2,500 | 10-14 days | 15-20 hours |

**Why this works at MVP level:**
- You're selling your engineering skill, not a finished product
- You reuse 80% from existing templates (your MCP servers, n8n workflows)
- 20% custom work per engagement keeps it interesting and high-value
- Each engagement builds your portfolio for the next one

**What you need to prepare (one-time, 2-3 days):**
1. **MCP Server Template** — Base structure with auth, logging, error handling, tool patterns
2. **n8n Workflow Templates** — Common patterns: webhook → process → notify, data sync, scheduled automation
3. **Proposal Template** — Scope, timeline, price, deliverables, portfolio
4. **Delivery Checklist** — Quality standards, testing, documentation, handoff
5. **Portfolio Page** — Your GitHub repos, case studies, testimonials (even from friends/beta users)

---

## The Automation You Build For Yourself

### Component 1: Automated Lead Detection

**What it does:** Monitors the internet for people/companies who need what you sell.

**How it works:**
1. **IGS** monitors 223 RSS sources + add Twitter monitoring for:
   - "MCP server" OR "Model Context Protocol"
   - "AI automation" OR "AI integration"
   - "n8n workflow" OR "n8n automation"
   - "looking for AI developer" OR "need AI integration"
   - "hiring AI engineer" OR "freelance AI"

2. **Filter & Score** — Each signal gets scored:
   - High intent: "looking for", "need", "hiring", "recommend"
   - Medium intent: "how to", "trying to", "struggling with"
   - Low intent: General discussion, news

3. **Alert** — High-intent signals → Telegram notification to you within minutes

**Manual work:** 0 minutes/day (fully automated)
**Setup time:** 2-3 hours
**Tools needed:** IGS + simple Twitter scraper + Telegram webhook

**Implementation:**
```
IGS RSS pools → Add Twitter search feeds → Filter by keywords → Score by intent → Telegram alert
```

**Expected output:** 3-10 high-intent leads per week

---

### Component 2: Semi-Automated Outreach

**What it does:** Sends personalized outreach messages to detected leads.

**How it works:**
1. **Template Library** — 5 outreach templates for different scenarios:
   - MCP server need
   - n8n automation need
   - AI integration need
   - General consulting inquiry
   - Follow-up (48h and 7-day)

2. **Personalization Layer** — Auto-fill:
   - Company/person name
   - Specific need (from detected signal)
   - Relevant portfolio piece (GitHub repo link)
   - Your name + contact

3. **Delivery** — WhatsApp (wacli-mcp) or Email (gog-cli-mcp)

4. **Review & Send** — You review the draft (2 min/message), approve, send

**Manual work:** 2 minutes per message
**Setup time:** 1 day
**Tools needed:** Template system + wacli-mcp or gog-cli-mcp

**Example template:**
```
Hi [Name],

I saw you're [looking for/working on] [detected need].

I specialize in building exactly that — I've built [relevant portfolio piece] and several similar systems.

Recent work:
• [GitHub repo 1] — [brief description]
• [GitHub repo 2] — [brief description]

I offer fixed-scope engagements: [product name] delivered in [timeline] for [price].

Want to see a quick example of what I'd build for your use case?

— Ishan
ishanparihar.com
```

**Expected output:** 10-20 outreach messages/week, 30%+ response rate

---

### Component 3: Automated Proposal Generation

**What it does:** Generates a professional proposal from a template + detected needs.

**How it works:**
1. **Input:** Lead's company, need, budget range (if known)
2. **Template fills:**
   - Scope (based on need type: MCP, n8n, or bundle)
   - Timeline (standard: 5-7 days for MCP, 3-5 for n8n)
   - Price (fixed: $1,000-2,500)
   - Deliverables (standard list + custom items)
   - Portfolio (relevant repos)
   - Terms (50% upfront, 50% on delivery)

3. **Output:** PDF proposal ready to send

**Manual work:** 5 minutes to review and customize
**Setup time:** 2 hours (create template)
**Tools needed:** Proposal template + PDF generator (can use Operant's document tools)

---

### Component 4: Template-Based Delivery

**What it does:** Deliver client work using 80% templates, 20% custom.

**MCP Server Delivery Template:**
```
Day 1: Requirements gathering + architecture (2 hours)
Day 2-3: Base MCP server setup (template) + custom tools (4 hours)
Day 4: Testing + documentation (2 hours)
Day 5: Deployment + handoff (2 hours)
```

**n8n Workflow Delivery Template:**
```
Day 1: Requirements + workflow design (1 hour)
Day 2-3: Build workflows from templates + customize (3 hours)
Day 4: Testing + documentation (1 hour)
Day 5: Deployment + training (1 hour)
```

**What you reuse every time:**
- MCP server base structure (auth, logging, error handling, tool patterns)
- n8n workflow patterns (webhook processing, data transformation, notifications)
- Documentation templates
- Testing frameworks
- Deployment scripts

**What's custom each time:**
- Specific tool implementations (2-5 tools)
- Integration with client's specific systems
- Custom business logic

**Manual work per engagement:** 8-20 hours (depending on scope)
**Revenue per engagement:** $500-2,500
**Effective hourly rate:** $62-125/hour

---

### Component 5: Automated Invoicing & Follow-up

**What it does:** Generates invoices, tracks payments, sends follow-ups.

**How it works:**
1. **Invoice Generation** — Template-based:
   - Invoice number (auto-increment)
   - Client details
   - Line items (from proposal)
   - Payment terms (50% upfront, 50% on delivery)
   - Payment link (Razorpay/Stripe)

2. **Payment Tracking** — Simple status:
   - Draft → Sent → Partial → Paid → Overdue

3. **Automated Follow-up:**
   - Day 1: Invoice sent + thank you message
   - Day 7 (if unpaid): Friendly reminder
   - Day 14 (if unpaid): Urgent reminder
   - Day 21 (if unpaid): Final notice

**Manual work:** 2 minutes per invoice
**Setup time:** 3 hours (template + payment link)
**Tools needed:** Invoice template + payment processor + reminder system

---

### Component 6: Automated Content Marketing

**What it does:** Builds your audience and credibility with minimal manual effort.

**How it works:**
1. **Content Ideas** — IGS detects trending topics in AI/MCP/automation
2. **Content Creation** — You write based on your real experience (15 min/post)
3. **Publishing** — Automated scheduling via n8n
4. **Engagement** — You respond to comments (5 min/day)

**Content pillars:**
- Build-in-public: "Here's what I built this week"
- Technical: "How to build an MCP server for X"
- Case studies: "How I automated X for a client"
- Opinion: "Why MCP is the future of AI integration"

**Manual work:** 30 min/day
**Expected output:** 5 posts/week across Twitter, LinkedIn, Reddit

---

## The Weekly Operating Cadence

### Monday (2 hours)
- [ ] Review IGS lead alerts from weekend
- [ ] Score and prioritize leads
- [ ] Send 5 outreach messages (10 min total)
- [ ] Review pipeline status

### Tuesday (1.5 hours)
- [ ] Client delivery work (if active engagement)
- [ ] Follow up with prospects from 48+ hours ago
- [ ] Post 1 build-in-public tweet

### Wednesday (1.5 hours)
- [ ] Client delivery work (if active)
- [ ] Send 5 more outreach messages
- [ ] Review and send any pending proposals

### Thursday (1.5 hours)
- [ ] Client delivery work (if active)
- [ ] Post 1 technical tweet
- [ ] Engage with replies/DMs (5 min)

### Friday (1 hour)
- [ ] Send invoices for completed work
- [ ] Update pipeline stages
- [ ] Weekly P&L review
- [ ] Plan next week

### Saturday (30 min — optional)
- [ ] Write 1 case study or technical post
- [ ] Open-source maintenance (if time)

### Sunday
- Rest. No work.

**Total manual work per week: 7-8 hours**
**Revenue target with 2 engagements/month: $2,000-3,000**

---

## What to Build Inside Operant (CFO Agent)

You don't need the full 30-tool Revenue OS yet. You need the MINIMUM:

### Phase 1: Revenue Tracking (Week 1)
**Build these 10 MCP tools:**

| Tool | Purpose | Why |
|------|---------|-----|
| `revenue.stream.create` | Register a revenue stream | Track what you're selling |
| `revenue.stream.list` | See all streams + revenue | Know what's working |
| `pipeline.deal.create` | Add a lead to pipeline | Never lose a prospect |
| `pipeline.deal.move` | Update deal stage | Track progress |
| `pipeline.deal.list` | See all deals | Pipeline visibility |
| `expense.track` | Log expenses | Know your burn |
| `expense.list` | Review expenses | Find waste |
| `invoice.create` | Generate invoice | Get paid |
| `invoice.list` | Track invoice status | Follow up on unpaid |
| `financial.dashboard` | Full P&L snapshot | Know your numbers |

**SQLite tables (4, not 6):**
1. `revenue_streams` — What you sell
2. `pipeline_deals` — Who you're selling to
3. `expenses` — What you spend
4. `invoices` — What you're owed

**Skip for now:** Deal activity log, financial snapshots, budget tracking, forecasting. Add these when you have actual revenue to track.

**Implementation effort:** ~800 LOC, 2 days

---

### Phase 2: CMO Content Agency (Week 2)
**Build these 3 auxiliary agents (not 5):**

| Agent | Purpose | Why Only This |
|-------|---------|---------------|
| **Copywriter** | Writes outreach messages, proposals, tweets | You need words that sell |
| **Analytics Lead** | Tracks content performance, lead conversion | You need to know what works |
| **Distribution Manager** | Schedules and publishes content | You need consistent presence |

**Skip for now:** Video Producer (OpenScript not production-ready), Creative Director (overkill at this stage).

**Implementation effort:** ~200 LOC, 1 day

---

### Phase 3: Automation Integrations (Week 3)
**Connect these MCP servers to Operant:**

| Integration | Purpose | Why |
|-------------|---------|-----|
| **IGS** | Lead detection → Operant pipeline | Automated lead gen |
| **wacli-mcp** | WhatsApp outreach + invoicing | Where your clients are |
| **gog-cli-mcp** | Email outreach + calendar | Professional channel |

**Implementation effort:** ~300 LOC, 2 days

---

## The 30-Day Execution Plan

### Week 1: Foundation
- [ ] Build 4-table SQLite schema for Revenue OS
- [ ] Implement 10 core MCP tools
- [ ] Register 3 revenue streams:
  1. "MCP Server in a Week" — service, project, $1,200, USD
  2. "n8n Automation Pack" — service, project, $650, USD
  3. "AI Integration Blueprint" — service, project, $750, USD
- [ ] Create proposal template + invoice template
- [ ] Set up payment collection (Razorpay for INR, Stripe for USD)
- [ ] Configure IGS to monitor for leads (Twitter + RSS)

**Week 1 Target:** System ready. First outreach sent.

### Week 2: First Outreach
- [ ] IGS starts detecting leads
- [ ] Send 20 outreach messages (4/day, Tue-Fri)
- [ ] Post 3 tweets about your MCP/n8n expertise
- [ ] Create portfolio page (simple Notion page or GitHub README)
- [ ] Add 3 CMO auxiliary agents (Copywriter, Analytics, Distribution)

**Week 2 Target:** 5+ responses, 1+ discovery call.

### Week 3: First Close
- [ ] Follow up with Week 2 prospects
- [ ] Send 2 proposals
- [ ] Deliver first engagement (if closed)
- [ ] Post 2 more tweets (build-in-public)
- [ ] Open-source first MCP server (TradeBridge)

**Week 3 Target:** 1 closed deal ($500-1,500).

### Week 4: Systematize
- [ ] Document delivery process (template refinement)
- [ ] Collect testimonial from first client
- [ ] Use testimonial in outreach
- [ ] Send 20 more outreach messages
- [ ] Monthly P&L review

**Week 4 Target:** 1 more closed deal. $1,000-2,500 total revenue.

### Month 1 Total Target
| Metric | Target |
|--------|--------|
| Outreach messages sent | 80+ |
| Responses received | 20+ |
| Discovery calls | 5+ |
| Proposals sent | 3+ |
| Deals closed | 2+ |
| **Total revenue** | **$1,000-2,500** |

---

## What NOT to Do (Revised for MVP Reality)

- ❌ **Sell OpenScript content services** — Videos aren't production-grade. Use OpenScript for YOUR content only, not client work.
- ❌ **Sell Operant as SaaS** — Not multi-tenant, no web UI, no billing. Use it for YOUR operations only.
- ❌ **Sell TradeBridge as product** — Needs community, docs, validation. Open-source it for credibility, sell support later.
- ❌ **Build web dashboards** — Telegram is enough. Web UI is a distraction until you have revenue.
- ❌ **Build complex automation before having customers** — Start with semi-automated. Full automation comes after you know what works.
- ❌ **Work on AlphaForge/trading** — No capital, not validated. Month 3+ play.
- ❌ **Create landing page websites** — Use Twitter + Notion + GitHub. Websites don't close deals.
- ❌ **Attend events or conferences** — Outbound is faster and free.

---

## The Automation Maturity Curve

```
NOW (Month 1)          →  MONTH 2-3         →  MONTH 4-6
─────────────────────────────────────────────────────────────
Semi-automated             Systematized           Automated
                           ──────────             ──────────
• You detect leads         • IGS auto-detects     • Full lead-to-cash
  manually                   leads                  automation
• You write outreach       • Templates auto-      • AI writes outreach
  messages                   personalize            messages
• You deliver using        • Delivery 90%         • Delivery 95%
  templates                  templated              automated
• You invoice manually     • Invoicing            • Full financial
                           automated                automation

Manual work:               Manual work:           Manual work:
7-8 hours/week             4-5 hours/week         2-3 hours/week

Revenue:                   Revenue:               Revenue:
$1,000-2,500/month         $2,000-5,000/month     $5,000-10,000/month
```

**The key insight:** You don't need full automation on Day 1. You need a system that works with 7-8 hours/week of manual effort, then automate the bottlenecks as revenue comes in.

---

## Decision Framework

Every time you face a choice, ask:

1. **Does this directly help me close a paying client in the next 14 days?**
   - Yes → Do it today
   - No → Is it required for delivery?
     - Yes → Schedule it
     - No → Kill it

2. **Can I template this for reuse?**
   - Yes → Build it as a template (scales)
   - No → Do it manually this time, then template after

3. **Would I charge a client for this?**
   - Yes → It's billable work, prioritize it
   - No → It's overhead, minimize it

4. **Does this reduce my manual work per engagement?**
   - Yes → Build it (leverage)
   - No → Skip it (distraction)

---

## The Bottom Line

You have the engineering depth to charge $1,000-2,500 per engagement.

You have the tools to automate 80% of the sales and delivery process.

You have the AI C-suite to manage the operations.

**What you need is the discipline to SELL before you BUILD more.**

The machine you're building for yourself is:

```
Detect leads → Send outreach → Close deals → Deliver with templates → Invoice → Repeat
```

Each piece can be automated. Start with semi-automated. Iterate toward full automation.

**Your first goal: $1,000 from a stranger for engineering work you can deliver in a week.**

After that, everything scales. Before that, nothing matters.

Build the machine. Run the machine. Fund the dreams with the machine's output.
