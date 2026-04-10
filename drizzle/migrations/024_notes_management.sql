-- Migration 024: notes_management
-- General notes with project linkage, agent attribution, and status tracking.
-- Source: LifeOS Notion database "Notes Management"
-- Schema: Live Notion (11 properties extracted)
-- Dependencies: projects(id), knowledge_categories[]
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS notes_management (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 36aec638-0cc9-4db8-b494-15b35b9dc45b

    -- Title: "Title"
    name            TEXT NOT NULL,

    -- Status: "Status" — New Note/Live/Priority-Highlight/Archived Note
    status          TEXT NOT NULL DEFAULT 'New Note',

    -- Select: "Agent" — Psychologist/Productivity/Relational/Strategic/Nutritionist/Financial/Technical/Content Creator
    agent           TEXT,

    -- Select: "Agent 1" — secondary agent attribution
    agent_secondary TEXT,

    -- Rich Text: "Report"
    report          TEXT,

    -- Rich Text: "Report 1"
    report_extra    TEXT,

    -- Relation: "Projects" → projects(id)
    project_id      UUID REFERENCES projects(id),

    -- Rollup: "Project Status"
    project_status  TEXT,

    -- Relation: "Knowledge Categories" (multi)
    knowledge_categories UUID[],

    -- Created Time: "Created time"
    created_time    TIMESTAMPTZ,

    -- Last Edited Time: "Last edited time"
    last_edited_at  TIMESTAMPTZ,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notes_status ON notes_management (status);
CREATE INDEX idx_notes_agent ON notes_management (agent);
CREATE INDEX idx_notes_project_id ON notes_management (project_id);
CREATE INDEX idx_notes_knowledge_categories ON notes_management USING GIN (knowledge_categories);
CREATE INDEX idx_notes_created_time ON notes_management (created_time);

-- Trigger for updated_at
CREATE TRIGGER update_notes_management_updated_at BEFORE UPDATE ON notes_management
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
