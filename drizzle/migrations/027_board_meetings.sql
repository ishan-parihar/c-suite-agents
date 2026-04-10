-- Migration 027: board_meetings
-- Board meeting records, turns, and per-agent responses for governance meetings.
-- Source: Operant Board Meetings subsystem
-- Dependencies: none
-- Agent: OWNER

-- ── board_meetings ──

CREATE TABLE IF NOT EXISTS board_meetings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date            TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'scheduled',
    objective       TEXT,
    report          TEXT,
    user_decision   TEXT,
    user_feedback   TEXT,
    started_at      TIMESTAMPTZ,
    concluded_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_board_meetings_date ON board_meetings (date);
CREATE INDEX idx_board_meetings_status ON board_meetings (status);

-- ── board_meeting_turns ──

CREATE TABLE IF NOT EXISTS board_meeting_turns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id      UUID NOT NULL REFERENCES board_meetings(id),
    turn_number     INTEGER NOT NULL,
    ceo_directive   TEXT,
    ceo_response    TEXT,
    synthesis       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_board_meeting_turns_meeting_id ON board_meeting_turns (meeting_id);
CREATE INDEX idx_board_meeting_turns_turn_number ON board_meeting_turns (turn_number);

-- ── board_meeting_responses ──

CREATE TABLE IF NOT EXISTS board_meeting_responses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id          UUID NOT NULL REFERENCES board_meetings(id),
    turn_number         INTEGER NOT NULL,
    agent_id            TEXT NOT NULL,
    content             TEXT NOT NULL,
    tool_calls_made     INTEGER NOT NULL DEFAULT 0,
    tool_calls_details  JSONB,
    timestamp           TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_board_meeting_responses_meeting_id ON board_meeting_responses (meeting_id);
CREATE INDEX idx_board_meeting_responses_turn_number ON board_meeting_responses (turn_number);
CREATE INDEX idx_board_meeting_responses_agent_id ON board_meeting_responses (agent_id);
CREATE INDEX idx_board_meeting_responses_timestamp ON board_meeting_responses (timestamp);
