-- Migration 016: relational_journal
-- Interpersonal interaction tracking with people, sentiment, and follow-up flags.
-- Source: LifeOS Notion database "Relational Journal"
-- Schema: Live Notion (10 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS relational_journal (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 211c18ce-5aab-8044-af90-000b961bb329

    -- Title: "Name"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" — REL prefix
    entry_id        TEXT UNIQUE,

    -- Date: "Date"
    date            TIMESTAMPTZ,

    -- Relation: "Days" → days
    days_id         UUID REFERENCES days(id),

    -- Relation: "People" → people
    people_id       UUID REFERENCES people(id),

    -- Select: "interaction_type" — 1:1 Call, Meeting, Text, Email, Event, Group
    interaction_type TEXT,

    -- Select: "sentiment" — Positive, Neutral, Tense, Negative
    sentiment       TEXT,

    -- Checkbox: "follow_up_needed"
    follow_up_needed BOOLEAN,

    -- Rollup: "Relationship Status" — from People
    relationship_status TEXT[],

    -- Formula: "Relational_JSON"
    relational_json TEXT,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_relational_journal_date ON relational_journal (date);
CREATE INDEX idx_relational_journal_days_id ON relational_journal (days_id);
CREATE INDEX idx_relational_journal_people_id ON relational_journal (people_id);
CREATE INDEX idx_relational_journal_interaction_type ON relational_journal (interaction_type);
CREATE INDEX idx_relational_journal_sentiment ON relational_journal (sentiment);
CREATE INDEX idx_relational_journal_relationship_status ON relational_journal USING GIN (relationship_status);

-- Trigger for updated_at
CREATE TRIGGER update_relational_journal_updated_at BEFORE UPDATE ON relational_journal
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
