-- Migration 001: years
-- Temporal hierarchy root. No dependencies.
-- Source: LifeOS Notion database "Years"
-- Schema: Live Notion (7 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS years (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 211c18ce-5aab-8056-bd18-000b43134660

    -- Title: "Years"
    name            TEXT NOT NULL,

    -- Relation: "Annual Goals" → annual_goals[]
    annual_goals    UUID[],

    -- Relation: "Quarters" → quarters[]
    quarters        UUID[],

    -- Formula: "Quarterly Goals" (rollup, show_unique)
    quarterly_goals UUID[],

    -- Formula: "Status" — computed: Next Year/Future Year/Current Year/Past Year
    status          TEXT,

    -- Formula: "Year Range" — dateRange(firstDayOfYear, lastDayOfYear)
    year_range      TEXT,

    -- Formula: "Year_Report" — annual goals summary text
    year_report     TEXT,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_years_status ON years (status);
CREATE INDEX idx_years_annual_goals ON years USING GIN (annual_goals);
CREATE INDEX idx_years_quarters ON years USING GIN (quarters);
CREATE INDEX idx_years_quarterly_goals ON years USING GIN (quarterly_goals);

-- Trigger for updated_at
CREATE TRIGGER update_years_updated_at BEFORE UPDATE ON years
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
