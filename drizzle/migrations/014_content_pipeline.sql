-- Migration 014: content_pipeline
-- Content creation pipeline with status workflow, publishing, and campaign linkage.
-- Source: LifeOS Notion database "Content Pipeline"
-- Schema: Live Notion (23 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS content_pipeline (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: 2e0c18ce-5aab-818f-add2-000b61669013

    -- Title: "Content Name"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" — CC prefix
    content_id      TEXT UNIQUE,

    -- Status: "Status" — Potential Idea, Scheduled, Next Up, Writing, Recording, Editing, Ready to Post, Published
    status          TEXT NOT NULL DEFAULT 'Potential Idea',

    -- Select: "Pillar" — P1: Meta-Theory, P2: AI Consulting, P3: LifeOS, P5: Counselling, P5: Activism
    pillar          TEXT,

    -- Select: "Funnel Stage" — TOFU, MOFU, BOFU
    funnel_stage    TEXT,

    -- Select: "Tone" — Intellectual, Authentic/Vulnerable, Practical/How-to, Analytic, Urgent
    tone            TEXT,

    -- Multi-Select: "Platforms" — YouTube, Facebook, Instagram, X (Twitter), Threads, LinkedIn, Blog, Medium, Substack
    platforms       TEXT[],

    -- Multi-Select: "Format" — 45-90 Sec Reel, 5-10 Min Video, 30-60 Min Podcast, Blog, Newsletter, FB/Linkedin/X Post
    format          TEXT[],

    -- Checkbox: "evergreen"
    is_evergreen    BOOLEAN,

    -- Date: "Action Date"
    action_date     TIMESTAMPTZ,

    -- Date: "Publish Date"
    publish_date    TIMESTAMPTZ,

    -- Relation: "Parent Content" → content_pipeline (self-referencing)
    parent_content_id UUID REFERENCES content_pipeline(id),

    -- Relation: "Child Content" → content_pipeline[]
    child_content   UUID[],

    -- Relation: "Campaigns" → campaigns
    campaign_id     UUID REFERENCES campaigns(id),

    -- Rollup: "Projects" → projects[]
    projects        UUID[],

    -- Rich Text: "topic_hook"
    topic_hook      TEXT,

    -- Rich Text: "Content Body"
    content_body    TEXT,

    -- URL: "Live URL"
    live_url        TEXT,

    -- Files: "Media Assets"
    media_assets    JSONB,

    -- Number: "Reach"
    reach           INTEGER,

    -- Number: "Engagement"
    engagement      INTEGER,

    -- Number: "Clicks"
    clicks          INTEGER,

    -- Formula: "Engagement Rate" — engagement / reach
    engagement_rate NUMERIC(5,4),

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_pipeline_status ON content_pipeline (status);
CREATE INDEX idx_content_pipeline_pillar ON content_pipeline (pillar);
CREATE INDEX idx_content_pipeline_funnel_stage ON content_pipeline (funnel_stage);
CREATE INDEX idx_content_pipeline_publish_date ON content_pipeline (publish_date);
CREATE INDEX idx_content_pipeline_parent_content_id ON content_pipeline (parent_content_id);
CREATE INDEX idx_content_pipeline_campaign_id ON content_pipeline (campaign_id);
CREATE INDEX idx_content_pipeline_platforms ON content_pipeline USING GIN (platforms);
CREATE INDEX idx_content_pipeline_format ON content_pipeline USING GIN (format);
CREATE INDEX idx_content_pipeline_child_content ON content_pipeline USING GIN (child_content);
CREATE INDEX idx_content_pipeline_projects ON content_pipeline USING GIN (projects);

-- Trigger for updated_at
CREATE TRIGGER update_content_pipeline_updated_at BEFORE UPDATE ON content_pipeline
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
