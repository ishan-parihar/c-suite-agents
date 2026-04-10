-- Migration 004: weeks
-- Temporal unit. No FK to months (live schema has no month relation).
-- Source: LifeOS Notion database "Weeks"
-- Schema: Live Notion (19 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS weeks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,

    name            TEXT NOT NULL,

    days            UUID[],

    tasks           UUID[],

    financial_log   UUID[],

    year            INTEGER,

    week_number     INTEGER,

    week_name       TEXT,

    week_range      TEXT,

    week_start      TIMESTAMPTZ,

    week_end        TIMESTAMPTZ,

    week_json       TEXT,

    status          TEXT,

    tasks_progress  TEXT,

    activity_breakdown TEXT,

    total_income    NUMERIC(12,2),

    total_expenses  NUMERIC(12,2),

    net_cashflow    NUMERIC(12,2),

    category_summary TEXT,

    key_learnings   TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_weeks_status ON weeks (status);
CREATE INDEX idx_weeks_year ON weeks (year);
CREATE INDEX idx_weeks_week_number ON weeks (week_number);
CREATE INDEX idx_weeks_week_start ON weeks (week_start);
CREATE INDEX idx_weeks_week_end ON weeks (week_end);
CREATE INDEX idx_weeks_days ON weeks USING GIN (days);
CREATE INDEX idx_weeks_tasks ON weeks USING GIN (tasks);
CREATE INDEX idx_weeks_financial_log ON weeks USING GIN (financial_log);

CREATE TRIGGER update_weeks_updated_at BEFORE UPDATE ON weeks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
