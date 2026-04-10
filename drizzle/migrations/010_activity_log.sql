-- Migration 010: activity_log
-- Tracks individual activity instances with duration, energy, mood, and type relations.
-- Source: LifeOS Notion database "Activity Log"
-- Schema: Live Notion (16 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS activity_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: a1769af1-3ab6-4f77-bbd0-57f920c62311

    -- Title: "Name"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" — ACT prefix
    activity_id     TEXT UNIQUE,

    -- Relation: "activity_type_rel" → activity_types
    activity_type_id UUID REFERENCES activity_types(id),

    -- Relation: "Days" → days
    days_id         UUID REFERENCES days(id),

    -- Relation: "Projects" → projects[]
    projects        UUID[],

    -- Select: "energy" — High, Medium, Low
    energy          TEXT,

    -- Select: "mood_delta" — ↑, →, ↓
    mood_delta      TEXT,

    -- Date: "Date"
    date_range      TIMESTAMPTZ,

    -- Formula: "Date End" → dateEnd()
    date_end        TIMESTAMPTZ,

    -- Formula: "Duration" — dateBetween end-start in hours
    duration_hrs    NUMERIC(4,2),

    -- Formula: "Activity Type" — parsed from title
    activity_type   TEXT,

    -- Formula: "Activity Notes" — derived from title
    activity_notes  TEXT,

    -- Formula: "Activity_JSON"
    activity_json   TEXT,

    -- Formula: "Habit" — formula checking if type is a habit
    is_habit_activity BOOLEAN,

    -- Checkbox: "Logged"
    is_logged       BOOLEAN,

    -- Rich Text: "notes_body"
    notes_body      TEXT,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_log_energy ON activity_log (energy);
CREATE INDEX idx_activity_log_mood_delta ON activity_log (mood_delta);
CREATE INDEX idx_activity_log_activity_type ON activity_log (activity_type);
CREATE INDEX idx_activity_log_activity_type_id ON activity_log (activity_type_id);
CREATE INDEX idx_activity_log_days_id ON activity_log (days_id);
CREATE INDEX idx_activity_log_projects ON activity_log USING GIN (projects);

-- Trigger for updated_at
CREATE TRIGGER update_activity_log_updated_at BEFORE UPDATE ON activity_log
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
