-- Migration 006: annual_goals
-- Strategic goals linked to years. Depends on 001_years.
-- Source: LifeOS Notion database "Annual Goals"
-- Schema: Live Notion (19 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS annual_goals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,

    name            TEXT NOT NULL,

    goal_id         TEXT UNIQUE,

    years_id        UUID REFERENCES years(id),

    primary_metric_id UUID,

    vision_id       UUID,

    quarterly_goals UUID[],

    status          TEXT NOT NULL DEFAULT 'Draft',

    goal_archetype  TEXT,

    is_current_goal BOOLEAN,

    goal_progress   TEXT,

    monitor         TEXT,

    annual_goal_report TEXT,

    planned_range   TEXT,

    the_epic        TEXT,

    strategic_intent TEXT,

    strategic_approach TEXT,

    success_condition TEXT,

    key_risks       TEXT,

    target_value    TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_annual_goals_status ON annual_goals (status);
CREATE INDEX idx_annual_goals_years_id ON annual_goals (years_id);
CREATE INDEX idx_annual_goals_goal_id ON annual_goals (goal_id);
CREATE INDEX idx_annual_goals_vision_id ON annual_goals (vision_id);
CREATE INDEX idx_annual_goals_primary_metric_id ON annual_goals (primary_metric_id);
CREATE INDEX idx_annual_goals_quarterly_goals ON annual_goals USING GIN (quarterly_goals);
CREATE INDEX idx_annual_goals_goal_archetype ON annual_goals (goal_archetype);
CREATE INDEX idx_annual_goals_is_current_goal ON annual_goals (is_current_goal);

CREATE TRIGGER update_annual_goals_updated_at BEFORE UPDATE ON annual_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
