-- Migration 025: kanban
-- Kanban boards, columns, cards, activity tracking, and reporting lines for agent task management.
-- Source: Operant Kanban subsystem
-- Dependencies: projects(id)
-- Agent: OWNER

-- ── kanban_boards ──

CREATE TABLE IF NOT EXISTS kanban_boards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT NOT NULL,
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kanban_boards_agent_id ON kanban_boards (agent_id);

-- ── kanban_columns ──

CREATE TABLE IF NOT EXISTS kanban_columns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id        UUID NOT NULL REFERENCES kanban_boards(id),
    name            TEXT NOT NULL,
    ord             INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kanban_columns_board_id ON kanban_columns (board_id);
CREATE INDEX idx_kanban_columns_ord ON kanban_columns (ord);

-- ── kanban_cards ──

CREATE TABLE IF NOT EXISTS kanban_cards (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id            UUID NOT NULL REFERENCES kanban_boards(id),
    column_id           UUID NOT NULL REFERENCES kanban_columns(id),
    title               TEXT NOT NULL,
    description         TEXT,
    priority            TEXT,
    due                 TIMESTAMPTZ,
    tags                JSONB,
    assignee_agent_id   TEXT,
    project_id          UUID REFERENCES projects(id),
    last_update         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kanban_cards_board_id ON kanban_cards (board_id);
CREATE INDEX idx_kanban_cards_column_id ON kanban_cards (column_id);
CREATE INDEX idx_kanban_cards_priority ON kanban_cards (priority);
CREATE INDEX idx_kanban_cards_assignee_agent_id ON kanban_cards (assignee_agent_id);
CREATE INDEX idx_kanban_cards_project_id ON kanban_cards (project_id);
CREATE INDEX idx_kanban_cards_due ON kanban_cards (due);
CREATE INDEX idx_kanban_cards_tags ON kanban_cards USING GIN (tags);

-- ── kanban_card_activity ──

CREATE TABLE IF NOT EXISTS kanban_card_activity (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id         UUID NOT NULL REFERENCES kanban_cards(id),
    ts              TIMESTAMPTZ NOT NULL,
    action          TEXT NOT NULL,
    payload         JSONB
);

CREATE INDEX idx_kanban_card_activity_card_id ON kanban_card_activity (card_id);
CREATE INDEX idx_kanban_card_activity_ts ON kanban_card_activity (ts);
CREATE INDEX idx_kanban_card_activity_action ON kanban_card_activity (action);

-- ── kanban_reporting_lines ──

CREATE TABLE IF NOT EXISTS kanban_reporting_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id      TEXT NOT NULL,
    report_id       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kanban_reporting_lines_manager_id ON kanban_reporting_lines (manager_id);
CREATE INDEX idx_kanban_reporting_lines_report_id ON kanban_reporting_lines (report_id);
