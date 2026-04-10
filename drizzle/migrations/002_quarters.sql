-- Migration 002: quarters
-- Child of years via relation. Depends on 001_years.
-- Source: LifeOS Notion database "Quarters"
-- Schema: Live Notion (16 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS quarters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,

    name            TEXT NOT NULL,

    years_id        UUID REFERENCES years(id),

    months          UUID[],

    quarterly_goals UUID[],

    quarter_number  INTEGER,

    quarter_start   TIMESTAMPTZ,

    quarter_end     TIMESTAMPTZ,

    quarter_range   TEXT,

    quarter_name    TEXT,

    quarter_report  TEXT,

    status          TEXT,

    total_income    NUMERIC(12,2),

    total_expenses  NUMERIC(12,2),

    net_cashflow    NUMERIC(12,2),

    category_summary TEXT,

    key_learnings   TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quarters_status ON quarters (status);
CREATE INDEX idx_quarters_years_id ON quarters (years_id);
CREATE INDEX idx_quarters_quarter_number ON quarters (quarter_number);
CREATE INDEX idx_quarters_quarter_start ON quarters (quarter_start);
CREATE INDEX idx_quarters_quarter_end ON quarters (quarter_end);
CREATE INDEX idx_quarters_months ON quarters USING GIN (months);
CREATE INDEX idx_quarters_quarterly_goals ON quarters USING GIN (quarterly_goals);

CREATE TRIGGER update_quarters_updated_at BEFORE UPDATE ON quarters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
