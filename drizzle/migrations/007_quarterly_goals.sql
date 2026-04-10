-- Migration 007: quarterly_goals
-- Tactical goals linked to annual goals and quarters. Depends on 006_annual_goals, 002_quarters.
-- Source: LifeOS Notion database "Quarterly Goals"
-- Schema: Live Notion (19 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS quarterly_goals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,

    name            TEXT NOT NULL,

    goal_id         TEXT UNIQUE,

    annual_goal_id  UUID REFERENCES annual_goals(id),

    quarters        UUID[],

    projects        UUID[],

    directives_risk_log UUID[],

    opportunities_strengths UUID[],

    status          TEXT NOT NULL DEFAULT 'Planning',

    is_current_goal BOOLEAN,

    goal_progress   TEXT,

    progress        NUMERIC(5,2),

    health          TEXT,

    monitor         TEXT,

    planned_range   TEXT,

    quarterly_goal_json TEXT,

    key_result_1    TEXT,

    key_result_2    TEXT,

    key_result_3    TEXT,

    key_learning    TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quarterly_goals_status ON quarterly_goals (status);
CREATE INDEX idx_quarterly_goals_annual_goal_id ON quarterly_goals (annual_goal_id);
CREATE INDEX idx_quarterly_goals_goal_id ON quarterly_goals (goal_id);
CREATE INDEX idx_quarterly_goals_progress ON quarterly_goals (progress);
CREATE INDEX idx_quarterly_goals_quarters ON quarterly_goals USING GIN (quarters);
CREATE INDEX idx_quarterly_goals_projects ON quarterly_goals USING GIN (projects);
CREATE INDEX idx_quarterly_goals_directives_risk_log ON quarterly_goals USING GIN (directives_risk_log);
CREATE INDEX idx_quarterly_goals_opportunities_strengths ON quarterly_goals USING GIN (opportunities_strengths);
CREATE INDEX idx_quarterly_goals_is_current_goal ON quarterly_goals (is_current_goal);

CREATE TRIGGER update_quarterly_goals_updated_at BEFORE UPDATE ON quarterly_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
