-- Migration 023: reports
-- Agent-generated reports with period tracking and unique identifiers.
-- Source: LifeOS Notion database "Reports"
-- Schema: Live Notion (7 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: (from Notion)

    -- Title: "Title"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" (REPORT prefix)
    report_id       TEXT UNIQUE,

    -- Select: "Agent" — Psychologist/Productivity/Relational/Strategic/Nutritionist/Financial/Technical/Content Creator
    agent           TEXT,

    -- Select: "report_type" — Daily/Weekly/Monthly/Quarterly/Ad-hoc
    report_type     TEXT,

    -- Date: "period_covered"
    period_covered  TIMESTAMPTZ,

    -- Rich Text: "Report"
    report          TEXT,

    -- Created Time: "Created time"
    created_time    TIMESTAMPTZ,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_report_id ON reports (report_id);
CREATE INDEX idx_reports_agent ON reports (agent);
CREATE INDEX idx_reports_report_type ON reports (report_type);
CREATE INDEX idx_reports_period_covered ON reports (period_covered);

-- Trigger for updated_at
CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
