-- Migration 008: people
-- Relationship CRM database. No dependencies on temporal hierarchy.
-- Source: LifeOS Notion database "People"
-- Schema: Live Notion (33 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS people (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,

    name            TEXT NOT NULL,

    first_name      TEXT,

    custom_name     TEXT,

    summary         TEXT,

    strategic_context TEXT,

    engagement_blueprint TEXT,

    professional_domain TEXT,

    origin_context  TEXT,

    key_personal_intel TEXT,

    email           TEXT,

    connection_frequency_days INTEGER,

    last_connected_date TIMESTAMPTZ,

    reconnect_by    TEXT,

    networking_profile TEXT,

    relationship_status TEXT,

    value_exchange_balance TEXT,

    core_shadow     TEXT,

    developmental_altitude TEXT,

    aspirational_drive TEXT,

    temporal_focus  TEXT,

    primary_center_of_intelligence TEXT,

    dominant_power_strategy TEXT,

    city            TEXT,

    primary_conflict_style TEXT,

    timezone        TEXT,

    desired_trajectory TEXT,

    stability_profile TEXT,

    last_interaction_sentiment TEXT,

    explanatory_style TEXT,

    influence_toolkit TEXT[],

    community_id    UUID,

    stories         UUID[],

    projects        UUID[],

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_people_networking_profile ON people (networking_profile);
CREATE INDEX idx_people_relationship_status ON people (relationship_status);
CREATE INDEX idx_people_value_exchange_balance ON people (value_exchange_balance);
CREATE INDEX idx_people_desired_trajectory ON people (desired_trajectory);
CREATE INDEX idx_people_city ON people (city);
CREATE INDEX idx_people_timezone ON people (timezone);
CREATE INDEX idx_people_last_connected_date ON people (last_connected_date);
CREATE INDEX idx_people_community_id ON people (community_id);
CREATE INDEX idx_people_stories ON people USING GIN (stories);
CREATE INDEX idx_people_projects ON people USING GIN (projects);
CREATE INDEX idx_people_influence_toolkit ON people USING GIN (influence_toolkit);
CREATE INDEX idx_people_dominant_power_strategy ON people (dominant_power_strategy);
CREATE INDEX idx_people_primary_conflict_style ON people (primary_conflict_style);
CREATE INDEX idx_people_explanatory_style ON people (explanatory_style);

CREATE TRIGGER update_people_updated_at BEFORE UPDATE ON people
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
