-- ============================================================================
-- drizzle/functions/json_exports.sql
-- ============================================================================
-- Provenance: Notion Formula → PostgreSQL Implementation Plan
--   Source: .sisyphus/plans/notion-formula-postgres.md (Phase 3: JSON Export Functions)
--   Author: Sisyphus-Junior (OhMyOpenCode)
--   Date: 2026-04-10
--
-- Purpose: PostgreSQL STABLE functions returning JSON objects that match
--   Notion formula JSON outputs. Called by MCP tools for structured data export.
--
-- Design: Each function takes a UUID primary key and returns a json_build_object
--   with named keys representing the complete structured form of that entity.
--   Includes related counts where relevant.
--
-- Dependencies: All tables defined in drizzle/migrations/001-021
-- Requires: update_updated_at_column() from migration 000
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. fn_year_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: year identity, status, goal counts, quarter counts, report text
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_year_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', y.id,
    'name', y.name,
    'status', y.status,
    'year_range', y.year_range,
    'year_report', y.year_report,
    'annual_goals_count', COALESCE((
      SELECT COUNT(*) FROM annual_goals ag
      WHERE ag.id = ANY(y.annual_goals)
    ), 0),
    'annual_goals', COALESCE((
      SELECT json_agg(json_build_object(
        'id', ag.id,
        'name', ag.name,
        'goal_id', ag.goal_id,
        'status', ag.status,
        'goal_archetype', ag.goal_archetype,
        'strategic_intent', ag.strategic_intent
      ))
      FROM annual_goals ag
      WHERE ag.id = ANY(y.annual_goals)
    ), '[]'::json),
    'quarters_count', COALESCE(array_length(y.quarters, 1), 0),
    'quarterly_goals_count', COALESCE(array_length(y.quarterly_goals, 1), 0),
    'created_at', y.created_at,
    'updated_at', y.updated_at
  )
  FROM years y
  WHERE y.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 2. fn_quarter_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: quarter identity, date range, status, financial summary, goals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_quarter_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', q.id,
    'name', q.name,
    'status', q.status,
    'quarter_number', q.quarter_number,
    'quarter_name', q.quarter_name,
    'quarter_range', q.quarter_range,
    'quarter_start', q.quarter_start,
    'quarter_end', q.quarter_end,
    'quarter_report', q.quarter_report,
    'key_learnings', q.key_learnings,
    'category_summary', q.category_summary,
    'total_income', COALESCE(q.total_income, 0),
    'total_expenses', COALESCE(q.total_expenses, 0),
    'net_cashflow', COALESCE(q.net_cashflow, 0),
    'year_name', (SELECT name FROM years WHERE id = q.years_id),
    'months_count', COALESCE(array_length(q.months, 1), 0),
    'quarterly_goals_count', COALESCE(array_length(q.quarterly_goals, 1), 0),
    'quarterly_goals', COALESCE((
      SELECT json_agg(json_build_object(
        'id', qg.id,
        'name', qg.name,
        'goal_id', qg.goal_id,
        'status', qg.status,
        'progress', qg.progress
      ))
      FROM quarterly_goals qg
      WHERE qg.id = ANY(q.quarterly_goals)
    ), '[]'::json),
    'created_at', q.created_at,
    'updated_at', q.updated_at
  )
  FROM quarters q
  WHERE q.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. fn_month_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: month identity, date range, financial summary, projects, learnings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_month_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', m.id,
    'name', m.name,
    'status', m.status,
    'year', m.year,
    'month_number', m.month_number,
    'month_name', m.month_name,
    'month_range', m.month_range,
    'month_start', m.month_start,
    'month_end', m.month_end,
    'total_income', COALESCE(m.total_income, 0),
    'total_expenses', COALESCE(m.total_expenses, 0),
    'net_cashflow', COALESCE(m.net_cashflow, 0),
    'ending_net_worth', m.ending_net_worth,
    'net_worth_change', m.net_worth_change,
    'category_summary', m.category_summary,
    'cashflow_narrative', m.cashflow_narrative,
    'capital_allocation_insight', m.capital_allocation_insight,
    'accounts_snapshot', m.accounts_snapshot,
    'key_learnings', m.key_learnings,
    'significant_events', m.significant_events,
    'projects_active', m.projects_active,
    'accounts_involved', m.accounts_involved,
    'days_count', COALESCE(array_length(m.days, 1), 0),
    'financial_log_count', COALESCE(array_length(m.financial_log, 1), 0),
    'quarterly_goals_count', COALESCE(array_length(m.quarterly_goals, 1), 0),
    'quarter_name', (SELECT q.quarter_name FROM quarters q WHERE q.id = m.quarters_id),
    'created_at', m.created_at,
    'updated_at', m.updated_at
  )
  FROM months m
  WHERE m.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. fn_week_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: week identity, date range, progress, financial summary, activity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_week_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', w.id,
    'name', w.name,
    'status', w.status,
    'year', w.year,
    'week_number', w.week_number,
    'week_name', w.week_name,
    'week_range', w.week_range,
    'week_start', w.week_start,
    'week_end', w.week_end,
    'tasks_progress', w.tasks_progress,
    'activity_breakdown', w.activity_breakdown,
    'total_income', COALESCE(w.total_income, 0),
    'total_expenses', COALESCE(w.total_expenses, 0),
    'net_cashflow', COALESCE(w.net_cashflow, 0),
    'category_summary', w.category_summary,
    'key_learnings', w.key_learnings,
    'days_count', COALESCE(array_length(w.days, 1), 0),
    'tasks_count', COALESCE(array_length(w.tasks, 1), 0),
    'financial_log_count', COALESCE(array_length(w.financial_log, 1), 0),
    'tasks_detail', COALESCE((
      SELECT json_agg(json_build_object(
        'id', t.id,
        'name', t.name,
        'task_id', t.task_id,
        'status', t.status,
        'priority', t.priority
      ) ORDER BY t.action_date)
      FROM tasks t
      WHERE t.id = ANY(w.tasks)
    ), '[]'::json),
    'created_at', w.created_at,
    'updated_at', w.updated_at
  )
  FROM weeks w
  WHERE w.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. fn_day_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: day identity, date, health score, journals, activities, finances
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_day_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', d.id,
    'name', d.name,
    'status', d.status,
    'date', d.date,
    'day_name', d.day_name,
    'year', d.year,
    'day_number', d.day_number,
    'health_score', d.health_score,
    'journals', json_build_object(
      'subjective_count', COALESCE(array_length(d.subjective_journal, 1), 0),
      'relational_count', COALESCE(array_length(d.relational_journal, 1), 0),
      'systemic_count', COALESCE(array_length(d.systemic_journal, 1), 0)
    ),
    'activities', json_build_object(
      'count', COALESCE(array_length(d.activity_log, 1), 0),
      'items', COALESCE((
        SELECT json_agg(json_build_object(
          'id', a.id,
          'name', a.name,
          'activity_id', a.activity_id,
          'activity_type', a.activity_type,
          'duration_hrs', a.duration_hrs,
          'energy', a.energy,
          'mood_delta', a.mood_delta
        ) ORDER BY a.date_range)
        FROM activity_log a
        WHERE a.id = ANY(d.activity_log)
      ), '[]'::json)
    ),
    'diet_log_count', COALESCE(array_length(d.diet_log, 1), 0),
    'month_name', (SELECT m.month_name FROM months m WHERE m.id = d.months_id),
    'weeks_count', COALESCE(array_length(d.weeks, 1), 0),
    'created_at', d.created_at,
    'updated_at', d.updated_at
  )
  FROM days d
  WHERE d.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 6. fn_activity_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: activity identity, type, duration, energy, mood, project linkage
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_activity_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', a.id,
    'name', a.name,
    'activity_id', a.activity_id,
    'activity_type', a.activity_type,
    'activity_type_name', (SELECT at.name FROM activity_types at WHERE at.id = a.activity_type_id),
    'activity_notes', a.activity_notes,
    'notes_body', a.notes_body,
    'date_range', a.date_range,
    'date_end', a.date_end,
    'duration_hrs', a.duration_hrs,
    'energy', a.energy,
    'mood_delta', a.mood_delta,
    'is_habit_activity', COALESCE(a.is_habit_activity, false),
    'is_logged', COALESCE(a.is_logged, false),
    'day_name', (SELECT d.day_name FROM days d WHERE d.id = a.days_id),
    'day_date', (SELECT d.date FROM days d WHERE d.id = a.days_id),
    'projects_count', COALESCE(array_length(a.projects, 1), 0),
    'projects', COALESCE((
      SELECT json_agg(json_build_object(
        'id', p.id,
        'name', p.name,
        'project_id', p.project_id,
        'status', p.status
      ))
      FROM projects p
      WHERE p.id = ANY(a.projects)
    ), '[]'::json),
    'created_at', a.created_at,
    'updated_at', a.updated_at
  )
  FROM activity_log a
  WHERE a.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 7. fn_project_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: project identity, status, progress, budget, timeline, team, relations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_project_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', p.id,
    'name', p.name,
    'project_id', p.project_id,
    'status', p.status,
    'phase', p.phase,
    'priority', p.priority,
    'health', p.health,
    'monitor', p.monitor,
    'progress', p.progress,
    'project_progress', p.project_progress,
    'project_summary', p.project_summary,
    'justification', p.justification,
    'kpi', p.kpi,
    'kpi_status', p.kpi_status,
    'strategy', p.strategy,
    'team', p.team,
    'project_start', p.project_start,
    'deadline', p.deadline,
    'review_date', p.review_date,
    'duration_days', p.duration_days,
    'budget_allocated', p.budget_allocated,
    'budget_spent', p.budget_spent,
    'required_budget', p.required_budget,
    'projected_revenue', p.projected_revenue,
    'cost_to_date', p.cost_to_date,
    'tasks_count', COALESCE(array_length(p.tasks, 1), 0),
    'tasks_by_status', COALESCE((
      SELECT json_build_object(
        'done', COUNT(*) FILTER (WHERE t.status = 'Done'),
        'active', COUNT(*) FILTER (WHERE t.status = 'Active'),
        'focus', COUNT(*) FILTER (WHERE t.status = 'Focus'),
        'up_next', COUNT(*) FILTER (WHERE t.status = 'Up Next'),
        'paused', COUNT(*) FILTER (WHERE t.status = 'Paused'),
        'waiting', COUNT(*) FILTER (WHERE t.status = 'Waiting'),
        'cancelled', COUNT(*) FILTER (WHERE t.status = 'Cancelled'),
        'delegated', COUNT(*) FILTER (WHERE t.status = 'Delegated')
      )
      FROM tasks t
      WHERE t.id = ANY(p.tasks)
    ), '{}'::json),
    'people_count', COALESCE(array_length(p.people, 1), 0),
    'activity_log_count', COALESCE(array_length(p.activity_log, 1), 0),
    'financial_log_count', COALESCE(array_length(p.financial_log, 1), 0),
    'directives_risks_count', COALESCE(array_length(p.directives_risks, 1), 0),
    'campaigns_count', COALESCE(array_length(p.campaigns, 1), 0),
    'depends_on_count', COALESCE(array_length(p.depends_on, 1), 0),
    'dependents_count', COALESCE(array_length(p.dependents, 1), 0),
    'quarterly_goal_name', (SELECT qg.name FROM quarterly_goals qg WHERE qg.id = p.quarterly_goal_id),
    'last_edited_at', p.last_edited_at,
    'created_at', p.created_at,
    'updated_at', p.updated_at
  )
  FROM projects p
  WHERE p.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 8. fn_financial_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: transaction identity, amount, category, accounts, project linkage
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_financial_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', f.id,
    'name', f.name,
    'transaction_id', f.transaction_id,
    'date', f.date,
    'signed_amount', f.signed_amount,
    'amount', ABS(f.signed_amount),
    'transaction_type', f.transaction_type,
    'category', f.category,
    'capital_engine', f.capital_engine,
    'is_recurring', COALESCE(f.is_recurring, false),
    'is_financial', COALESCE(f.is_financial, false),
    'notes', f.notes,
    'legacy_amount', f.legacy_amount,
    'financial_elater', f.financial_elater,
    'receipt_url', f.receipt_url,
    'receipt_files', f.receipt_files,
    'week_name', (SELECT w.week_name FROM weeks w WHERE w.id = f.week_id),
    'month_name', (SELECT m.month_name FROM months m WHERE m.id = f.month_id),
    'project_name', (SELECT p.name FROM projects p WHERE p.id = f.project_id),
    'created_at', f.created_at,
    'updated_at', f.updated_at
  )
  FROM financial_log f
  WHERE f.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 9. fn_drl_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: directive/risk identity, type, status, threat assessment, relations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_drl_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', d.id,
    'name', d.name,
    'entry_id', d.entry_id,
    'log_type', d.log_type,
    'status', d.status,
    'likelihood', d.likelihood,
    'impact', d.impact,
    'threat_level', d.threat_level,
    'protocol_scenario', d.protocol_scenario,
    'last_assessed', d.last_assessed,
    'quarterly_goal_name', (SELECT qg.name FROM quarterly_goals qg WHERE qg.id = d.quarterly_goal_id),
    'projects_count', COALESCE(array_length(d.projects, 1), 0),
    'projects', COALESCE((
      SELECT json_agg(json_build_object(
        'id', p.id,
        'name', p.name,
        'project_id', p.project_id,
        'status', p.status
      ))
      FROM projects p
      WHERE p.id = ANY(d.projects)
    ), '[]'::json),
    'systemic_journal_count', COALESCE(array_length(d.systemic_journal, 1), 0),
    'mitigates_count', COALESCE(array_length(d.mitigates, 1), 0),
    'mitigates', COALESCE((
      SELECT json_agg(json_build_object(
        'id', d2.id,
        'name', d2.name,
        'entry_id', d2.entry_id,
        'log_type', d2.log_type,
        'status', d2.status,
        'threat_level', d2.threat_level
      ))
      FROM directives_risk_log d2
      WHERE d2.id = ANY(d.mitigates)
    ), '[]'::json),
    'created_at', d.created_at,
    'updated_at', d.updated_at
  )
  FROM directives_risk_log d
  WHERE d.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 10. fn_people_json(p_id UUID) → json
-- ---------------------------------------------------------------------------
-- Returns: person identity, contact info, relationship intel, engagement data
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_people_json(p_id UUID)
RETURNS json
LANGUAGE SQL STABLE
AS $$
  SELECT json_build_object(
    'id', p.id,
    'name', p.name,
    'first_name', p.first_name,
    'custom_name', p.custom_name,
    'email', p.email,
    'city', p.city,
    'timezone', p.timezone,
    'summary', p.summary,
    'strategic_context', p.strategic_context,
    'engagement_blueprint', p.engagement_blueprint,
    'professional_domain', p.professional_domain,
    'origin_context', p.origin_context,
    'key_personal_intel', p.key_personal_intel,
    'networking_profile', p.networking_profile,
    'relationship_status', p.relationship_status,
    'value_exchange_balance', p.value_exchange_balance,
    'core_shadow', p.core_shadow,
    'developmental_altitude', p.developmental_altitude,
    'aspirational_drive', p.aspirational_drive,
    'temporal_focus', p.temporal_focus,
    'primary_center_of_intelligence', p.primary_center_of_intelligence,
    'dominant_power_strategy', p.dominant_power_strategy,
    'primary_conflict_style', p.primary_conflict_style,
    'desired_trajectory', p.desired_trajectory,
    'stability_profile', p.stability_profile,
    'last_interaction_sentiment', p.last_interaction_sentiment,
    'explanatory_style', p.explanatory_style,
    'connection_frequency_days', p.connection_frequency_days,
    'last_connected_date', p.last_connected_date,
    'reconnect_by', p.reconnect_by,
    'influence_toolkit', p.influence_toolkit,
    'stories_count', COALESCE(array_length(p.stories, 1), 0),
    'projects_count', COALESCE(array_length(p.projects, 1), 0),
    'projects', COALESCE((
      SELECT json_agg(json_build_object(
        'id', pr.id,
        'name', pr.name,
        'project_id', pr.project_id,
        'status', pr.status
      ))
      FROM projects pr
      WHERE pr.id = ANY(p.projects)
    ), '[]'::json),
    'created_at', p.created_at,
    'updated_at', p.updated_at
  )
  FROM people p
  WHERE p.id = p_id;
$$;
