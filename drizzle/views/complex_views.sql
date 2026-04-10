-- Complex Views for Monitor, Health, Progress, and Report cards
-- These replace Notion formulas that performed multi-table joins and aggregations.
-- Since these involve NOW()-relative calculations and cross-table aggregations,
-- they cannot be implemented as STORED generated columns.
--
-- Replaces Notion formula categories:
--   - Monitor formulas (project health indicators, deadline proximity, activity)
--   - Health formulas (overall project/goal health scoring)
--   - Progress formulas (task completion %, time elapsed %, pacing)
--   - Report formulas (daily briefing, quarterly summaries)
--
-- Design notes:
--   - All views use CREATE OR REPLACE VIEW for idempotent re-runs
--   - LEFT JOIN used for optional relations (projects may have no tasks/activities)
--   - Array columns (tasks, activity_log, financial_log) are joined via unnest()
--   - Health logic mirrors Notion CASE WHEN formula patterns

-- ============================================================================
-- v_project_monitor
-- ============================================================================
-- Replaces Notion "Monitor" formula on Projects database.
-- Combines project status, phase, deadline proximity, task completion rate,
-- budget variance, and activity count into a single monitoring row per project.
--
-- Notion formula logic replaced:
--   Monitor = status icon + phase + days to deadline + task progress + budget status
-- ============================================================================

CREATE OR REPLACE VIEW v_project_monitor AS
SELECT
    p.id                          AS project_id,
    p.project_id                  AS project_code,
    p.name                        AS project_name,
    p.status                      AS project_status,
    p.phase                       AS project_phase,
    p.priority                    AS project_priority,
    p.project_start               AS project_start,
    p.deadline                    AS project_deadline,

    -- Deadline proximity (days remaining, NULL if no deadline)
    CASE
        WHEN p.deadline IS NOT NULL
        THEN (p.deadline::date - current_date)
        ELSE NULL
    END                           AS days_to_deadline,

    -- Deadline status label
    CASE
        WHEN p.deadline IS NULL THEN 'No deadline'
        WHEN p.deadline::date < current_date AND p.status != 'Done' THEN 'Overdue'
        WHEN p.deadline::date = current_date THEN 'Due today'
        WHEN p.deadline::date <= current_date + 7 THEN 'Due soon'
        WHEN p.deadline::date > current_date + 30 THEN 'On track'
        ELSE 'Planned'
    END                           AS deadline_status,

    -- Task completion rate (from tasks table via project_id relation)
    -- Tasks link to projects via tasks.project_id FK (not the projects.tasks array)
    COALESCE(t.total_tasks, 0)     AS total_tasks,
    COALESCE(t.completed_tasks, 0)  AS completed_tasks,
    CASE
        WHEN COALESCE(t.total_tasks, 0) = 0 THEN 0
        ELSE ROUND(
            (t.completed_tasks::NUMERIC / t.total_tasks::NUMERIC) * 100,
            2
        )
    END                           AS task_completion_pct,

    -- Budget variance
    p.budget_allocated            AS budget_allocated,
    p.budget_spent                AS budget_spent,
    CASE
        WHEN p.budget_allocated IS NOT NULL AND p.budget_spent IS NOT NULL
        THEN p.budget_allocated - p.budget_spent
        ELSE NULL
    END                           AS budget_remaining,
    CASE
        WHEN p.budget_allocated IS NOT NULL AND p.budget_spent IS NOT NULL AND p.budget_allocated > 0
        THEN ROUND((p.budget_spent / p.budget_allocated) * 100, 2)
        ELSE NULL
    END                           AS budget_utilization_pct,

    -- Activity count (from activity_log where project is in the projects array)
    COALESCE(a.activity_count, 0) AS activity_count,

    -- Revenue projection
    p.projected_revenue           AS projected_revenue,
    CASE
        WHEN p.projected_revenue IS NOT NULL AND p.budget_spent IS NOT NULL
        THEN p.projected_revenue - p.budget_spent
        ELSE NULL
    END                           AS projected_profit

FROM projects p

-- Task stats: LEFT JOIN because a project may have no tasks
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS total_tasks,
        COUNT(*) FILTER (WHERE status = 'Done') AS completed_tasks
    FROM tasks
    WHERE project_id = p.id
      AND status != 'Cancelled'
      AND status != 'Archived'
) t ON true

-- Activity count: LEFT JOIN because a project may have no logged activities
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS activity_count
    FROM activity_log al
    WHERE p.id = ANY(al.projects)
) a ON true;


-- ============================================================================
-- v_project_health
-- ============================================================================
-- Replaces Notion "Health" formula on Projects database.
-- Calculates overall project health based on status, phase, deadline proximity,
-- budget utilization, and task progress.
--
-- Notion formula logic replaced:
--   Health = emoji indicator based on composite scoring of multiple factors
-- Returns: project_id, health_status (text emoji + label), health_factors (text array)
-- ============================================================================

CREATE OR REPLACE VIEW v_project_health AS
SELECT
    p.id AS project_id,
    p.project_id AS project_code,
    p.name AS project_name,
    p.status AS project_status,

    -- Overall health status
    CASE
        -- Done or Cancelled projects are terminal
        WHEN p.status IN ('Done', 'Cancelled', 'Someday Maybe') THEN
            CASE p.status
                WHEN 'Done' THEN '✅ Completed'
                WHEN 'Cancelled' THEN '⚫ Cancelled'
                ELSE '⏸️ Shelved'
            END

        -- Active projects: composite health check
        WHEN p.status = 'Active' THEN
            CASE
                -- Off Track: overdue + low task progress + over budget
                WHEN (
                    (p.deadline IS NOT NULL AND p.deadline::date < current_date)
                    AND (
                        COALESCE(t.task_completion_pct, 0) < 25
                        OR (p.budget_allocated IS NOT NULL AND p.budget_spent IS NOT NULL
                            AND p.budget_spent > p.budget_allocated)
                    )
                ) THEN '🔴 Off Track'

                -- At Risk: one or two warning signals
                WHEN (
                    (p.deadline IS NOT NULL AND p.deadline::date < current_date + 7 AND p.deadline::date >= current_date)
                    OR COALESCE(t.task_completion_pct, 0) < 50
                    OR (p.budget_allocated IS NOT NULL AND p.budget_spent IS NOT NULL
                        AND p.budget_spent > p.budget_allocated * 0.8)
                ) THEN '🟡 At Risk'

                -- On Track: everything looks good
                ELSE '🟢 On Track'
            END

        -- On Hold / Delegated / other
        ELSE '⏸️ ' || p.status
    END AS health_status,

    -- Array of contributing factors
    ARRAY_REMOVE(ARRAY[
        -- Status factor
        'Status: ' || p.status,

        -- Phase factor
        CASE WHEN p.phase IS NOT NULL THEN 'Phase: ' || p.phase ELSE NULL END,

        -- Deadline factor
        CASE
            WHEN p.deadline IS NULL THEN 'No deadline set'
            WHEN p.deadline::date < current_date AND p.status != 'Done'
                THEN 'Overdue by ' || (current_date - p.deadline::date) || ' days'
            WHEN p.deadline::date = current_date
                THEN 'Due today'
            WHEN p.deadline::date <= current_date + 7
                THEN 'Due in ' || (p.deadline::date - current_date) || ' days'
            ELSE NULL
        END,

        -- Task progress factor
        CASE
            WHEN COALESCE(t.task_completion_pct, 0) = 0 AND COALESCE(t.total_tasks, 0) > 0
                THEN 'No tasks completed (' || t.total_tasks || ' total)'
            WHEN COALESCE(t.task_completion_pct, 0) > 0 AND COALESCE(t.task_completion_pct, 0) < 50
                THEN 'Task progress at ' || ROUND(t.task_completion_pct, 0) || '%'
            WHEN COALESCE(t.task_completion_pct, 0) >= 75
                THEN 'Task progress strong at ' || ROUND(t.task_completion_pct, 0) || '%'
            ELSE NULL
        END,

        -- Budget factor
        CASE
            WHEN p.budget_allocated IS NOT NULL AND p.budget_spent IS NOT NULL AND p.budget_spent > p.budget_allocated
                THEN 'Over budget by ' || ROUND(p.budget_spent - p.budget_allocated, 2)
            WHEN p.budget_allocated IS NOT NULL AND p.budget_spent IS NOT NULL AND p.budget_spent > p.budget_allocated * 0.8
                THEN 'Budget at ' || ROUND((p.budget_spent / p.budget_allocated) * 100, 0) || '%'
            ELSE NULL
        END

    ], NULL) AS health_factors

FROM projects p

-- Task stats for health scoring
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS total_tasks,
        CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE (COUNT(*) FILTER (WHERE status = 'Done')::NUMERIC / COUNT(*)::NUMERIC) * 100
        END AS task_completion_pct
    FROM tasks
    WHERE project_id = p.id
      AND status != 'Cancelled'
      AND status != 'Archived'
) t ON true;


-- ============================================================================
-- v_project_progress
-- ============================================================================
-- Replaces Notion "Progress" and "Project Progress" formulas on Projects.
-- Calculates task completion %, time elapsed %, and pacing indicator.
--
-- Notion formula logic replaced:
--   Progress = rollup of task completion % from related tasks
--   Project Progress = dual bar with task % vs time % and pacing label
-- Returns: project_id, task_progress, time_progress, pacing
-- ============================================================================

CREATE OR REPLACE VIEW v_project_progress AS
SELECT
    p.id AS project_id,
    p.project_id AS project_code,
    p.name AS project_name,
    p.status AS project_status,
    p.project_start,
    p.deadline,

    -- Task completion percentage
    COALESCE(
        CASE
            WHEN t.total_tasks = 0 THEN 0
            ELSE ROUND(
                (t.completed_tasks::NUMERIC / t.total_tasks::NUMERIC) * 100,
                2
            )
        END,
        0
    ) AS task_progress,

    -- Time elapsed percentage (from project_start to deadline)
    CASE
        WHEN p.project_start IS NOT NULL AND p.deadline IS NOT NULL THEN
            CASE
                WHEN current_date >= p.deadline::date THEN 100.00
                WHEN current_date <= p.project_start::date THEN 0.00
                ELSE ROUND(
                    (current_date - p.project_start::date)::NUMERIC
                    / (p.deadline::date - p.project_start::date)::NUMERIC
                    * 100,
                    2
                )
            END
        ELSE NULL
    END AS time_progress,

    -- Total task count
    COALESCE(t.total_tasks, 0) AS total_tasks,
    COALESCE(t.completed_tasks, 0) AS completed_tasks,

    -- Pacing: are we ahead or behind based on task vs time progress?
    CASE
        WHEN p.status IN ('Done', 'Cancelled', 'On Hold', 'Someday Maybe') THEN
            CASE p.status
                WHEN 'Done' THEN 'Completed'
                WHEN 'Cancelled' THEN 'Cancelled'
                ELSE 'Paused'
            END
        WHEN p.project_start IS NULL OR p.deadline IS NULL THEN 'No timeline'
        WHEN t.total_tasks = 0 THEN 'No tasks'
        WHEN COALESCE(
            CASE WHEN t.total_tasks = 0 THEN 0
            ELSE (t.completed_tasks::NUMERIC / t.total_tasks::NUMERIC) * 100 END, 0
        ) >= CASE
                WHEN current_date >= p.deadline::date THEN 100.00
                WHEN current_date <= p.project_start::date THEN 0.00
                ELSE (current_date - p.project_start::date)::NUMERIC
                     / (p.deadline::date - p.project_start::date)::NUMERIC * 100
             END + 10  -- 10% buffer for "ahead"
        THEN 'Ahead'
        WHEN COALESCE(
            CASE WHEN t.total_tasks = 0 THEN 0
            ELSE (t.completed_tasks::NUMERIC / t.total_tasks::NUMERIC) * 100 END, 0
        ) >= CASE
                WHEN current_date >= p.deadline::date THEN 100.00
                WHEN current_date <= p.project_start::date THEN 0.00
                ELSE (current_date - p.project_start::date)::NUMERIC
                     / (p.deadline::date - p.project_start::date)::NUMERIC * 100
             END - 10  -- 10% buffer for "on track"
        THEN 'On Track'
        ELSE 'Behind'
    END AS pacing,

    -- Duration in days
    CASE
        WHEN p.project_start IS NOT NULL AND p.deadline IS NOT NULL
        THEN (p.deadline::date - p.project_start::date)
        ELSE NULL
    END AS total_duration_days

FROM projects p

-- Task stats
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS total_tasks,
        COUNT(*) FILTER (WHERE status = 'Done') AS completed_tasks
    FROM tasks
    WHERE project_id = p.id
      AND status != 'Cancelled'
      AND status != 'Archived'
) t ON true;


-- ============================================================================
-- v_daily_briefing
-- ============================================================================
-- Cross-domain daily overview replacing Notion rollups and filtered views.
-- Consolidates today's day status, health score, scheduled activities,
-- due tasks, and upcoming deadlines into a single briefing row per day.
--
-- Replaces Notion filtered views:
--   - "Today's Activities" (activity_log filtered by date = today)
--   - "Today's Tasks" (tasks filtered by action_date = today)
--   - "Upcoming Deadlines" (projects with deadline within 7 days)
--   - Day health score display
-- ============================================================================

CREATE OR REPLACE VIEW v_daily_briefing AS
SELECT
    -- Day info
    d.date                        AS briefing_date,
    d.day_name                    AS day_of_week,
    d.health_score                AS day_health_score,
    CASE
        WHEN d.date = current_date THEN 'Today'
        WHEN d.date = current_date + 1 THEN 'Tomorrow'
        WHEN d.date = current_date - 1 THEN 'Yesterday'
        WHEN d.date > current_date THEN 'Future Day'
        ELSE 'Past Day'
    END                           AS day_status,

    -- Scheduled activities for this day
    COALESCE(act.activities, '[]'::jsonb) AS scheduled_activities,
    COALESCE(act.activity_count, 0)        AS activity_count,

    -- Due tasks for this day
    COALESCE(due_tasks.tasks, '[]'::jsonb) AS due_tasks,
    COALESCE(due_tasks.task_count, 0)      AS task_count,

    -- Upcoming project deadlines (within 7 days of this date)
    COALESCE(deadlines.projects, '[]'::jsonb) AS upcoming_deadlines,
    COALESCE(deadlines.deadline_count, 0)     AS deadline_count,

    -- Day journal relations (counts via FK days_id)
    COALESCE(
        (SELECT COUNT(*) FROM subjective_journal sj WHERE sj.days_id = d.id),
        0
    ) AS subjective_journal_count,
    COALESCE(
        (SELECT COUNT(*) FROM diet_log dl WHERE dl.days_id = d.id),
        0
    ) AS diet_log_count

FROM days d

-- Activities scheduled for this day
LEFT JOIN LATERAL (
    SELECT
        jsonb_agg(
            jsonb_build_object(
                'id', a.id,
                'activity_id', a.activity_id,
                'name', a.name,
                'type', a.activity_type,
                'energy', a.energy,
                'mood_delta', a.mood_delta,
                'duration_hrs', a.duration_hrs
            ) ORDER BY a.date_range
        ) AS activities,
        COUNT(*) AS activity_count
    FROM activity_log a
    WHERE a.days_id = d.id
      AND a.date_range::date = d.date
) act ON true

-- Tasks due on this day
LEFT JOIN LATERAL (
    SELECT
        jsonb_agg(
            jsonb_build_object(
                'id', t.id,
                'task_id', t.task_id,
                'name', t.name,
                'status', t.status,
                'priority', t.priority,
                'project_id', t.project_id
            ) ORDER BY t.priority, t.name
        ) AS tasks,
        COUNT(*) AS task_count
    FROM tasks t
    WHERE t.action_date::date = d.date
      AND t.status NOT IN ('Done', 'Cancelled', 'Archived')
) due_tasks ON true

-- Project deadlines within 7 days of this date
LEFT JOIN LATERAL (
    SELECT
        jsonb_agg(
            jsonb_build_object(
                'id', p.id,
                'project_id', p.project_id,
                'name', p.name,
                'deadline', p.deadline,
                'status', p.status,
                'days_until', (p.deadline::date - d.date)
            ) ORDER BY p.deadline
        ) AS projects,
        COUNT(*) AS deadline_count
    FROM projects p
    WHERE p.deadline IS NOT NULL
      AND p.deadline::date >= d.date
      AND p.deadline::date <= d.date + 7
      AND p.status NOT IN ('Done', 'Cancelled')
) deadlines ON true;


-- ============================================================================
-- v_quarterly_report
-- ============================================================================
-- Quarterly aggregation view replacing Notion rollups and summary formulas.
-- Provides financial summary, project counts, goal completion, and activity
-- overview for each quarter.
--
-- Replaces Notion formula/rollup fields:
--   - Quarters: Total Income, Total Expenses, Net Cashflow
--   - Quarters: Quarter Report (text summary)
--   - Cross-database rollups for projects and goals per quarter
-- ============================================================================

CREATE OR REPLACE VIEW v_quarterly_report AS
SELECT
    q.id                          AS quarter_id,
    q.quarter_number,
    q.quarter_name,
    q.quarter_range,
    q.quarter_start,
    q.quarter_end,
    q.status                      AS quarter_status,

    -- Financial summary (from financial_log linked via month → quarter or direct date range)
    COALESCE(fin.total_income, 0)      AS total_income,
    COALESCE(fin.total_expenses, 0)    AS total_expenses,
    COALESCE(fin.net_cashflow, 0)      AS net_cashflow,
    COALESCE(fin.transaction_count, 0) AS transaction_count,
    COALESCE(fin.category_breakdown, '{}'::jsonb) AS category_breakdown,

    -- Active projects count (projects with Active status or linked to this quarter's goals)
    COALESCE(proj.active_projects, 0)     AS active_projects,
    COALESCE(proj.total_projects, 0)      AS total_projects,
    COALESCE(proj.completed_projects, 0)  AS completed_projects,
    COALESCE(proj.total_budget_allocated, 0) AS total_budget_allocated,
    COALESCE(proj.total_budget_spent, 0)     AS total_budget_spent,

    -- Quarterly goals summary
    COALESCE(goals.total_goals, 0)         AS total_goals,
    COALESCE(goals.completed_goals, 0)     AS completed_goals,
    COALESCE(goals.planning_goals, 0)      AS planning_goals,
    CASE
        WHEN COALESCE(goals.total_goals, 0) = 0 THEN 0
        ELSE ROUND(
            (goals.completed_goals::NUMERIC / goals.total_goals::NUMERIC) * 100, 2
        )
    END                              AS goal_completion_pct,

    -- Activity summary (activities logged during this quarter's date range)
    COALESCE(act.total_activities, 0)   AS total_activities,
    COALESCE(act.total_hours, 0)        AS total_activity_hours,
    COALESCE(act.high_energy_count, 0)  AS high_energy_activities

FROM quarters q

-- Financial aggregation: join financial_log by date range matching quarter_start to quarter_end
LEFT JOIN LATERAL (
    SELECT
        COALESCE(SUM(f.signed_amount) FILTER (WHERE f.signed_amount > 0), 0) AS total_income,
        COALESCE(ABS(SUM(f.signed_amount) FILTER (WHERE f.signed_amount < 0)), 0) AS total_expenses,
        COALESCE(SUM(f.signed_amount), 0) AS net_cashflow,
        COUNT(*) AS transaction_count,
        COALESCE(
            (SELECT jsonb_object_agg(cat, cnt) FROM (
                SELECT f2.category AS cat, COUNT(*) AS cnt
                FROM financial_log f2
                WHERE f2.date >= q.quarter_start
                  AND f2.date < q.quarter_end
                  AND f2.category IS NOT NULL
                GROUP BY f2.category
            ) sub),
            '{}'::jsonb
        ) AS category_breakdown
    FROM financial_log f
    WHERE f.date >= q.quarter_start
      AND f.date < q.quarter_end
) fin ON true

-- Projects aggregation: projects linked to quarterly goals OR active during quarter
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE p.status = 'Active') AS active_projects,
        COUNT(*) AS total_projects,
        COUNT(*) FILTER (WHERE p.status = 'Done') AS completed_projects,
        COALESCE(SUM(p.budget_allocated), 0) AS total_budget_allocated,
        COALESCE(SUM(p.budget_spent), 0) AS total_budget_spent
    FROM projects p
    WHERE p.quarterly_goal_id IN (
        SELECT qg.id FROM quarterly_goals qg WHERE q.quarterly_goals @> ARRAY[qg.id]
    )
    OR (
        -- Also include projects active during this quarter's date range
        p.status = 'Active'
        AND p.project_start IS NOT NULL
        AND p.project_start < q.quarter_end
        AND (p.deadline IS NULL OR p.deadline > q.quarter_start)
    )
) proj ON true

-- Quarterly goals linked to this quarter
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS total_goals,
        COUNT(*) FILTER (WHERE qg.status = 'Done') AS completed_goals,
        COUNT(*) FILTER (WHERE qg.status = 'Planning') AS planning_goals
    FROM quarterly_goals qg
    WHERE q.quarterly_goals @> ARRAY[qg.id]
) goals ON true

-- Activity summary during quarter date range
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS total_activities,
        COALESCE(SUM(a.duration_hrs), 0) AS total_hours,
        COUNT(*) FILTER (WHERE a.energy = 'High') AS high_energy_count
    FROM activity_log a
    WHERE a.date_range >= q.quarter_start
      AND a.date_range < q.quarter_end
) act ON true;
