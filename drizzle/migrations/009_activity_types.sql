-- Migration 009: activity_types
-- Defines reusable activity templates with frequency, duration, and health tracking.
-- Source: LifeOS Notion database "Activity Types"
-- Schema: Live Notion (8 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS activity_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 211c18ce-5aab-8052-8f28-000ba8e8d3b7

    -- Title: "Activity Types"
    name            TEXT NOT NULL,

    -- Relation: "Activity Log" → activity_log[]
    activity_log    UUID[],

    -- Select: "Frequency" — Once every Week, 4 Times a Day, Twice Every Week, Every Day, Once every 4 days
    frequency       TEXT,

    -- Number: "Duration (in hrs)"
    duration_hrs    NUMERIC(4,1),

    -- Number: "target_per_week"
    target_per_week INTEGER,

    -- Checkbox: "Habit"
    is_habit        BOOLEAN,

    -- Checkbox: "is_health_tracked"
    is_health_tracked BOOLEAN,

    -- Select: "category" — Exercise, Recovery, Nutrition, Work, Mindfulness, Social, Chore, Commute, Entertainment, Learning
    category        TEXT,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_types_category ON activity_types (category);
CREATE INDEX idx_activity_types_frequency ON activity_types (frequency);
CREATE INDEX idx_activity_types_activity_log ON activity_types USING GIN (activity_log);

-- Trigger for updated_at
CREATE TRIGGER update_activity_types_updated_at BEFORE UPDATE ON activity_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
