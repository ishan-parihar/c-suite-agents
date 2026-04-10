-- Migration 021: directives_risk_log
-- Directive and risk tracking with threat assessment and mitigation relationships.
-- Source: LifeOS Notion database "Directives & Risk Log"
-- Schema: Live Notion (14 properties extracted)
-- Dependencies: quarterly_goals(id), self-relation (mitigates), projects[], systemic_journal[]
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS directives_risk_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 2acc18ce-5aab-8036-95f1-f12d4ddb8056

    -- Title: "Directive / Risk"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" (DRL prefix)
    entry_id        TEXT UNIQUE,

    -- Select: "Log Type" — 🛡️ Directive/🔥 Risk
    log_type        TEXT,

    -- Status: "Status" — Identified/Active/Mitigated/Archived
    status          TEXT NOT NULL DEFAULT 'Identified',

    -- Select: "Likelihood" — 🔴 High/🟡 Medium/🟢 Low
    likelihood      TEXT,

    -- Select: "Impact" — 🔴 High/🟡 Medium/🟢 Low
    impact          TEXT,

    -- Formula: "Threat Level" — formula with emoji: 1-5 CRITICAL/High/Medium/Low/Negligible
    threat_level    TEXT,

    -- Rich Text: "Protocol / Scenario"
    protocol_scenario TEXT,

    -- Date: "Last Assessed"
    last_assessed   TIMESTAMPTZ,

    -- Formula: "DRL_JSON"
    drl_json        TEXT,

    -- Relation: "Projects" (multi)
    projects        UUID[],

    -- Relation: "Quarterly Goals" → quarterly_goals(id)
    quarterly_goal_id UUID REFERENCES quarterly_goals(id),

    -- Relation: "Systemic Journal" (multi)
    systemic_journal UUID[],

    -- Relation: "Mitigates / Mitigated By" (self-relation to other DRL entries)
    mitigates       UUID[],

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drl_entry_id ON directives_risk_log (entry_id);
CREATE INDEX idx_drl_log_type ON directives_risk_log (log_type);
CREATE INDEX idx_drl_status ON directives_risk_log (status);
CREATE INDEX idx_drl_likelihood ON directives_risk_log (likelihood);
CREATE INDEX idx_drl_impact ON directives_risk_log (impact);
CREATE INDEX idx_drl_threat_level ON directives_risk_log (threat_level);
CREATE INDEX idx_drl_last_assessed ON directives_risk_log (last_assessed);
CREATE INDEX idx_drl_quarterly_goal_id ON directives_risk_log (quarterly_goal_id);
CREATE INDEX idx_drl_projects ON directives_risk_log USING GIN (projects);
CREATE INDEX idx_drl_systemic_journal ON directives_risk_log USING GIN (systemic_journal);
CREATE INDEX idx_drl_mitigates ON directives_risk_log USING GIN (mitigates);

-- Trigger for updated_at
CREATE TRIGGER update_directives_risk_log_updated_at BEFORE UPDATE ON directives_risk_log
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
