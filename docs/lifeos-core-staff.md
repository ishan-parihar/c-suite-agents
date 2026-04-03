# LifeOS Core Staff: Agent Roles & Responsibilities

## Organizational Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                    STRATEGOS (CEO)                              │
│  Databases: annual_goals, quarterly_goals, projects, campaigns  │
│  Tools: Goal alignment, OKR tracking, portfolio health          │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   COO         │   │  Psychologist │   │    CRO        │
│ Productivity  │   │   (CPO)       │   │  Relational   │
│               │   │               │   │  Counsellor   │
└───────────────┘   └───────────────┘   └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  CFO          │   │   CMO         │   │   Physician   │
│  Financial    │   │   Content     │   │   Dietician   │
│  Analyst      │   │   Creator     │   │   (Health)    │
└───────────────┘   └───────────────┘   └───────────────┘
```

---

## 1. CEO — Strategic (Strategos)

**Role:** Overall vision, goal alignment, quarterly OKRs, portfolio oversight

**Databases:**
- `annual_goals` — Strategic themes, epics, success conditions
- `quarterly_goals` — OKRs with key results, progress tracking
- `projects` — Portfolio health, progress, strategy
- `campaigns` — Campaign management, reach, engagement
- `directives_risk_log` — Risk assessment, mitigation protocols
- `opportunities_strengths` — Leverage scoring, activation strategies
- `people` — Strategic relationships, influence mapping
- `content_pipeline` — Content strategy oversight

**Key Tools:**
- `lifeos_annual_goals()` — Get annual strategic themes
- `lifeos_quarterly_goals()` — Get OKRs, update progress
- `lifeos_projects(status='Active')` — Portfolio health check
- `lifeos_directives_risks()` — Risk monitoring
- `lifeos_opportunities_strengths()` — Opportunity tracking
- `lifeos_create_entry(database='quarterly_goals')` — Create new OKRs
- `lifeos_update_entry(database='projects')` — Update project health

**Kanban Columns:**
- Strategic Priorities | OKR Planning | In Review | Approved | Monitoring | Complete

**Autonomy Level:** 4 (Full — can override any decision)

**Board Seat:** Yes (Chair)

---

## 2. COO — Productivity

**Role:** Daily/weekly planning, activity tracking, task prioritization, time optimization

**Databases:**
- `activity_log` — Time tracking, duration, activity types
- `activity_types` — Frequency targets, habit tracking
- `days` — Daily planning, status, activity aggregation
- `weeks` — Weekly reviews, cashflow, task progress
- `months` — Monthly synthesis, category summaries
- `tasks` — Task management, priorities, sprint status
- `reports` — Productivity reports, insights

**Key Tools:**
- `lifeos_daily_briefing(date='YYYY-MM-DD')` — Morning planning snapshot
- `lifeos_productivity_report(period='past_week')` — Weekly time allocation
- `lifeos_tasks(status='Active'|overdue_only=true)` — Task management
- `lifeos_trajectory(period='past_week')` — Target compliance gaps
- `lifeos_weekday_patterns(period='past_month')` — Typical day patterns
- `lifeos_create_entry(database='tasks')` — Create new tasks
- `lifeos_update_entry(database='tasks')` — Update task status

**Kanban Columns:**
- Backlog | This Week | Today | In Progress | Blocked | Review | Done

**Autonomy Level:** 3 (Can approve task priorities, manage schedules)

**Board Seat:** Yes

**Reports To:** CEO

---

## 3. CPO — Psychologist (Chief Product Officer)

**Role:** Internal state synthesis, journal analysis, systemic insights, mental health monitoring

**Databases:**
- `subjective_journal` — Daily psychograph, emotional states
- `relational_journal` — Interaction quality, relationship reflections
- `systemic_journal` — System-level observations, impact assessment
- `projects` — Link insights to project health

**Key Tools:**
- `lifeos_subjective_journal(period='past_week')` — Emotional state tracking
- `lifeos_relational_journal(period='past_week')` — Relationship patterns
- `lifeos_systemic_journal(period='past_week')` — Systemic insights
- `lifeos_create_entry(database='subjective_journal')` — Log internal states
- `lifeos_create_entry(database='systemic_journal', impact='P1-P5')` — Log insights
- `lifeos_update_entry(database='systemic_journal')` — Link to directives/projects

**Kanban Columns:**
- Journal Queue | Analyzing | Insights Generated | Action Items | Integrated | Archived

**Autonomy Level:** 3 (Can flag mental health concerns, recommend interventions)

**Board Seat:** Yes

**Reports To:** CEO

---

## 4. CRO — Relational Counsellor

**Role:** People intelligence, relationship cadence, networking strategy, conflict resolution

**Databases:**
- `people` — Full relationship intel, connection frequency, influence mapping
- `relational_journal` — Interaction logs, relationship quality
- `projects` — Link relationships to projects

**Key Tools:**
- `lifeos_find_entry(database='people', search='name')` — Find person
- `lifeos_update_entry(database='people')` — Update last_connected_date, trajectory
- `lifeos_create_entry(database='relational_journal')` — Log interactions
- `lifeos_query(database='people', filter_property='Reconnect By')` — Find overdue reconnects

**Kanban Columns:**
- To Reconnect | This Week | Scheduled | Completed | Follow-up | Maintaining | Dormant

**Autonomy Level:** 3 (Can schedule reconnects, update relationship status)

**Board Seat:** Yes

**Reports To:** CEO

---

## 5. CFO — Financial Analyst

**Role:** Cashflow tracking, budget management, financial synthesis, capital allocation

**Databases:**
- `financial_log` — Transactions, categories, capital engines
- `weeks` — Weekly cashflow summaries
- `months` — Monthly synthesis, net worth tracking
- `projects` — Project budget tracking

**Key Tools:**
- `lifeos_financial_log(period='past_month')` — Transaction history
- `lifeos_temporal_analysis(period='past_month', include_financial=true)` — Monthly synthesis
- `lifeos_create_entry(database='financial_log')` — Log transactions
- `lifeos_query(database='financial_log', filter_property='Category')` — Category analysis

**Kanban Columns:**
- To Log | This Week | Reconciling | Budget Review | Approved | Forecasting | Complete

**Autonomy Level:** 3 (Can approve expenses within budget, flag overspending)

**Board Seat:** Yes

**Reports To:** CEO

---

## 6. CMO — Content Creator

**Role:** Content strategy, campaign execution, platform management, engagement tracking

**Databases:**
- `content_pipeline` — Content status, platforms, formats, metrics
- `campaigns` — Campaign themes, reach, engagement, conversion
- `projects` — Content projects, deadlines

**Key Tools:**
- `lifeos_content(action='list', status='Next Up 🚩')` — Upcoming content
- `lifeos_content(action='transition', to='Published 💥')` — Publish content
- `lifeos_content(action='update_metrics')` — Update reach/engagement
- `lifeos_campaigns(action='list')` — Campaign overview
- `lifeos_campaigns(action='brief', campaign_id='...')` — Campaign details
- `lifeos_create_entry(database='content_pipeline')` — Create content items

**Kanban Columns:**
- Ideas | Scheduled | Writing | Recording | Editing | Ready | Published | Performing

**Autonomy Level:** 3 (Can publish content, update metrics)

**Board Seat:** Yes

**Reports To:** CEO

---

## 7. Physician — Dietician/Health

**Role:** Nutrition tracking, health monitoring, diet optimization, wellness insights

**Databases:**
- `diet_log` — Meal tracking, nutrition data
- `days` — Daily health status
- `activity_log` — Exercise, workout tracking
- `activity_types` — Habit tracking for health routines

**Key Tools:**
- `lifeos_diet_log(period='past_week')` — Nutrition history
- `lifeos_activity_log(category='Workout')` — Exercise tracking
- `lifeos_create_entry(database='diet_log')` — Log meals
- `lifeos_query(database='activity_log', filter_property='Activity Type')` — Activity patterns

**Kanban Columns:**
- To Log | This Week | Analyzing | Recommendations | Tracking | Goals | Complete

**Autonomy Level:** 2 (Can recommend diet changes, flag health concerns)

**Board Seat:** No (Advisory role)

**Reports To:** COO (Productivity) / CEO

---

## Cross-Agent Workflows

### Weekly Board Meeting (All Core Staff)

**Trigger:** Every Monday 9 AM (via heartbeat scheduler)

**Agenda:**
1. CEO — Strategic priorities, OKR progress
2. COO — Productivity metrics, task completion rates
3. CPO — Mental health trends, systemic insights
4. CRO — Relationship cadence, networking wins
5. CFO — Cashflow summary, budget status
6. CMO — Content performance, campaign metrics
7. Physician — Health trends, nutrition compliance

**Output:** Weekly synthesis stored in `reports` database

---

### Crisis Escalation Protocol

| Issue Type | First Responder | Escalation Path | Board Vote Required |
|------------|-----------------|-----------------|---------------------|
| Mental health crisis | CPO (Psychologist) | CEO | No |
| Budget overrun >20% | CFO | CEO | Yes |
| Missed OKR deadline | CEO | — | No |
| Relationship breakdown | CRO | CEO | No |
| Content controversy | CMO | CEO + CRO | Yes |
| Health emergency | Physician | CEO + COO | No |

---

## Memory Architecture

Each agent has **three-tier memory**:

### 1. Personal Memory (LanceDB — Private)
- Agent's private thoughts, learnings, reflections
- Not shared with other agents
- Example: CPO's analysis of user's emotional patterns

### 2. Project Memory (LanceDB — Shared)
- Shared among agents working on same project
- Example: CEO + COO + CMO collaborating on content campaign

### 3. Company Memory (LanceDB — Global)
- All agents can access
- Meeting minutes, decisions, policies, OKRs
- Example: Board meeting decisions, strategic directives

---

## Implementation Priority

| Phase | Component | Agents | Priority |
|-------|-----------|--------|----------|
| 2A | Core Staff Templates | All 7 | 🔴 High |
| 2B | LifeOS MCP Integration | All 7 | 🔴 High |
| 2C | Role-Specific Prompts | All 7 | 🔴 High |
| 2D | Kanban Boards per Agent | All 7 | 🟡 Medium |
| 2E | Inter-Agent Messaging | All 7 | 🟡 Medium |
| 3A | Board Meeting Scheduler | Core 6 | 🟡 Medium |
| 3B | Memory Hierarchy | All 7 | 🔴 High |

---

## Next Steps

1. **Create core staff templates** with LifeOS database mappings
2. **Implement LifeOS MCP tool wrappers** for each agent
3. **Build role-specific system prompts** based on database access
4. **Set up Kanban boards** per agent with role-specific columns
5. **Implement board meeting scheduler** with agenda generation
6. **Build three-tier memory** (personal/project/company)
