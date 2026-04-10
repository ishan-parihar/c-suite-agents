-- ============================================================================
-- Financial Rollup Functions
-- ============================================================================
-- Provenance:
--   Source: Notion rollup formulas (LifeOS Financial Log → Weeks/Months/Quarters)
--   Plan:   .sisyphus/plans/notion-formula-postgres.md (Phase 2, rows 254-313)
--   Author: Sisyphus-Junior (OhMyOpenCode)
--   Date:   2026-04-10
--
-- Purpose:
--   Replace Notion rollup formulas with PostgreSQL STABLE functions that
--   compute financial aggregates across the temporal hierarchy (weeks →
--   months → quarters) and project dimension.
--
-- Convention:
--   Income = signed_amount > 0
--   Expenses = signed_amount < 0 (returned as positive for readability)
--   Net Cashflow = SUM(signed_amount) — positive = net gain, negative = net loss
--
-- Index recommendations (already created in migration 019, listed for reference):
--   CREATE INDEX idx_financial_log_week_id    ON financial_log (week_id);
--   CREATE INDEX idx_financial_log_month_id   ON financial_log (month_id);
--   CREATE INDEX idx_financial_log_project_id ON financial_log (project_id);
--   CREATE INDEX idx_financial_log_category   ON financial_log (category);
--   CREATE INDEX idx_financial_log_signed_amount ON financial_log (signed_amount);
-- ============================================================================

-- ============================================================================
-- Week-level rollups (3 functions)
-- Replaces Notion formulas: Week Total Income, Total Expenses, Net Cashflow
-- ============================================================================

-- Get total income for a given week
CREATE OR REPLACE FUNCTION fn_week_income(p_week_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(signed_amount), 0)
  FROM financial_log
  WHERE week_id = p_week_id AND signed_amount > 0;
$$ LANGUAGE SQL STABLE;

-- Get total expenses for a given week (returned as positive value)
CREATE OR REPLACE FUNCTION fn_week_expenses(p_week_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(ABS(signed_amount)), 0)
  FROM financial_log
  WHERE week_id = p_week_id AND signed_amount < 0;
$$ LANGUAGE SQL STABLE;

-- Get net cashflow for a given week (income + expenses, signed)
CREATE OR REPLACE FUNCTION fn_week_net_cashflow(p_week_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(signed_amount), 0)
  FROM financial_log
  WHERE week_id = p_week_id;
$$ LANGUAGE SQL STABLE;

-- ============================================================================
-- Month-level rollups (3 functions)
-- Replaces Notion formulas: Month Total Income, Total Expenses, Net Cashflow
-- ============================================================================

-- Get total income for a given month
CREATE OR REPLACE FUNCTION fn_month_income(p_month_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(signed_amount), 0)
  FROM financial_log
  WHERE month_id = p_month_id AND signed_amount > 0;
$$ LANGUAGE SQL STABLE;

-- Get total expenses for a given month (returned as positive value)
CREATE OR REPLACE FUNCTION fn_month_expenses(p_month_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(ABS(signed_amount)), 0)
  FROM financial_log
  WHERE month_id = p_month_id AND signed_amount < 0;
$$ LANGUAGE SQL STABLE;

-- Get net cashflow for a given month (income + expenses, signed)
CREATE OR REPLACE FUNCTION fn_month_net_cashflow(p_month_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(signed_amount), 0)
  FROM financial_log
  WHERE month_id = p_month_id;
$$ LANGUAGE SQL STABLE;

-- ============================================================================
-- Quarter-level rollups (3 functions)
-- Replaces Notion formulas: Quarter Total Income, Total Expenses, Net Cashflow
-- ============================================================================

-- Get total income for a given quarter (via months → financial_log)
CREATE OR REPLACE FUNCTION fn_quarter_income(p_quarter_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(fl.signed_amount), 0)
  FROM financial_log fl
  JOIN months m ON fl.month_id = m.id
  WHERE m.quarters_id = p_quarter_id AND fl.signed_amount > 0;
$$ LANGUAGE SQL STABLE;

-- Get total expenses for a given quarter (via months → financial_log, positive)
CREATE OR REPLACE FUNCTION fn_quarter_expenses(p_quarter_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(ABS(fl.signed_amount)), 0)
  FROM financial_log fl
  JOIN months m ON fl.month_id = m.id
  WHERE m.quarters_id = p_quarter_id AND fl.signed_amount < 0;
$$ LANGUAGE SQL STABLE;

-- Get net cashflow for a given quarter (via months → financial_log, signed)
CREATE OR REPLACE FUNCTION fn_quarter_net_cashflow(p_quarter_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(fl.signed_amount), 0)
  FROM financial_log fl
  JOIN months m ON fl.month_id = m.id
  WHERE m.quarters_id = p_quarter_id;
$$ LANGUAGE SQL STABLE;

-- ============================================================================
-- Category summary (1 function)
-- Replaces Notion formula: Month Category Summary
-- ============================================================================

-- Get a JSON object mapping each category to its total signed_amount for a month
-- Returns: {"Food & Dining": -250.00, "Business Revenue": 5000.00, ...}
CREATE OR REPLACE FUNCTION fn_category_summary(p_month_id UUID)
RETURNS JSONB AS $$
  SELECT COALESCE(
    jsonb_object_agg(category, COALESCE(cat_total, 0)) FILTER (WHERE category IS NOT NULL),
    '{}'::jsonb
  )
  FROM (
    SELECT category, SUM(signed_amount) AS cat_total
    FROM financial_log
    WHERE month_id = p_month_id
    GROUP BY category
  ) sub;
$$ LANGUAGE SQL STABLE;

-- ============================================================================
-- Project cost to date (1 function)
-- Replaces Notion formula: Project Cost to Date
-- ============================================================================

-- Get total cost (expenses only, as positive value) for a project across all time
CREATE OR REPLACE FUNCTION fn_project_cost_to_date(p_project_id UUID)
RETURNS NUMERIC(12,2) AS $$
  SELECT COALESCE(SUM(ABS(signed_amount)), 0)
  FROM financial_log
  WHERE project_id = p_project_id AND signed_amount < 0;
$$ LANGUAGE SQL STABLE;
