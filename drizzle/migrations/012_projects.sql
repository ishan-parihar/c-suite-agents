-- Migration 012: projects
-- Project management with budgets, timelines, KPIs, team, and cross-entity relations.
-- Source: LifeOS Notion database "Projects"
-- Schema: Live Notion (42 properties extracted, 1 button skipped)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 211c18ce-5aab-8083-8068-000bed26453a

    -- Title: "Project"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" — PROJ prefix
    project_id      TEXT UNIQUE,

    -- Status: "Status" — Cancelled, Someday Maybe, On Hold, Delegated, Active, Done
    status          TEXT NOT NULL DEFAULT 'On Hold',

    -- Select: "phase" — Discovery, Planning, Execution, Launch, Maintenance, Winding-down
    phase           TEXT,

    -- Select: "Priority" — ⭐⭐⭐⭐⭐, ⭐⭐⭐⭐, ⭐⭐⭐, ⭐⭐, ⭐
    priority        TEXT,

    -- Multi-Select: "team"
    team            TEXT[],

    -- Date: "Project Start"
    project_start   TIMESTAMPTZ,

    -- Date: "Deadline"
    deadline        TIMESTAMPTZ,

    -- Date: "Review Date"
    review_date     TIMESTAMPTZ,

    -- Number: "budget_allocated"
    budget_allocated NUMERIC(12,2),

    -- Number: "budget_spent"
    budget_spent     NUMERIC(12,2),

    -- Number: "Required Budget" — dollar format
    required_budget NUMERIC(12,2),

    -- Number: "Projected Revenue" — dollar format
    projected_revenue NUMERIC(12,2),

    -- Rich Text: "Project Summary"
    project_summary TEXT,

    -- Rich Text: "Justify This Project"
    justification   TEXT,

    -- Rich Text: "KPI"
    kpi             TEXT,

    -- Rich Text: "KPI Status"
    kpi_status      TEXT,

    -- Rich Text: "Strategy"
    strategy        TEXT,

    -- Relation: "Quarterly Goals" → quarterly_goals
    quarterly_goal_id UUID REFERENCES quarterly_goals(id),

    -- Relation: "Tasks" → tasks[]
    tasks           UUID[],

    -- Relation: "Depends On" → projects[] (projects this depends on)
    depends_on      UUID[],

    -- Relation: "Dependents" → projects[] (projects that depend on this)
    dependents      UUID[],

    -- Relation: "People" → people[]
    people          UUID[],

    -- Relation: "Campaign Calendar" → campaigns[]
    campaigns       UUID[],

    -- Relation: "Activity Log" → activity_log[]
    activity_log    UUID[],

    -- Relation: "Financial Log" → financial_log[]
    financial_log   UUID[],

    -- Relation: "Systemic Journal" → systemic_journal[]
    systemic_journal UUID[],

    -- Relation: "Documents DB" → documents[]
    documents       UUID[],

    -- Relation: "Notes Management" → notes[]
    notes           UUID[],

    -- Relation: "Directives & Risks" → directives_risks[]
    directives_risks UUID[],

    -- Relation: "Opportunities & Strength" → opportunities[]
    opportunities   UUID[],

    -- Formula: "Health"
    health          TEXT,

    -- Formula: "Monitor"
    monitor         TEXT,

    -- Formula: "Progress" — percentage from tasks
    progress        NUMERIC(5,2),

    -- Formula: "Project_JSON"
    project_json    TEXT,

    -- Formula: "Project Progress" — dual bar with pacing
    project_progress TEXT,

    -- Formula: "Duration" — days from start to deadline
    duration_days   TEXT,

    -- Formula: "Cost to Date" — from financial_log
    cost_to_date    NUMERIC(12,2),

    -- Last Edited Time: "Last edited time"
    last_edited_at  TIMESTAMPTZ,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_phase ON projects (phase);
CREATE INDEX idx_projects_priority ON projects (priority);
CREATE INDEX idx_projects_deadline ON projects (deadline);
CREATE INDEX idx_projects_quarterly_goal_id ON projects (quarterly_goal_id);
CREATE INDEX idx_projects_team ON projects USING GIN (team);
CREATE INDEX idx_projects_tasks ON projects USING GIN (tasks);
CREATE INDEX idx_projects_depends_on ON projects USING GIN (depends_on);
CREATE INDEX idx_projects_dependents ON projects USING GIN (dependents);
CREATE INDEX idx_projects_people ON projects USING GIN (people);
CREATE INDEX idx_projects_campaigns ON projects USING GIN (campaigns);
CREATE INDEX idx_projects_activity_log ON projects USING GIN (activity_log);
CREATE INDEX idx_projects_financial_log ON projects USING GIN (financial_log);
CREATE INDEX idx_projects_systemic_journal ON projects USING GIN (systemic_journal);
CREATE INDEX idx_projects_documents ON projects USING GIN (documents);
CREATE INDEX idx_projects_notes ON projects USING GIN (notes);
CREATE INDEX idx_projects_directives_risks ON projects USING GIN (directives_risks);
CREATE INDEX idx_projects_opportunities ON projects USING GIN (opportunities);

-- Trigger for updated_at
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
