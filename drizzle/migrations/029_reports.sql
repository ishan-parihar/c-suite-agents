-- Migration 029: reports
-- Operational reports, sessions, session steps, tool correlations, and OC session tracking.
-- Source: Operant Operational Resilience subsystem
-- Dependencies: none
-- Agent: OWNER

-- ── ops_reports ──

CREATE TABLE IF NOT EXISTS ops_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT NOT NULL,
    period          TEXT,
    summary         TEXT,
    metrics         JSONB,
    actions         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ops_reports_agent_id ON ops_reports (agent_id);
CREATE INDEX idx_ops_reports_period ON ops_reports (period);
CREATE INDEX idx_ops_reports_created_at ON ops_reports (created_at);

-- ── ops_sessions ──

CREATE TABLE IF NOT EXISTS ops_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT NOT NULL,
    chat_id         TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX idx_ops_sessions_agent_id ON ops_sessions (agent_id);
CREATE INDEX idx_ops_sessions_chat_id ON ops_sessions (chat_id);
CREATE INDEX idx_ops_sessions_status ON ops_sessions (status);
CREATE INDEX idx_ops_sessions_started_at ON ops_sessions (started_at);
CREATE INDEX idx_ops_sessions_last_active ON ops_sessions (last_active);

-- ── session_steps ──

CREATE TABLE IF NOT EXISTS session_steps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES ops_sessions(id),
    step_num        INTEGER NOT NULL,
    step_type       TEXT NOT NULL,
    tool            TEXT,
    args_hash       TEXT,
    obs_summary     TEXT,
    ts              TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_session_steps_session_id ON session_steps (session_id);
CREATE INDEX idx_session_steps_step_num ON session_steps (session_id, step_num);
CREATE INDEX idx_session_steps_step_type ON session_steps (step_type);
CREATE INDEX idx_session_steps_tool ON session_steps (tool);
CREATE INDEX idx_session_steps_ts ON session_steps (ts);

-- ── tool_correlations ──

CREATE TABLE IF NOT EXISTS tool_correlations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool            TEXT NOT NULL,
    args_hash       TEXT NOT NULL,
    result          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_correlations_tool ON tool_correlations (tool);
CREATE INDEX idx_tool_correlations_args_hash ON tool_correlations (args_hash);
CREATE INDEX idx_tool_correlations_created_at ON tool_correlations (created_at);

-- ── oc_sessions ──

CREATE TABLE IF NOT EXISTS oc_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id         TEXT NOT NULL,
    agent_id        TEXT NOT NULL,
    oc_session_id   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oc_sessions_chat_id ON oc_sessions (chat_id);
CREATE INDEX idx_oc_sessions_agent_id ON oc_sessions (agent_id);
CREATE INDEX idx_oc_sessions_oc_session_id ON oc_sessions (oc_session_id);
CREATE INDEX idx_oc_sessions_created_at ON oc_sessions (created_at);

-- Trigger for updated_at
CREATE TRIGGER update_oc_sessions_updated_at BEFORE UPDATE ON oc_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
