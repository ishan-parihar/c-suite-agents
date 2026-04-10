-- Migration 030: Formula Generated Columns (Category A — STORED)
-- Additive migration: replaces Notion formula properties with PostgreSQL
-- GENERATED ALWAYS AS STORED columns.
--
-- Only includes formulas where ALL source columns exist in the current schema
-- AND the expression uses only IMMUTABLE functions on same-row columns.
--
-- Source: .sisyphus/plans/notion-formula-postgres.md (lines 39-228)
-- Date: 2026-04-10

-- ============================================================================
-- months: computed_month_range (NEW column)
-- Plan ref: 3.4 Month Range
-- Source columns: year (INTEGER), month_number (INTEGER) — both exist
-- Existing month_range TEXT is preserved; this is a new daterange column.
-- ============================================================================
ALTER TABLE months
    ADD COLUMN computed_month_range DATERANGE
    GENERATED ALWAYS AS (
        daterange(
            make_date(year, month_number, 1),
            (make_date(year, month_number, 1) + interval '1 month - 1 day')::date,
            '[]'
        )
    ) STORED;

-- ============================================================================
-- weeks: computed_week_range (NEW column)
-- Plan ref: 4.4 Week Range (ISO week calculation)
-- Source columns: year (INTEGER), week_number (INTEGER) — both exist
-- Existing week_range TEXT is preserved; this is a new daterange column.
-- Uses to_date('YYYY-WW', 'IYYY-IW') which returns Monday of the ISO week.
-- ============================================================================
ALTER TABLE weeks
    ADD COLUMN computed_week_range DATERANGE
    GENERATED ALWAYS AS (
        daterange(
            to_date(year || '-' || week_number, 'IYYY-IW'),
            to_date(year || '-' || week_number, 'IYYY-IW') + 6,
            '[]'
        )
    ) STORED;

-- ============================================================================
-- days: day_name (DROP + RECREATE as generated)
-- Plan ref: 5.2 Day Name
-- Source columns: name (TEXT), date (DATE), day_number (INTEGER) — all exist
-- Existing date column is preserved (populated from Notion import).
-- ============================================================================
ALTER TABLE days DROP COLUMN day_name;
ALTER TABLE days
    ADD COLUMN day_name TEXT
    GENERATED ALWAYS AS (
        split_part(name, '20', 2) || to_char(date, '-MM-DD') || '-D' || day_number
    ) STORED;

-- ============================================================================
-- projects: duration_days (DROP + RECREATE as generated)
-- Plan ref: 11.1 Duration
-- Source columns: project_start (TIMESTAMPTZ), deadline (TIMESTAMPTZ) — both exist
-- Produces a human-readable string like "42 days" or "N/A".
-- ============================================================================
ALTER TABLE projects DROP COLUMN duration_days;
ALTER TABLE projects
    ADD COLUMN duration_days TEXT
    GENERATED ALWAYS AS (
        CASE
            WHEN project_start IS NOT NULL AND deadline IS NOT NULL
            THEN (deadline - project_start) || ' days'
            ELSE 'N/A'
        END
    ) STORED;

-- ============================================================================
-- campaigns: duration_days (DROP + RECREATE as generated)
-- Plan ref: 12.1 Duration
-- Source columns: start_date (TIMESTAMPTZ), end_date (TIMESTAMPTZ) — both exist
-- ============================================================================
ALTER TABLE campaigns DROP COLUMN duration_days;
ALTER TABLE campaigns
    ADD COLUMN duration_days INTEGER
    GENERATED ALWAYS AS (
        CASE
            WHEN start_date IS NOT NULL AND end_date IS NOT NULL
            THEN extract(epoch FROM (end_date - start_date))::bigint / 86400
            ELSE NULL
        END
    ) STORED;

-- ============================================================================
-- content_pipeline: engagement_rate (DROP + RECREATE as generated)
-- Plan ref: 13.1 Engagement Rate
-- Source columns: engagement (INTEGER), reach (INTEGER) — both exist
-- ============================================================================
ALTER TABLE content_pipeline DROP COLUMN engagement_rate;
ALTER TABLE content_pipeline
    ADD COLUMN engagement_rate NUMERIC(5,4)
    GENERATED ALWAYS AS (
        CASE
            WHEN reach > 0 THEN engagement::numeric / reach
            ELSE 0
        END
    ) STORED;

-- ============================================================================
-- people: first_name (DROP + RECREATE as generated)
-- Plan ref: 10.1 First Name
-- Source columns: name (TEXT) — exists
-- ============================================================================
ALTER TABLE people DROP COLUMN first_name;
ALTER TABLE people
    ADD COLUMN first_name TEXT
    GENERATED ALWAYS AS (split_part(name, ' ', 1)) STORED;

-- ============================================================================
-- financial_log: transaction_type (DROP + RECREATE as generated)
-- Plan ref: 18.4 Transaction Type
-- Source columns: signed_amount (NUMERIC) — exists
-- ============================================================================
ALTER TABLE financial_log DROP COLUMN transaction_type;
ALTER TABLE financial_log
    ADD COLUMN transaction_type TEXT
    GENERATED ALWAYS AS (
        CASE
            WHEN signed_amount > 0 THEN 'Income'
            ELSE 'Expenses'
        END
    ) STORED;

-- ============================================================================
-- financial_log: is_financial (DROP + RECREATE as generated)
-- Plan ref: 18.5 Is Financial?
-- Source columns: signed_amount (NUMERIC) — exists
-- ============================================================================
ALTER TABLE financial_log DROP COLUMN is_financial;
ALTER TABLE financial_log
    ADD COLUMN is_financial BOOLEAN
    GENERATED ALWAYS AS (signed_amount IS NOT NULL) STORED;

-- ============================================================================
-- financial_log: financial_elater (DROP + RECREATE as generated)
-- Plan ref: 18.3 Financial Relater
-- Source columns: category (TEXT) — exists
-- Note: column name is 'financial_elater' per migration 019 (typo preserved).
-- ============================================================================
ALTER TABLE financial_log DROP COLUMN financial_elater;
ALTER TABLE financial_log
    ADD COLUMN financial_elater TEXT
    GENERATED ALWAYS AS (
        CASE
            WHEN category = 'Pocket Money' THEN 'Father''s Financial Support'
            WHEN category IN ('Investment Income', 'Investments/Trading') THEN 'Trading Account'
            ELSE 'SBI Bank Account'
        END
    ) STORED;

-- ============================================================================
-- directives_risk_log: threat_level (DROP + RECREATE as generated)
-- Plan ref: 20.1 Threat Level
-- Source columns: likelihood (TEXT), impact (TEXT) — both exist
-- 3x3 matrix: High/Medium/Low × High/Medium/Low → 5 levels
-- Note: source columns contain emoji (e.g., '🔴 High') — matching on the text
-- portion which appears after the emoji.
-- ============================================================================
ALTER TABLE directives_risk_log DROP COLUMN threat_level;
ALTER TABLE directives_risk_log
    ADD COLUMN threat_level TEXT
    GENERATED ALWAYS AS (
        CASE
            WHEN likelihood LIKE '%High%' AND impact LIKE '%High%' THEN '5. CRITICAL'
            WHEN likelihood LIKE '%High%' AND impact LIKE '%Medium%' THEN '4. HIGH'
            WHEN likelihood LIKE '%High%' AND impact LIKE '%Low%' THEN '3. MEDIUM'
            WHEN likelihood LIKE '%Medium%' AND impact LIKE '%High%' THEN '4. HIGH'
            WHEN likelihood LIKE '%Medium%' AND impact LIKE '%Medium%' THEN '3. MEDIUM'
            WHEN likelihood LIKE '%Medium%' AND impact LIKE '%Low%' THEN '2. LOW'
            WHEN likelihood LIKE '%Low%' AND impact LIKE '%High%' THEN '3. MEDIUM'
            WHEN likelihood LIKE '%Low%' AND impact LIKE '%Medium%' THEN '2. LOW'
            WHEN likelihood LIKE '%Low%' AND impact LIKE '%Low%' THEN '1. NEGLIGIBLE'
            ELSE '0. UNRATED'
        END
    ) STORED;

-- ============================================================================
-- SKIPPED (source columns do not exist in current schema):
-- ============================================================================
--
-- years: computed_year_range DATERANGE
--   Requires: year_number (INTEGER) — does NOT exist. Only 'name' (TEXT) is
--   available. Parsing year from name is fragile; skip for now.
--
-- quarters: computed_quarter_start TIMESTAMPTZ
--   Requires: quarter_range as daterange or year + quarter_number. quarter_range
--   is TEXT, and 'year' column does NOT exist. Skip.
--
-- quarters: computed_quarter_end TIMESTAMPTZ
--   Same as above. Skip.
--
-- quarters: computed_quarter_name TEXT
--   Requires: quarter_text or year + quarter_number. 'year' does NOT exist. Skip.
--
-- quarters: computed_quarter_range DATERANGE
--   Requires: year (INTEGER) — does NOT exist. Skip.
--
-- months: computed_month_start TIMESTAMPTZ
--   month_start already exists as TIMESTAMPTZ (populated from Notion). Could be
--   generated from month_range, but month_range is TEXT not daterange. Skip.
--
-- months: computed_month_end TIMESTAMPTZ
--   Same as above. Skip.
--
-- months: computed_month_name TEXT
--   Requires: month_text — does NOT exist. Skip.
--
-- weeks: computed_week_start TIMESTAMPTZ
--   week_start already exists as TIMESTAMPTZ (populated from Notion). Could be
--   generated from computed_week_range.lower via a view. Skip here.
--
-- weeks: computed_week_end TIMESTAMPTZ
--   Same as above. Skip.
--
-- weeks: computed_week_name TEXT
--   Requires: week_text — does NOT exist. Parsing from name is fragile. Skip.
--
-- days: computed_date DATE
--   date already exists as DATE (populated from Notion import). Converting to
--   generated would discard imported data. Skip.
--
-- activity_log: activity_type TEXT
--   Plan ref 9.1: parses from title. 'title' maps to 'name' column. However,
--   the specific category mappings (Workout, Shadow Work, etc.) require
--   knowledge of exact title patterns. Requires live data verification. Skip.
--
-- activity_log: is_habit_activity BOOLEAN
--   Plan ref 9.2: depends on activity_type. Skip since activity_type is skipped.
--
-- activity_log: duration_hrs NUMERIC
--   Plan ref 9.3: requires date_start and date_end as separate columns, or
--   date_range as daterange. date_range is TIMESTAMPTZ (single value). Skip.
--
-- activity_log: date_end TIMESTAMPTZ
--   Plan ref 9.4: requires date_range as daterange to extract .upper.
--   date_range is TIMESTAMPTZ. Skip.
--
-- activity_log: activity_notes TEXT
--   Plan ref 9.5: parses from title ('name'). Requires live title patterns. Skip.
--
-- tasks: sprint_status TEXT
--   tasks table migration not in scope for this file (not in 001-024 list).
--   Skip — will be handled in a future migration when tasks table is reviewed.
