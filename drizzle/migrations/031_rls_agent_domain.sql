-- Migration 031: Per-Agent Domain-Scoped Row-Level Security
-- Creates agent_domain_mapping table and enables RLS on LifeOS tables
-- with domain-scoped policies. CEO/CTO bypass all restrictions.
--
-- Agent → Domain mapping:
--   ceo-strategic    → ALL domains (bypass)
--   cto-strategic    → ALL domains (bypass)
--   coo-productivity → productivity (tasks, activity_log, activity_types, projects, reports)
--   cmo-content      → content (content_pipeline, campaigns, campaign_platforms, content_platforms)
--   cro-relational   → relational (people, relational_journal)
--   cfo-financial    → financial (financial_log, financial_accounts)
--   cpo-psychologist → journaling (subjective_journal, relational_journal, systemic_journal)
--   physician        → health (diet_log)
--   cio-intelligence → intelligence (directives_risk_log, opportunities_strengths, notes_management)
--
-- Generated: 2026-04-12
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_domain_mapping (
  agent_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  PRIMARY KEY (agent_id, domain)
);

INSERT INTO agent_domain_mapping (agent_id, domain) VALUES
  ('ceo-strategic', 'productivity'),
  ('ceo-strategic', 'content'),
  ('ceo-strategic', 'relational'),
  ('ceo-strategic', 'financial'),
  ('ceo-strategic', 'journaling'),
  ('ceo-strategic', 'health'),
  ('ceo-strategic', 'intelligence'),
  ('cto-strategic', 'productivity'),
  ('cto-strategic', 'content'),
  ('cto-strategic', 'relational'),
  ('cto-strategic', 'financial'),
  ('cto-strategic', 'journaling'),
  ('cto-strategic', 'health'),
  ('cto-strategic', 'intelligence'),
  ('coo-productivity', 'productivity'),
  ('cmo-content', 'content'),
  ('cro-relational', 'relational'),
  ('cfo-financial', 'financial'),
  ('cpo-psychologist', 'journaling'),
  ('cpo-psychologist', 'relational'),
  ('physician', 'health'),
  ('cio-intelligence', 'intelligence')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION has_domain_access(p_domain TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_agent_id TEXT;
BEGIN
  v_agent_id := current_setting('operant.agent_id', true);
  IF v_agent_id IS NULL OR v_agent_id = '' THEN
    RETURN false;
  END IF;
  IF v_agent_id IN ('ceo-strategic', 'cto-strategic') THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM agent_domain_mapping
    WHERE agent_id = v_agent_id AND domain = p_domain
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. RLS Policies: Productivity Domain
-- Tables: tasks, activity_log, activity_types, projects, reports
-- ============================================================================

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_domain_access" ON tasks
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_log_domain_access" ON activity_log
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_types_domain_access" ON activity_types
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_domain_access" ON projects
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_domain_access" ON reports
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

-- ============================================================================
-- 4. RLS Policies: Content Domain
-- Tables: content_pipeline, campaigns, campaign_platforms, content_platforms
-- ============================================================================

ALTER TABLE content_pipeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_pipeline_domain_access" ON content_pipeline
  FOR ALL
  USING (has_domain_access('content'))
  WITH CHECK (has_domain_access('content'));

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_domain_access" ON campaigns
  FOR ALL
  USING (has_domain_access('content'))
  WITH CHECK (has_domain_access('content'));

ALTER TABLE campaign_platforms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_platforms_domain_access" ON campaign_platforms
  FOR ALL
  USING (has_domain_access('content'))
  WITH CHECK (has_domain_access('content'));

ALTER TABLE content_platforms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_platforms_domain_access" ON content_platforms
  FOR ALL
  USING (has_domain_access('content'))
  WITH CHECK (has_domain_access('content'));

-- ============================================================================
-- 5. RLS Policies: Relational Domain
-- Tables: people, relational_journal
-- ============================================================================

ALTER TABLE people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "people_domain_access" ON people
  FOR ALL
  USING (has_domain_access('relational'))
  WITH CHECK (has_domain_access('relational'));

ALTER TABLE relational_journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "relational_journal_domain_access" ON relational_journal
  FOR ALL
  USING (has_domain_access('relational'))
  WITH CHECK (has_domain_access('relational'));

-- ============================================================================
-- 6. RLS Policies: Financial Domain
-- Tables: financial_log, financial_accounts
-- ============================================================================

ALTER TABLE financial_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financial_log_domain_access" ON financial_log
  FOR ALL
  USING (has_domain_access('financial'))
  WITH CHECK (has_domain_access('financial'));

ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financial_accounts_domain_access" ON financial_accounts
  FOR ALL
  USING (has_domain_access('financial'))
  WITH CHECK (has_domain_access('financial'));

-- ============================================================================
-- 7. RLS Policies: Journaling Domain
-- Tables: subjective_journal, systemic_journal
-- (relational_journal already handled in relational domain)
-- ============================================================================

ALTER TABLE subjective_journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subjective_journal_domain_access" ON subjective_journal
  FOR ALL
  USING (has_domain_access('journaling'))
  WITH CHECK (has_domain_access('journaling'));

ALTER TABLE systemic_journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "systemic_journal_domain_access" ON systemic_journal
  FOR ALL
  USING (has_domain_access('journaling'))
  WITH CHECK (has_domain_access('journaling'));

-- ============================================================================
-- 8. RLS Policies: Health Domain
-- Tables: diet_log
-- ============================================================================

ALTER TABLE diet_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "diet_log_domain_access" ON diet_log
  FOR ALL
  USING (has_domain_access('health'))
  WITH CHECK (has_domain_access('health'));

-- ============================================================================
-- 9. RLS Policies: Intelligence Domain
-- Tables: directives_risk_log, opportunities_strengths, notes_management
-- ============================================================================

ALTER TABLE directives_risk_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "directives_risk_log_domain_access" ON directives_risk_log
  FOR ALL
  USING (has_domain_access('intelligence'))
  WITH CHECK (has_domain_access('intelligence'));

ALTER TABLE opportunities_strengths ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opportunities_strengths_domain_access" ON opportunities_strengths
  FOR ALL
  USING (has_domain_access('intelligence'))
  WITH CHECK (has_domain_access('intelligence'));

ALTER TABLE notes_management ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_management_domain_access" ON notes_management
  FOR ALL
  USING (has_domain_access('intelligence'))
  WITH CHECK (has_domain_access('intelligence'));

-- ============================================================================
-- 10. Timekeeping Tables (read-only, no domain restriction)
-- Tables: years, quarters, months, weeks, days
-- All agents need read access to temporal reference data
-- ============================================================================

ALTER TABLE years ENABLE ROW LEVEL SECURITY;
CREATE POLICY "years_read_all" ON years
  FOR SELECT
  USING (true);
CREATE POLICY "years_admin_write" ON years
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

ALTER TABLE quarters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quarters_read_all" ON quarters
  FOR SELECT
  USING (true);
CREATE POLICY "quarters_admin_write" ON quarters
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

ALTER TABLE months ENABLE ROW LEVEL SECURITY;
CREATE POLICY "months_read_all" ON months
  FOR SELECT
  USING (true);
CREATE POLICY "months_admin_write" ON months
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

ALTER TABLE weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "weeks_read_all" ON weeks
  FOR SELECT
  USING (true);
CREATE POLICY "weeks_admin_write" ON weeks
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

ALTER TABLE days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "days_read_all" ON days
  FOR SELECT
  USING (true);
CREATE POLICY "days_admin_write" ON days
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

-- ============================================================================
-- 11. notion_unmapped table (no domain restriction needed, system table)
-- ============================================================================

ALTER TABLE notion_unmapped ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notion_unmapped_productivity" ON notion_unmapped
  FOR ALL
  USING (has_domain_access('productivity'))
  WITH CHECK (has_domain_access('productivity'));

-- ============================================================================
-- Migration 031 Complete
-- ============================================================================
