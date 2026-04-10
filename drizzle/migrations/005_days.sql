-- Migration 005: days
-- Child of months via relation. Depends on 003_months.
-- Source: LifeOS Notion database "Days"
-- Schema: Live Notion (18 properties extracted, 3 buttons skipped)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS days (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,

    name            TEXT NOT NULL,

    months_id       UUID REFERENCES months(id),

    weeks           UUID[],

    diet_log        UUID[],

    subjective_journal UUID[],

    relational_journal UUID[],

    systemic_journal UUID[],

    activity_log    UUID[],

    year            INTEGER,

    day_number      INTEGER,

    health_score    INTEGER,

    date            DATE,

    day_name        TEXT,

    day_json        TEXT,

    status          TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_days_status ON days (status);
CREATE INDEX idx_days_months_id ON days (months_id);
CREATE INDEX idx_days_year ON days (year);
CREATE INDEX idx_days_day_number ON days (day_number);
CREATE INDEX idx_days_date ON days (date);
CREATE INDEX idx_days_weeks ON days USING GIN (weeks);
CREATE INDEX idx_days_diet_log ON days USING GIN (diet_log);
CREATE INDEX idx_days_subjective_journal ON days USING GIN (subjective_journal);
CREATE INDEX idx_days_relational_journal ON days USING GIN (relational_journal);
CREATE INDEX idx_days_systemic_journal ON days USING GIN (systemic_journal);
CREATE INDEX idx_days_activity_log ON days USING GIN (activity_log);

CREATE TRIGGER update_days_updated_at BEFORE UPDATE ON days
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
