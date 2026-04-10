-- Migration 011: tasks
-- Task tracking with sprint management, dependencies, and project linkage.
-- Source: LifeOS Notion database "Tasks"
-- Schema: Live Notion (27 properties extracted, 7 buttons skipped)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 211c18ce-5aab-80dc-8402-000b170520ba

    -- Title: "Tasks"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" — TASK prefix
    task_id         TEXT UNIQUE,

    -- Status: "Status" — Waiting, Paused, Delegated, Up Next, Active, Focus, Done, Cancelled, Archived
    status          TEXT NOT NULL DEFAULT 'Up Next',

    -- Relation: "Parent task" → tasks (self-referencing)
    parent_task_id  UUID REFERENCES tasks(id),

    -- Relation: "Sub-task" → tasks (self-referencing)
    sub_task_id     UUID REFERENCES tasks(id),

    -- Relation: "Projects" → projects
    project_id      UUID REFERENCES projects(id),

    -- Relation: "Weeks" → weeks
    week_id         UUID REFERENCES weeks(id),

    -- Relation: "Blocks" → tasks[] (tasks this task blocks)
    blocks          UUID[],

    -- Relation: "blocked_by" → tasks
    blocked_by      UUID REFERENCES tasks(id),

    -- Select: "Priority" — ⭐⭐⭐⭐⭐, ⭐⭐⭐⭐, ⭐⭐⭐, ⭐⭐, ⭐, P1 - Critical, P2 - High
    priority        TEXT,

    -- People: "Assignee" — people name
    assignee        TEXT,

    -- Multi-Select: "tags" — Quick Win, Deep Work, Admin, Creative, Urgent, Waiting
    tags            TEXT[],

    -- Date: "Action Date"
    action_date     TIMESTAMPTZ,

    -- Date: "completed_date"
    completed_date  TIMESTAMPTZ,

    -- Number: "estimated_hours"
    estimated_hours NUMERIC(5,2),

    -- Rich Text: "Description"
    description     TEXT,

    -- Formula: "Sprint Status"
    sprint_status   TEXT,

    -- Formula: "Monitor"
    monitor         TEXT,

    -- Rollup: "Project Status"
    project_status  TEXT,

    -- Last Edited Time: "Last edited time"
    last_edited_at  TIMESTAMPTZ,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_priority ON tasks (priority);
CREATE INDEX idx_tasks_project_id ON tasks (project_id);
CREATE INDEX idx_tasks_week_id ON tasks (week_id);
CREATE INDEX idx_tasks_parent_task_id ON tasks (parent_task_id);
CREATE INDEX idx_tasks_blocked_by ON tasks (blocked_by);
CREATE INDEX idx_tasks_action_date ON tasks (action_date);
CREATE INDEX idx_tasks_tags ON tasks USING GIN (tags);
CREATE INDEX idx_tasks_blocks ON tasks USING GIN (blocks);

-- Trigger for updated_at
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
