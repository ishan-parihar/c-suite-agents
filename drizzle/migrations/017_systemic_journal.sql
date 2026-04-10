-- Migration 017: systemic_journal
-- System-level observations with impact assessment, AI reports, and directive linkages.
-- Source: LifeOS Notion database "Systemic Journal"
-- Schema: Live Notion (11 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS systemic_journal (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 211c18ce-5aab-8028-91e2-000b1f2b5c02

    -- Title: "Name"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" — SYS prefix
    entry_id        TEXT UNIQUE,

    -- Date: "Date"
    date            TIMESTAMPTZ,

    -- Created Time: "Created Time"
    created_time    TIMESTAMPTZ,

    -- Relation: "Days" → days
    days_id         UUID REFERENCES days(id),

    -- Select: "Impact" — P5: Note, P4: Low, P3: Medium, P2: High, P1: Critical
    impact          TEXT,

    -- Relation: "Projects" → projects[]
    projects        UUID[],

    -- Relation: "Directives & Risk Log" → directives_risk_log[]
    directives_risk_log UUID[],

    -- Relation: "Opportunities & Strengths Log" → opportunities_strengths[]
    opportunities_strengths UUID[],

    -- Rich Text: "AI Generated Report"
    ai_generated_report TEXT,

    -- Formula: "Systemic_JSON"
    systemic_json   TEXT,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_systemic_journal_date ON systemic_journal (date);
CREATE INDEX idx_systemic_journal_created_time ON systemic_journal (created_time);
CREATE INDEX idx_systemic_journal_days_id ON systemic_journal (days_id);
CREATE INDEX idx_systemic_journal_impact ON systemic_journal (impact);
CREATE INDEX idx_systemic_journal_projects ON systemic_journal USING GIN (projects);
CREATE INDEX idx_systemic_journal_directives_risk_log ON systemic_journal USING GIN (directives_risk_log);
CREATE INDEX idx_systemic_journal_opportunities_strengths ON systemic_journal USING GIN (opportunities_strengths);

-- Trigger for updated_at
CREATE TRIGGER update_systemic_journal_updated_at BEFORE UPDATE ON systemic_journal
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
