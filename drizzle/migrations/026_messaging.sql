-- Migration 026: messaging
-- Async message threads, messages, and escalations for inter-agent communication.
-- Source: Operant Organic Messaging subsystem
-- Dependencies: none
-- Agent: OWNER

-- ── message_threads ──

CREATE TABLE IF NOT EXISTS message_threads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participants    JSONB NOT NULL,
    subject         TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    tags            JSONB,
    summary         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_threads_status ON message_threads (status);
CREATE INDEX idx_message_threads_participants ON message_threads USING GIN (participants);
CREATE INDEX idx_message_threads_tags ON message_threads USING GIN (tags);

-- Trigger for updated_at
CREATE TRIGGER update_message_threads_updated_at BEFORE UPDATE ON message_threads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── messages ──

CREATE TABLE IF NOT EXISTS messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id           UUID NOT NULL REFERENCES message_threads(id),
    from_agent          TEXT NOT NULL,
    to_agent            TEXT NOT NULL,
    content             TEXT NOT NULL,
    priority            TEXT NOT NULL DEFAULT 'P3',
    requires_response   BOOLEAN NOT NULL DEFAULT false,
    responded           BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read                BOOLEAN NOT NULL DEFAULT false,
    tags                JSONB,
    embedding           JSONB
);

CREATE INDEX idx_messages_thread_id ON messages (thread_id);
CREATE INDEX idx_messages_from_agent ON messages (from_agent);
CREATE INDEX idx_messages_to_agent ON messages (to_agent);
CREATE INDEX idx_messages_priority ON messages (priority);
CREATE INDEX idx_messages_created_at ON messages (created_at);
CREATE INDEX idx_messages_requires_response ON messages (requires_response);
CREATE INDEX idx_messages_responded ON messages (responded);
CREATE INDEX idx_messages_tags ON messages USING GIN (tags);

-- ── message_escalations ──

CREATE TABLE IF NOT EXISTS message_escalations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id       UUID NOT NULL REFERENCES message_threads(id),
    from_agent      TEXT NOT NULL,
    to_agent        TEXT NOT NULL,
    reason          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX idx_message_escalations_thread_id ON message_escalations (thread_id);
CREATE INDEX idx_message_escalations_from_agent ON message_escalations (from_agent);
CREATE INDEX idx_message_escalations_to_agent ON message_escalations (to_agent);
CREATE INDEX idx_message_escalations_status ON message_escalations (status);
CREATE INDEX idx_message_escalations_created_at ON message_escalations (created_at);
