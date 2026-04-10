-- Functions: People & Status
-- People summary/engagement, temporal status across hierarchy, unified cross-domain status.
-- Depends on: migrations 001_years, 002_quarters, 003_months, 004_weeks, 005_days, 008_people, 012_projects
-- Agent: OWNER

-- ============================================================================
-- PEOPLE FUNCTIONS
-- ============================================================================

/**
 * fn_people_status_summary(p_id UUID) → JSONB
 *
 * Returns a JSON summary of a person's relationship status, last connected date,
 * engagement metrics, and project involvement.
 *
 * Columns used from people table:
 *   name, relationship_status, last_connected_date, connection_frequency_days,
 *   value_exchange_balance, last_interaction_sentiment, networking_profile,
 *   city, timezone, projects
 */
CREATE OR REPLACE FUNCTION fn_people_status_summary(p_id UUID)
RETURNS JSONB
LANGUAGE SQL STABLE
AS $$
    SELECT jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'first_name', p.first_name,
        'relationship_status', p.relationship_status,
        'last_connected_date', p.last_connected_date,
        'days_since_connected',
            CASE
                WHEN p.last_connected_date IS NULL THEN NULL
                ELSE EXTRACT(DAY FROM (CURRENT_TIMESTAMP - p.last_connected_date))::INTEGER
            END,
        'connection_frequency_days', p.connection_frequency_days,
        'value_exchange_balance', p.value_exchange_balance,
        'last_interaction_sentiment', p.last_interaction_sentiment,
        'networking_profile', p.networking_profile,
        'city', p.city,
        'timezone', p.timezone,
        'project_count', COALESCE(array_length(p.projects, 1), 0),
        'engagement_score', fn_people_engagement_score(p.id)
    )
    FROM people p
    WHERE p.id = p_id;
$$;

-- Index recommendation:
-- CREATE INDEX idx_people_engagement_lookup ON people (id, last_connected_date, connection_frequency_days);

/**
 * fn_people_engagement_score(p_id UUID) → NUMERIC
 *
 * Calculates an engagement score (0–100) by comparing the expected connection
 * frequency with the actual time since last contact.
 *
 * Formula:
 *   days_since = CURRENT_DATE - last_connected_date
 *   expected = connection_frequency_days
 *   ratio = expected / NULLIF(days_since, 0)   -- >1 means overdue
 *   score = LEAST(100, GREATEST(0, ratio * 50))
 *
 * Interpretation:
 *   100 = contacted on time or early (ratio >= 2.0)
 *    50 = contacted exactly on schedule (ratio = 1.0)
 *     0 = haven't connected in 2x+ the expected interval
 *  NULL = missing data (no frequency set or never connected)
 */
CREATE OR REPLACE FUNCTION fn_people_engagement_score(p_id UUID)
RETURNS NUMERIC
LANGUAGE SQL STABLE
AS $$
    SELECT
        CASE
            WHEN p.connection_frequency_days IS NULL
                 OR p.last_connected_date IS NULL
                 OR p.connection_frequency_days <= 0
                THEN NULL
            ELSE
                LEAST(100, GREATEST(0,
                    ROUND(
                        (p.connection_frequency_days::NUMERIC
                         / GREATEST(EXTRACT(DAY FROM (CURRENT_DATE - p.last_connected_date::DATE)), 1)::NUMERIC)
                        * 50,
                        1
                    )
                ))
        END
    FROM people p
    WHERE p.id = p_id;
$$;

-- ============================================================================
-- TEMPORAL STATUS FUNCTIONS (hierarchy)
-- ============================================================================

/**
 * fn_year_status(p_year INTEGER) → TEXT
 *
 * Returns the temporal status of a year relative to the current date.
 *
 * Values: 'Current Year' | 'Next Year' | 'Future Year' | 'Past Year'
 *
 * Index: years table already has idx_years_status
 */
CREATE OR REPLACE FUNCTION fn_year_status(p_year INTEGER)
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
    SELECT
        CASE
            WHEN p_year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER  THEN 'Current Year'
            WHEN p_year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER + 1 THEN 'Next Year'
            WHEN p_year > EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER + 1 THEN 'Future Year'
            ELSE 'Past Year'
        END;
$$;

/**
 * fn_quarter_status(p_quarter_start TIMESTAMPTZ, p_quarter_end TIMESTAMPTZ) → TEXT
 *
 * Returns the temporal status of a quarter relative to the current date.
 *
 * Values: 'Current Quarter' | 'Next Quarter' | 'Future Quarter' | 'Past Quarter'
 *
 * Note: "Next Quarter" is the quarter immediately following the current one.
 * A quarter whose start is in the future but is the immediate next quarter
 * after the current one is labelled 'Next Quarter'; all others are 'Future Quarter'.
 *
 * Index: quarters table already has idx_quarters_status
 */
CREATE OR REPLACE FUNCTION fn_quarter_status(p_quarter_start TIMESTAMPTZ, p_quarter_end TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
    SELECT
        CASE
            WHEN p_quarter_start::DATE <= CURRENT_DATE
                 AND p_quarter_end::DATE >= CURRENT_DATE
                THEN 'Current Quarter'
            WHEN p_quarter_end::DATE < CURRENT_DATE
                THEN 'Past Quarter'
            WHEN p_quarter_start::DATE > CURRENT_DATE
                 AND p_quarter_start::DATE <= (
                     SELECT MAX(q2.quarter_end)::DATE + 1
                     FROM quarters q2
                     WHERE q2.quarter_start::DATE <= CURRENT_DATE
                       AND q2.quarter_end::DATE >= CURRENT_DATE
                 )
                THEN 'Next Quarter'
            ELSE 'Future Quarter'
        END;
$$;

/**
 * fn_month_status(p_month_start TIMESTAMPTZ, p_month_end TIMESTAMPTZ) → TEXT
 *
 * Returns the temporal status of a month relative to the current date.
 *
 * Values: 'Current Month' | 'Past Month' | 'Future Month'
 *
 * Index: months table already has idx_months_status
 */
CREATE OR REPLACE FUNCTION fn_month_status(p_month_start TIMESTAMPTZ, p_month_end TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
    SELECT
        CASE
            WHEN p_month_start::DATE <= CURRENT_DATE
                 AND p_month_end::DATE >= CURRENT_DATE
                THEN 'Current Month'
            WHEN p_month_end::DATE < CURRENT_DATE
                THEN 'Past Month'
            ELSE 'Future Month'
        END;
$$;

/**
 * fn_week_status(p_week_start TIMESTAMPTZ, p_week_end TIMESTAMPTZ) → TEXT
 *
 * Returns the temporal status of a week relative to the current date.
 *
 * Values: 'Current Week' | 'Past Week' | 'Future Week'
 *
 * Index: weeks table already has idx_weeks_status
 */
CREATE OR REPLACE FUNCTION fn_week_status(p_week_start TIMESTAMPTZ, p_week_end TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
    SELECT
        CASE
            WHEN p_week_start::DATE <= CURRENT_DATE
                 AND p_week_end::DATE >= CURRENT_DATE
                THEN 'Current Week'
            WHEN p_week_end::DATE < CURRENT_DATE
                THEN 'Past Week'
            ELSE 'Future Week'
        END;
$$;

/**
 * fn_day_status(p_date DATE) → TEXT
 *
 * Returns the temporal status of a day relative to the current date.
 *
 * Values: 'Today' | 'Past Day' | 'Future Day'
 *
 * Index: days table already has idx_days_status
 */
CREATE OR REPLACE FUNCTION fn_day_status(p_date DATE)
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
    SELECT
        CASE
            WHEN p_date = CURRENT_DATE THEN 'Today'
            WHEN p_date < CURRENT_DATE THEN 'Past Day'
            ELSE 'Future Day'
        END;
$$;

-- ============================================================================
-- CROSS-DOMAIN UNIFIED STATUS FUNCTION
-- ============================================================================

/**
 * fn_temporal_status(p_entity_type TEXT, p_entity_id UUID) → TEXT
 *
 * Unified temporal status function that determines the status for any entity
 * in the temporal hierarchy or related domain.
 *
 * Supported entity types (case-insensitive):
 *   'year'    → looks up years table by id, returns fn_year_status(year_number)
 *   'quarter' → looks up quarters table, returns fn_quarter_status(quarter_start, quarter_end)
 *   'month'   → looks up months table, returns fn_month_status(month_start, month_end)
 *   'week'    → looks up weeks table, returns fn_week_status(week_start, week_end)
 *   'day'     → looks up days table, returns fn_day_status(date)
 *   'project' → returns the stored status column from projects table
 *   'people'  → returns 'People' (people are not temporal; use fn_people_status_summary for details)
 *
 * Returns NULL if entity type is unknown or entity not found.
 *
 * Performance note: this is a dispatch function; each branch hits a different table.
 * For high-throughput scenarios, call the type-specific function directly.
 */
CREATE OR REPLACE FUNCTION fn_temporal_status(p_entity_type TEXT, p_entity_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_status TEXT;
    v_year   INTEGER;
BEGIN
    CASE LOWER(p_entity_type)
        WHEN 'year' THEN
            SELECT year_number INTO v_year FROM years WHERE id = p_entity_id;
            IF v_year IS NOT NULL THEN
                v_status := fn_year_status(v_year);
            END IF;

        WHEN 'quarter' THEN
            SELECT fn_quarter_status(quarter_start, quarter_end)
              INTO v_status
              FROM quarters
             WHERE id = p_entity_id;

        WHEN 'month' THEN
            SELECT fn_month_status(month_start, month_end)
              INTO v_status
              FROM months
             WHERE id = p_entity_id;

        WHEN 'week' THEN
            SELECT fn_week_status(week_start, week_end)
              INTO v_status
              FROM weeks
             WHERE id = p_entity_id;

        WHEN 'day' THEN
            SELECT fn_day_status(date)
              INTO v_status
              FROM days
             WHERE id = p_entity_id;

        WHEN 'project' THEN
            SELECT status
              INTO v_status
              FROM projects
             WHERE id = p_entity_id;

        WHEN 'people', 'person' THEN
            -- People don't have temporal status; return indicator.
            v_status := 'People';

        ELSE
            -- Unknown entity type
            v_status := NULL;
    END CASE;

    RETURN v_status;
END;
$$;

-- Index recommendation for fn_temporal_status lookups:
-- All tables already have primary key indexes on id.
-- Status columns are indexed in each table:
--   idx_years_status, idx_quarters_status, idx_months_status,
--   idx_weeks_status, idx_days_status, idx_projects_status

-- ============================================================================
-- VALIDATION QUERIES (commented out)
-- ============================================================================
-- SELECT fn_year_status(2025), fn_year_status(2026), fn_year_status(2027), fn_year_status(2028);
-- SELECT fn_quarter_status(quarter_start, quarter_end) FROM quarters LIMIT 5;
-- SELECT fn_month_status(month_start, month_end) FROM months LIMIT 5;
-- SELECT fn_week_status(week_start, week_end) FROM weeks LIMIT 5;
-- SELECT fn_day_status(date) FROM days LIMIT 5;
-- SELECT fn_temporal_status('month', m.id), m.month_name FROM months m LIMIT 5;
-- SELECT fn_people_status_summary(p.id) FROM people p LIMIT 3;
-- SELECT id, name, fn_people_engagement_score(id) AS engagement FROM people LIMIT 5;
