-- Migration 015: subjective_journal
-- Daily subjective well-being tracking with mood, stress, energy, and sleep metrics.
-- Source: LifeOS Notion database "Subjective Journal"
-- Schema: Live Notion (10 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS subjective_journal (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 211c18ce-5aab-8033-b28c-000bf9e3c193

    -- Title: "Name"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" — SUB prefix
    entry_id        TEXT UNIQUE,

    -- Date: "Date"
    date            TIMESTAMPTZ,

    -- Relation: "Days" → days
    days_id         UUID REFERENCES days(id),

    -- Number: "sleep_hours"
    sleep_hours     NUMERIC(4,1),

    -- Select: "stress_level" — 1, 2, 3, 4, 5
    stress_level    TEXT,

    -- Select: "energy_level" — 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
    energy_level    TEXT,

    -- Multi-Select: "mood_trigger" — Work, Relationship, Health, Finance, Weather, Other
    mood_trigger    TEXT[],

    -- Rich Text: "Psychograph"
    psychograph     TEXT,

    -- Formula: "Subjective_JSON"
    subjective_json TEXT,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subjective_journal_date ON subjective_journal (date);
CREATE INDEX idx_subjective_journal_days_id ON subjective_journal (days_id);
CREATE INDEX idx_subjective_journal_stress_level ON subjective_journal (stress_level);
CREATE INDEX idx_subjective_journal_energy_level ON subjective_journal (energy_level);
CREATE INDEX idx_subjective_journal_mood_trigger ON subjective_journal USING GIN (mood_trigger);

-- Trigger for updated_at
CREATE TRIGGER update_subjective_journal_updated_at BEFORE UPDATE ON subjective_journal
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
