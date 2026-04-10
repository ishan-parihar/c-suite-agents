-- ============================================================================
-- Row Level Security (RLS) Policies for Operant
-- ============================================================================
-- Self-hosted, single-tenant system — RLS provides defense-in-depth,
-- not multi-tenancy. Primary access is through Drizzle ORM with a single
-- database user.
--
-- Tables covered: 48 total
--   - LifeOS tables (24)
--   - Operational tables (19)
--   - Junction tables (5)
--
-- Generated: 2026-04-10
-- Migration plan ref: self-hosted-migration.md §1.6
-- ============================================================================

-- ============================================================================
-- 1. Role Setup
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
END
$$;

-- ============================================================================
-- 2. LifeOS Tables (24)
-- ============================================================================

-- ── years ──
ALTER TABLE years ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON years
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON years
  FOR SELECT TO anon
  USING (true);

-- ── quarters ──
ALTER TABLE quarters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON quarters
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON quarters
  FOR SELECT TO anon
  USING (true);

-- ── months ──
ALTER TABLE months ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON months
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON months
  FOR SELECT TO anon
  USING (true);

-- ── weeks ──
ALTER TABLE weeks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON weeks
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON weeks
  FOR SELECT TO anon
  USING (true);

-- ── days ──
ALTER TABLE days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON days
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON days
  FOR SELECT TO anon
  USING (true);

-- ── annual_goals ──
ALTER TABLE annual_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON annual_goals
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON annual_goals
  FOR SELECT TO anon
  USING (true);

-- ── quarterly_goals ──
ALTER TABLE quarterly_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON quarterly_goals
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON quarterly_goals
  FOR SELECT TO anon
  USING (true);

-- ── people ──
ALTER TABLE people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON people
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON people
  FOR SELECT TO anon
  USING (true);

-- ── activity_types ──
ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON activity_types
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON activity_types
  FOR SELECT TO anon
  USING (true);

-- ── activity_log ──
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON activity_log
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON activity_log
  FOR SELECT TO anon
  USING (true);

-- ── tasks ──
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON tasks
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON tasks
  FOR SELECT TO anon
  USING (true);

-- ── projects ──
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON projects
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON projects
  FOR SELECT TO anon
  USING (true);

-- ── campaigns ──
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON campaigns
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON campaigns
  FOR SELECT TO anon
  USING (true);

-- ── content_pipeline ──
ALTER TABLE content_pipeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON content_pipeline
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON content_pipeline
  FOR SELECT TO anon
  USING (true);

-- ── subjective_journal ──
ALTER TABLE subjective_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON subjective_journal
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON subjective_journal
  FOR SELECT TO anon
  USING (true);

-- ── relational_journal ──
ALTER TABLE relational_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON relational_journal
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON relational_journal
  FOR SELECT TO anon
  USING (true);

-- ── systemic_journal ──
ALTER TABLE systemic_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON systemic_journal
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON systemic_journal
  FOR SELECT TO anon
  USING (true);

-- ── diet_log ──
ALTER TABLE diet_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON diet_log
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON diet_log
  FOR SELECT TO anon
  USING (true);

-- ── financial_log ──
ALTER TABLE financial_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON financial_log
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON financial_log
  FOR SELECT TO anon
  USING (true);

-- ── financial_accounts ──
ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON financial_accounts
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON financial_accounts
  FOR SELECT TO anon
  USING (true);

-- ── directives_risk_log ──
ALTER TABLE directives_risk_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON directives_risk_log
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON directives_risk_log
  FOR SELECT TO anon
  USING (true);

-- ── opportunities_strengths ──
ALTER TABLE opportunities_strengths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON opportunities_strengths
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON opportunities_strengths
  FOR SELECT TO anon
  USING (true);

-- ── reports ──
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON reports
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON reports
  FOR SELECT TO anon
  USING (true);

-- ── notes_management ──
ALTER TABLE notes_management ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON notes_management
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON notes_management
  FOR SELECT TO anon
  USING (true);

-- ============================================================================
-- 3. Operational Tables (19)
-- ============================================================================

-- ── kanban_boards ──
ALTER TABLE kanban_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON kanban_boards
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON kanban_boards
  FOR SELECT TO anon
  USING (true);

-- Agent-scoped: each agent only sees their own board
CREATE POLICY "agent_own_board" ON kanban_boards
  FOR ALL TO authenticated
  USING (agent_id = current_setting('app.current_agent_id', true)::text)
  WITH CHECK (agent_id = current_setting('app.current_agent_id', true)::text);

-- ── kanban_columns ──
ALTER TABLE kanban_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON kanban_columns
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON kanban_columns
  FOR SELECT TO anon
  USING (true);

-- ── kanban_cards ──
ALTER TABLE kanban_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON kanban_cards
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON kanban_cards
  FOR SELECT TO anon
  USING (true);

-- Agent-scoped: each agent sees cards on their boards or assigned to them
CREATE POLICY "agent_own_cards" ON kanban_cards
  FOR ALL TO authenticated
  USING (
    assignee_agent_id = current_setting('app.current_agent_id', true)::text
    OR board_id IN (
      SELECT id FROM kanban_boards
      WHERE agent_id = current_setting('app.current_agent_id', true)::text
    )
  )
  WITH CHECK (
    assignee_agent_id = current_setting('app.current_agent_id', true)::text
    OR board_id IN (
      SELECT id FROM kanban_boards
      WHERE agent_id = current_setting('app.current_agent_id', true)::text
    )
  );

-- ── kanban_card_activity ──
ALTER TABLE kanban_card_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON kanban_card_activity
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON kanban_card_activity
  FOR SELECT TO anon
  USING (true);

-- ── kanban_reporting_lines ──
ALTER TABLE kanban_reporting_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON kanban_reporting_lines
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON kanban_reporting_lines
  FOR SELECT TO anon
  USING (true);

-- ── message_threads ──
ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON message_threads
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON message_threads
  FOR SELECT TO anon
  USING (true);

-- ── messages ──
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON messages
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON messages
  FOR SELECT TO anon
  USING (true);

-- Agent-scoped: each agent only sees messages they're involved in
CREATE POLICY "agent_own_messages" ON messages
  FOR ALL TO authenticated
  USING (
    from_agent = current_setting('app.current_agent_id', true)::text
    OR to_agent = current_setting('app.current_agent_id', true)::text
  )
  WITH CHECK (
    from_agent = current_setting('app.current_agent_id', true)::text
    OR to_agent = current_setting('app.current_agent_id', true)::text
  );

-- ── message_escalations ──
ALTER TABLE message_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON message_escalations
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON message_escalations
  FOR SELECT TO anon
  USING (true);

-- ── board_meetings ──
ALTER TABLE board_meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON board_meetings
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON board_meetings
  FOR SELECT TO anon
  USING (true);

-- ── board_meeting_turns ──
ALTER TABLE board_meeting_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON board_meeting_turns
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON board_meeting_turns
  FOR SELECT TO anon
  USING (true);

-- ── board_meeting_responses ──
ALTER TABLE board_meeting_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON board_meeting_responses
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON board_meeting_responses
  FOR SELECT TO anon
  USING (true);

-- Agent-scoped: each agent only sees their own responses
CREATE POLICY "agent_own_meeting_responses" ON board_meeting_responses
  FOR ALL TO authenticated
  USING (agent_id = current_setting('app.current_agent_id', true)::text)
  WITH CHECK (agent_id = current_setting('app.current_agent_id', true)::text);

-- ── agent_sessions ──
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON agent_sessions
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON agent_sessions
  FOR SELECT TO anon
  USING (true);

-- Agent-scoped: each agent only sees their own sessions
CREATE POLICY "agent_sees_own_sessions" ON agent_sessions
  FOR ALL TO authenticated
  USING (agent_id = current_setting('app.current_agent_id', true)::text)
  WITH CHECK (agent_id = current_setting('app.current_agent_id', true)::text);

-- ── session_messages ──
ALTER TABLE session_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON session_messages
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON session_messages
  FOR SELECT TO anon
  USING (true);

-- Agent-scoped: messages belong to agent-scoped sessions
CREATE POLICY "agent_sees_own_session_messages" ON session_messages
  FOR ALL TO authenticated
  USING (
    session_id IN (
      SELECT id FROM agent_sessions
      WHERE agent_id = current_setting('app.current_agent_id', true)::text
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT id FROM agent_sessions
      WHERE agent_id = current_setting('app.current_agent_id', true)::text
    )
  );

-- ── session_tool_calls ──
ALTER TABLE session_tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON session_tool_calls
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON session_tool_calls
  FOR SELECT TO anon
  USING (true);

-- Agent-scoped: tool calls belong to agent-scoped sessions
CREATE POLICY "agent_sees_own_session_tool_calls" ON session_tool_calls
  FOR ALL TO authenticated
  USING (
    session_id IN (
      SELECT id FROM agent_sessions
      WHERE agent_id = current_setting('app.current_agent_id', true)::text
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT id FROM agent_sessions
      WHERE agent_id = current_setting('app.current_agent_id', true)::text
    )
  );

-- ── ops_reports ──
ALTER TABLE ops_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON ops_reports
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON ops_reports
  FOR SELECT TO anon
  USING (true);

-- ── ops_sessions ──
ALTER TABLE ops_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON ops_sessions
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON ops_sessions
  FOR SELECT TO anon
  USING (true);

-- ── session_steps ──
ALTER TABLE session_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON session_steps
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON session_steps
  FOR SELECT TO anon
  USING (true);

-- ── tool_correlations ──
ALTER TABLE tool_correlations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON tool_correlations
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON tool_correlations
  FOR SELECT TO anon
  USING (true);

-- ── oc_sessions ──
ALTER TABLE oc_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON oc_sessions
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON oc_sessions
  FOR SELECT TO anon
  USING (true);

-- ============================================================================
-- 4. Junction Tables (5)
-- ============================================================================

-- ── project_people ──
ALTER TABLE project_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON project_people
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON project_people
  FOR SELECT TO anon
  USING (true);

-- ── project_directives ──
ALTER TABLE project_directives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON project_directives
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON project_directives
  FOR SELECT TO anon
  USING (true);

-- ── project_opportunities ──
ALTER TABLE project_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON project_opportunities
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON project_opportunities
  FOR SELECT TO anon
  USING (true);

-- ── campaign_platforms ──
ALTER TABLE campaign_platforms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON campaign_platforms
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON campaign_platforms
  FOR SELECT TO anon
  USING (true);

-- ── content_platforms ──
ALTER TABLE content_platforms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON content_platforms
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_access" ON content_platforms
  FOR SELECT TO anon
  USING (true);

-- ============================================================================
-- End of RLS Policies
-- ============================================================================
