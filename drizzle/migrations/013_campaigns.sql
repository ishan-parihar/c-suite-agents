-- Migration 013: campaigns
-- Campaign management with platforms, content pipelines, reach metrics, and budgets.
-- Source: LifeOS Notion database "Campaign Management"
-- Schema: Live Notion (24 properties extracted)
-- Agent: OWNER

CREATE TABLE IF NOT EXISTS campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id  UUID NOT NULL,                  -- Notion data_source_id: fd3cc397-61f1-45ab-9586-a7a78457dd15

    -- Title: "Campaign"
    name            TEXT NOT NULL,

    -- Unique ID: "ID" — CAM prefix
    campaign_id     TEXT UNIQUE,

    -- Select: "status" — Planning, Active, Paused, Completed, Archived
    status          TEXT,

    -- Date: "Start Date"
    start_date      TIMESTAMPTZ,

    -- Date: "End Date"
    end_date        TIMESTAMPTZ,

    -- Formula: "Duration" — days from end to start
    duration_days   INTEGER,

    -- Multi-Select: "Platforms" — LinkedIn, Instagram, Twitter/X, Substack, YouTube, TikTok
    platforms       TEXT[],

    -- Multi-Select: "Content Types" — Carousels, Essays, Threads, Case Studies, Videos, Reels
    content_types   TEXT[],

    -- Multi-Select: "Automation Workflows"
    automation_workflows TEXT[],

    -- Select: "Content Frequency" — Daily, 3x/week, Weekly
    content_frequency TEXT,

    -- Rich Text: "Theme"
    theme           TEXT,

    -- Rich Text: "Summary"
    summary         TEXT,

    -- Rich Text: "Demographics"
    demographics    TEXT,

    -- Rich Text: "Psychographics"
    psychographics  TEXT,

    -- Rich Text: "SEO Keywords"
    seo_keywords    TEXT,

    -- Rich Text: "Content Waterfall"
    content_waterfall TEXT,

    -- Number: "Target Reach"
    target_reach    INTEGER,

    -- Number: "Actual Reach"
    actual_reach    INTEGER,

    -- Number: "Engagement Rate" — percent format (0.05 for 5%)
    engagement_rate NUMERIC(5,4),

    -- Number: "Conversion Rate" — percent format
    conversion_rate NUMERIC(5,4),

    -- Number: "Viral Score"
    viral_score     INTEGER,

    -- Number: "budget_allocated"
    budget_allocated NUMERIC(12,2),

    -- Relation: "Projects" → projects[]
    projects        UUID[],

    -- Relation: "Content Pipeline" → content_pipeline[]
    content_pipeline UUID[],

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_status ON campaigns (status);
CREATE INDEX idx_campaigns_start_date ON campaigns (start_date);
CREATE INDEX idx_campaigns_end_date ON campaigns (end_date);
CREATE INDEX idx_campaigns_content_frequency ON campaigns (content_frequency);
CREATE INDEX idx_campaigns_platforms ON campaigns USING GIN (platforms);
CREATE INDEX idx_campaigns_content_types ON campaigns USING GIN (content_types);
CREATE INDEX idx_campaigns_automation_workflows ON campaigns USING GIN (automation_workflows);
CREATE INDEX idx_campaigns_projects ON campaigns USING GIN (projects);
CREATE INDEX idx_campaigns_content_pipeline ON campaigns USING GIN (content_pipeline);

-- Trigger for updated_at
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
