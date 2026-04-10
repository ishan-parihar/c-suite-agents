-- Migration 028: agent_sessions
-- Agent session tracking, messages, and tool calls for runtime conversation history.
-- Source: Operant Agent Runtime subsystem
-- Dependencies: none
-- Agent: OWNER

-- ── agent_sessions ──

CREATE TABLE IF NOT EXISTS agent_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            TEXT NOT NULL,
    chat_id             TEXT NOT NULL,
    session_id          TEXT UNIQUE,
    title               TEXT,
    workspace_path      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used           TIMESTAMPTZ,
    message_count       INTEGER NOT NULL DEFAULT 0,
    compaction_count    INTEGER NOT NULL DEFAULT 0,
    previous_summary    TEXT,
    has_real_conversation BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_agent_sessions_agent_id ON agent_sessions (agent_id);
CREATE INDEX idx_agent_sessions_chat_id ON agent_sessions (chat_id);
CREATE INDEX idx_agent_sessions_session_id ON agent_sessions (session_id);
CREATE INDEX idx_agent_sessions_created_at ON agent_sessions (created_at);
CREATE INDEX idx_agent_sessions_last_used ON agent_sessions (last_used);

-- Trigger for updated_at (using last_used as the effective updated_at)
CREATE TRIGGER update_agent_sessions_last_used BEFORE UPDATE ON agent_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── session_messages ──

CREATE TABLE IF NOT EXISTS session_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES agent_sessions(id),
    message_index   INTEGER NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    token_estimate  INTEGER,
    is_summary      BOOLEAN NOT NULL DEFAULT false,
    compacted       BOOLEAN NOT NULL DEFAULT false,
    timestamp       TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_session_messages_session_id ON session_messages (session_id);
CREATE INDEX idx_session_messages_message_index ON session_messages (session_id, message_index);
CREATE INDEX idx_session_messages_role ON session_messages (role);
CREATE INDEX idx_session_messages_compacted ON session_messages (compacted);
CREATE INDEX idx_session_messages_timestamp ON session_messages (timestamp);

-- ── session_tool_calls ──

CREATE TABLE IF NOT EXISTS session_tool_calls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES agent_sessions(id),
    tool_index      INTEGER NOT NULL,
    call_id         TEXT,
    name            TEXT NOT NULL,
    arguments       JSONB,
    result          JSONB,
    token_estimate  INTEGER,
    compacted       BOOLEAN NOT NULL DEFAULT false,
    timestamp       TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_session_tool_calls_session_id ON session_tool_calls (session_id);
CREATE INDEX idx_session_tool_calls_tool_index ON session_tool_calls (session_id, tool_index);
CREATE INDEX idx_session_tool_calls_name ON session_tool_calls (name);
CREATE INDEX idx_session_tool_calls_compacted ON session_tool_calls (compacted);
CREATE INDEX idx_session_tool_calls_timestamp ON session_tool_calls (timestamp);
