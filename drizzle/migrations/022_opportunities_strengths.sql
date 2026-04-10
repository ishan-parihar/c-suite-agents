-- Migration 022: opportunities_strengths
-- Opportunity and strength tracking with activation dates and synergy relationships.
-- Source: LifeOS Notion database "Opportunities & Strengths"
-- Schema: Live Notion (12 properties extracted)
-- Dependencies: quarterly_goals(id), self-relation (synergizes_with), projects[], systemic_journal[]
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS opportunities_strengths (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 2acc18ce-5aab-80f8-b13b-f5e18b1b5272

    -- Title: "Opportunity / Strength"
    name            TEXT NOT NULL,

    -- Select: "Log Type" — 💡 Opportunity/💪 Strength
    log_type        TEXT,

    -- Status: "Status" — 💡 Identified/✅ Activated/🏆 Capitalized/🧊 Archived
    status          TEXT NOT NULL DEFAULT '💡 Identified',

    -- Select: "Leverage Score" — 🌱 Seed/📈 Medium-Impact/🚀 High-Leverage
    leverage_score  TEXT,

    -- Select: "opportunity_type" — Market/Technology/Partnership/Talent/Capital/Competitive
    opportunity_type TEXT,

    -- Rich Text: "Description & Activation"
    description     TEXT,

    -- Date: "Last Assessed"
    last_assessed   TIMESTAMPTZ,

    -- Date: "activation_date"
    activation_date TIMESTAMPTZ,

    -- Relation: "Projects" (multi)
    projects        UUID[],

    -- Relation: "Quarterly Goals" → quarterly_goals(id)
    quarterly_goal_id UUID REFERENCES quarterly_goals(id),

    -- Relation: "Systemic Journal" (multi)
    systemic_journal UUID[],

    -- Relation: "Synergizes With" (self-relation to other opportunity/strength entries)
    synergizes_with UUID[],

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_os_log_type ON opportunities_strengths (log_type);
CREATE INDEX idx_os_status ON opportunities_strengths (status);
CREATE INDEX idx_os_leverage_score ON opportunities_strengths (leverage_score);
CREATE INDEX idx_os_opportunity_type ON opportunities_strengths (opportunity_type);
CREATE INDEX idx_os_last_assessed ON opportunities_strengths (last_assessed);
CREATE INDEX idx_os_activation_date ON opportunities_strengths (activation_date);
CREATE INDEX idx_os_quarterly_goal_id ON opportunities_strengths (quarterly_goal_id);
CREATE INDEX idx_os_projects ON opportunities_strengths USING GIN (projects);
CREATE INDEX idx_os_systemic_journal ON opportunities_strengths USING GIN (systemic_journal);
CREATE INDEX idx_os_synergizes_with ON opportunities_strengths USING GIN (synergizes_with);

-- Trigger for updated_at
CREATE TRIGGER update_opportunities_strengths_updated_at BEFORE UPDATE ON opportunities_strengths
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
