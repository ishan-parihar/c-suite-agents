CREATE TABLE "years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"annual_goals" uuid[],
	"quarters" uuid[],
	"quarterly_goals" uuid[],
	"status" text,
	"year_range" text,
	"year_report" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"years_id" uuid,
	"months" uuid[],
	"quarterly_goals" uuid[],
	"quarter_number" integer,
	"quarter_start" timestamp with time zone,
	"quarter_end" timestamp with time zone,
	"quarter_range" text,
	"quarter_name" text,
	"quarter_report" text,
	"status" text,
	"total_income" numeric(12, 2),
	"total_expenses" numeric(12, 2),
	"net_cashflow" numeric(12, 2),
	"category_summary" text,
	"key_learnings" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quarters_id" uuid,
	"days" uuid[],
	"financial_log" uuid[],
	"quarterly_goals" uuid[],
	"year" integer,
	"month_number" integer,
	"month_name" text,
	"month_range" text,
	"month_start" timestamp with time zone,
	"month_end" timestamp with time zone,
	"month_json" text,
	"status" text,
	"total_income" numeric(12, 2),
	"total_expenses" numeric(12, 2),
	"net_cashflow" numeric(12, 2),
	"category_summary" text,
	"ending_net_worth" numeric(14, 2),
	"net_worth_change" numeric(14, 2),
	"accounts_involved" text[],
	"projects_active" text,
	"cashflow_narrative" text,
	"capital_allocation_insight" text,
	"accounts_snapshot" text,
	"key_learnings" text,
	"significant_events" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"days" uuid[],
	"tasks" uuid[],
	"financial_log" uuid[],
	"year" integer,
	"week_number" integer,
	"week_name" text,
	"week_range" text,
	"week_start" timestamp with time zone,
	"week_end" timestamp with time zone,
	"week_json" text,
	"status" text,
	"tasks_progress" text,
	"activity_breakdown" text,
	"total_income" numeric(12, 2),
	"total_expenses" numeric(12, 2),
	"net_cashflow" numeric(12, 2),
	"category_summary" text,
	"key_learnings" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"months_id" uuid,
	"weeks" uuid[],
	"diet_log" uuid[],
	"subjective_journal" uuid[],
	"relational_journal" uuid[],
	"systemic_journal" uuid[],
	"activity_log" uuid[],
	"year" integer,
	"day_number" integer,
	"health_score" integer,
	"date" date,
	"day_name" text,
	"day_json" text,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annual_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal_id" text,
	"years_id" uuid,
	"primary_metric_id" uuid,
	"vision_id" uuid,
	"quarterly_goals" uuid[],
	"status" text DEFAULT 'Draft' NOT NULL,
	"goal_archetype" text,
	"is_current_goal" boolean,
	"goal_progress" text,
	"monitor" text,
	"annual_goal_report" text,
	"planned_range" text,
	"the_epic" text,
	"strategic_intent" text,
	"strategic_approach" text,
	"success_condition" text,
	"key_risks" text,
	"target_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_goals_goal_id_unique" UNIQUE("goal_id")
);
--> statement-breakpoint
CREATE TABLE "quarterly_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal_id" text,
	"annual_goal_id" uuid,
	"quarters" uuid[],
	"projects" uuid[],
	"directives_risk_log" uuid[],
	"opportunities_strengths" uuid[],
	"status" text DEFAULT 'Planning' NOT NULL,
	"is_current_goal" boolean,
	"goal_progress" text,
	"progress" numeric(5, 2),
	"health" text,
	"monitor" text,
	"planned_range" text,
	"quarterly_goal_json" text,
	"key_result_1" text,
	"key_result_2" text,
	"key_result_3" text,
	"key_learning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quarterly_goals_goal_id_unique" UNIQUE("goal_id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"first_name" text,
	"custom_name" text,
	"summary" text,
	"strategic_context" text,
	"engagement_blueprint" text,
	"professional_domain" text,
	"origin_context" text,
	"key_personal_intel" text,
	"email" text,
	"connection_frequency_days" integer,
	"last_connected_date" timestamp with time zone,
	"reconnect_by" text,
	"networking_profile" text,
	"relationship_status" text,
	"value_exchange_balance" text,
	"core_shadow" text,
	"developmental_altitude" text,
	"aspirational_drive" text,
	"temporal_focus" text,
	"primary_center_of_intelligence" text,
	"dominant_power_strategy" text,
	"city" text,
	"primary_conflict_style" text,
	"timezone" text,
	"desired_trajectory" text,
	"stability_profile" text,
	"last_interaction_sentiment" text,
	"explanatory_style" text,
	"influence_toolkit" text[],
	"community_id" uuid,
	"stories" uuid[],
	"projects" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"activity_log" uuid[],
	"frequency" text,
	"duration_hrs" numeric(4, 1),
	"target_per_week" integer,
	"is_habit" boolean,
	"is_health_tracked" boolean,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"activity_id" text,
	"activity_type_id" uuid,
	"days_id" uuid,
	"projects" uuid[],
	"energy" text,
	"mood_delta" text,
	"date_range" timestamp with time zone,
	"date_end" timestamp with time zone,
	"duration_hrs" numeric(4, 2),
	"activity_type" text,
	"activity_notes" text,
	"activity_json" text,
	"is_habit_activity" boolean,
	"is_logged" boolean,
	"notes_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_log_activity_id_unique" UNIQUE("activity_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"task_id" text,
	"status" text DEFAULT 'Up Next' NOT NULL,
	"parent_task_id" uuid,
	"sub_task_id" uuid,
	"project_id" uuid,
	"week_id" uuid,
	"blocks" uuid[],
	"blocked_by" uuid,
	"priority" text,
	"assignee" text,
	"tags" text[],
	"action_date" timestamp with time zone,
	"completed_date" timestamp with time zone,
	"estimated_hours" numeric(5, 2),
	"description" text,
	"sprint_status" text,
	"monitor" text,
	"project_status" text,
	"last_edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"project_id" text,
	"status" text DEFAULT 'On Hold' NOT NULL,
	"phase" text,
	"priority" text,
	"team" text[],
	"project_start" timestamp with time zone,
	"deadline" timestamp with time zone,
	"review_date" timestamp with time zone,
	"budget_allocated" numeric(12, 2),
	"budget_spent" numeric(12, 2),
	"required_budget" numeric(12, 2),
	"projected_revenue" numeric(12, 2),
	"project_summary" text,
	"justification" text,
	"kpi" text,
	"kpi_status" text,
	"strategy" text,
	"quarterly_goal_id" uuid,
	"tasks" uuid[],
	"depends_on" uuid[],
	"dependents" uuid[],
	"people" uuid[],
	"campaigns" uuid[],
	"activity_log" uuid[],
	"financial_log" uuid[],
	"systemic_journal" uuid[],
	"documents" uuid[],
	"notes" uuid[],
	"directives_risks" uuid[],
	"opportunities" uuid[],
	"health" text,
	"monitor" text,
	"progress" numeric(5, 2),
	"project_json" text,
	"project_progress" text,
	"duration_days" text,
	"cost_to_date" numeric(12, 2),
	"last_edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"campaign_id" text,
	"status" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"duration_days" integer,
	"platforms" text[],
	"content_types" text[],
	"automation_workflows" text[],
	"content_frequency" text,
	"theme" text,
	"summary" text,
	"demographics" text,
	"psychographics" text,
	"seo_keywords" text,
	"content_waterfall" text,
	"target_reach" integer,
	"actual_reach" integer,
	"engagement_rate" numeric(5, 4),
	"conversion_rate" numeric(5, 4),
	"viral_score" integer,
	"budget_allocated" numeric(12, 2),
	"projects" uuid[],
	"content_pipeline" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_campaign_id_unique" UNIQUE("campaign_id")
);
--> statement-breakpoint
CREATE TABLE "content_pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_id" text,
	"status" text DEFAULT 'Potential Idea' NOT NULL,
	"pillar" text,
	"funnel_stage" text,
	"tone" text,
	"platforms" text[],
	"format" text[],
	"is_evergreen" boolean,
	"action_date" timestamp with time zone,
	"publish_date" timestamp with time zone,
	"parent_content_id" uuid,
	"child_content" uuid[],
	"campaign_id" uuid,
	"projects" uuid[],
	"topic_hook" text,
	"content_body" text,
	"live_url" text,
	"media_assets" jsonb,
	"reach" integer,
	"engagement" integer,
	"clicks" integer,
	"engagement_rate" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_pipeline_content_id_unique" UNIQUE("content_id")
);
--> statement-breakpoint
CREATE TABLE "subjective_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entry_id" text,
	"date" timestamp with time zone,
	"days_id" uuid,
	"sleep_hours" numeric(4, 1),
	"stress_level" text,
	"energy_level" text,
	"mood_trigger" text[],
	"psychograph" text,
	"subjective_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjective_journal_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "relational_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entry_id" text,
	"date" timestamp with time zone,
	"days_id" uuid,
	"people_id" uuid,
	"interaction_type" text,
	"sentiment" text,
	"follow_up_needed" boolean,
	"relationship_status" text[],
	"relational_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relational_journal_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "systemic_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entry_id" text,
	"date" timestamp with time zone,
	"created_time" timestamp with time zone,
	"days_id" uuid,
	"impact" text,
	"projects" uuid[],
	"directives_risk_log" uuid[],
	"opportunities_strengths" uuid[],
	"ai_generated_report" text,
	"systemic_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "systemic_journal_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "diet_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entry_id" text,
	"date" timestamp with time zone,
	"log_type" text,
	"meal_type" text,
	"calories" integer,
	"nutrition" text,
	"protein_g" numeric(6, 1),
	"water_ml" integer,
	"caffeine_mg" integer,
	"supplements" text[],
	"mood" text,
	"energy_level" text,
	"sleep_quality" text,
	"symptoms" text[],
	"environment" text[],
	"vitals_notes" text,
	"diet_json" text,
	"days_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diet_log_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "financial_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"transaction_id" text,
	"date" timestamp with time zone,
	"signed_amount" numeric(12, 2),
	"category" text,
	"capital_engine" text,
	"is_recurring" boolean,
	"receipt_files" jsonb,
	"receipt_url" text,
	"notes" text,
	"is_financial" boolean,
	"legacy_amount" text,
	"financial_elater" text,
	"transaction_type" text,
	"financial_json" text,
	"week_id" uuid,
	"month_id" uuid,
	"project_id" uuid,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_log_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"status" text,
	"sub_type" text,
	"type" text[],
	"capital_engine" text,
	"currency" text,
	"current_balance" numeric(14, 2),
	"interest_rate" numeric(5, 2),
	"balance_as_of" timestamp with time zone,
	"related_statements" text,
	"related_transactions" text,
	"last_updated" timestamp with time zone,
	"current_status" numeric(14, 2),
	"active_range" text,
	"financial_logs" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directives_risk_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entry_id" text,
	"log_type" text,
	"status" text DEFAULT 'Identified' NOT NULL,
	"likelihood" text,
	"impact" text,
	"threat_level" text,
	"protocol_scenario" text,
	"last_assessed" timestamp with time zone,
	"drl_json" text,
	"projects" uuid[],
	"quarterly_goal_id" uuid,
	"systemic_journal" uuid[],
	"mitigates" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directives_risk_log_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "opportunities_strengths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"log_type" text,
	"status" text DEFAULT '💡 Identified' NOT NULL,
	"leverage_score" text,
	"opportunity_type" text,
	"description" text,
	"last_assessed" timestamp with time zone,
	"activation_date" timestamp with time zone,
	"projects" uuid[],
	"quarterly_goal_id" uuid,
	"systemic_journal" uuid[],
	"synergizes_with" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"report_id" text,
	"agent" text,
	"report_type" text,
	"period_covered" timestamp with time zone,
	"report" text,
	"created_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
CREATE TABLE "notes_management" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'New Note' NOT NULL,
	"agent" text,
	"agent_secondary" text,
	"report" text,
	"report_extra" text,
	"project_id" uuid,
	"project_status" text,
	"knowledge_categories" uuid[],
	"created_time" timestamp with time zone,
	"last_edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"session_id" text,
	"title" text,
	"workspace_path" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_used" timestamp with time zone,
	"message_count" integer DEFAULT 0,
	"compaction_count" integer DEFAULT 0,
	"previous_summary" text,
	"has_real_conversation" boolean DEFAULT false,
	CONSTRAINT "agent_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "board_meeting_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"turn_number" integer NOT NULL,
	"agent_id" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls_made" integer DEFAULT 0,
	"tool_calls_details" jsonb,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_meeting_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"turn_number" integer NOT NULL,
	"ceo_directive" text,
	"ceo_response" text,
	"synthesis" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "board_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled',
	"objective" text,
	"report" text,
	"user_decision" text,
	"user_feedback" text,
	"started_at" timestamp with time zone,
	"concluded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kanban_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kanban_card_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "kanban_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text,
	"due" timestamp with time zone,
	"tags" jsonb,
	"assignee_agent_id" text,
	"project_id" uuid,
	"last_update" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kanban_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ord" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kanban_reporting_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" text NOT NULL,
	"report_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "message_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"from_agent" text NOT NULL,
	"to_agent" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"status" text DEFAULT 'pending'
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participants" jsonb NOT NULL,
	"subject" text,
	"status" text DEFAULT 'active',
	"tags" jsonb,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"from_agent" text NOT NULL,
	"to_agent" text NOT NULL,
	"content" text NOT NULL,
	"priority" text DEFAULT 'P3',
	"requires_response" boolean DEFAULT false,
	"responded" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"read" boolean DEFAULT false,
	"tags" jsonb,
	"embedding" jsonb
);
--> statement-breakpoint
CREATE TABLE "oc_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"oc_session_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ops_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"period" text,
	"summary" text,
	"metrics" jsonb,
	"actions" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ops_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"last_active" timestamp with time zone,
	"status" text DEFAULT 'active'
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"message_index" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"token_estimate" integer,
	"is_summary" boolean DEFAULT false,
	"compacted" boolean DEFAULT false,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"step_num" integer NOT NULL,
	"step_type" text NOT NULL,
	"tool" text,
	"args_hash" text,
	"obs_summary" text,
	"ts" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tool_index" integer NOT NULL,
	"call_id" text,
	"name" text NOT NULL,
	"arguments" jsonb,
	"result" jsonb,
	"token_estimate" integer,
	"compacted" boolean DEFAULT false,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_correlations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool" text NOT NULL,
	"args_hash" text NOT NULL,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_people" (
	"project_id" uuid NOT NULL,
	"people_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_people" PRIMARY KEY("project_id","people_id")
);
--> statement-breakpoint
CREATE TABLE "project_directives" (
	"project_id" uuid NOT NULL,
	"directive_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_directives" PRIMARY KEY("project_id","directive_id")
);
--> statement-breakpoint
CREATE TABLE "project_opportunities" (
	"project_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_opportunities" PRIMARY KEY("project_id","opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_platforms" (
	"campaign_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_campaign_platforms" PRIMARY KEY("campaign_id","platform")
);
--> statement-breakpoint
CREATE TABLE "content_platforms" (
	"content_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_content_platforms" PRIMARY KEY("content_id","platform")
);
--> statement-breakpoint
ALTER TABLE "quarters" ADD CONSTRAINT "quarters_years_id_years_id_fk" FOREIGN KEY ("years_id") REFERENCES "public"."years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "months" ADD CONSTRAINT "months_quarters_id_quarters_id_fk" FOREIGN KEY ("quarters_id") REFERENCES "public"."quarters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "days" ADD CONSTRAINT "days_months_id_months_id_fk" FOREIGN KEY ("months_id") REFERENCES "public"."months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_goals" ADD CONSTRAINT "annual_goals_years_id_years_id_fk" FOREIGN KEY ("years_id") REFERENCES "public"."years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarterly_goals" ADD CONSTRAINT "quarterly_goals_annual_goal_id_annual_goals_id_fk" FOREIGN KEY ("annual_goal_id") REFERENCES "public"."annual_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_days_id_days_id_fk" FOREIGN KEY ("days_id") REFERENCES "public"."days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sub_task_id_tasks_id_fk" FOREIGN KEY ("sub_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_blocked_by_tasks_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_quarterly_goal_id_quarterly_goals_id_fk" FOREIGN KEY ("quarterly_goal_id") REFERENCES "public"."quarterly_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pipeline" ADD CONSTRAINT "content_pipeline_parent_content_id_content_pipeline_id_fk" FOREIGN KEY ("parent_content_id") REFERENCES "public"."content_pipeline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pipeline" ADD CONSTRAINT "content_pipeline_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjective_journal" ADD CONSTRAINT "subjective_journal_days_id_days_id_fk" FOREIGN KEY ("days_id") REFERENCES "public"."days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relational_journal" ADD CONSTRAINT "relational_journal_days_id_days_id_fk" FOREIGN KEY ("days_id") REFERENCES "public"."days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relational_journal" ADD CONSTRAINT "relational_journal_people_id_people_id_fk" FOREIGN KEY ("people_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "systemic_journal" ADD CONSTRAINT "systemic_journal_days_id_days_id_fk" FOREIGN KEY ("days_id") REFERENCES "public"."days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diet_log" ADD CONSTRAINT "diet_log_days_id_days_id_fk" FOREIGN KEY ("days_id") REFERENCES "public"."days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_log" ADD CONSTRAINT "financial_log_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_log" ADD CONSTRAINT "financial_log_month_id_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_log" ADD CONSTRAINT "financial_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_log" ADD CONSTRAINT "financial_log_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directives_risk_log" ADD CONSTRAINT "directives_risk_log_quarterly_goal_id_quarterly_goals_id_fk" FOREIGN KEY ("quarterly_goal_id") REFERENCES "public"."quarterly_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities_strengths" ADD CONSTRAINT "opportunities_strengths_quarterly_goal_id_quarterly_goals_id_fk" FOREIGN KEY ("quarterly_goal_id") REFERENCES "public"."quarterly_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_management" ADD CONSTRAINT "notes_management_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_meeting_responses" ADD CONSTRAINT "board_meeting_responses_meeting_id_board_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."board_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_meeting_turns" ADD CONSTRAINT "board_meeting_turns_meeting_id_board_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."board_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_card_activity" ADD CONSTRAINT "kanban_card_activity_card_id_kanban_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."kanban_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_board_id_kanban_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."kanban_boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_column_id_kanban_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."kanban_columns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_cards" ADD CONSTRAINT "kanban_cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kanban_columns" ADD CONSTRAINT "kanban_columns_board_id_kanban_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."kanban_boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_escalations" ADD CONSTRAINT "message_escalations_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_steps" ADD CONSTRAINT "session_steps_session_id_ops_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ops_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tool_calls" ADD CONSTRAINT "session_tool_calls_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_people" ADD CONSTRAINT "project_people_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_people" ADD CONSTRAINT "project_people_people_id_people_id_fk" FOREIGN KEY ("people_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_directives" ADD CONSTRAINT "project_directives_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_directives" ADD CONSTRAINT "project_directives_directive_id_directives_risk_log_id_fk" FOREIGN KEY ("directive_id") REFERENCES "public"."directives_risk_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_opportunities" ADD CONSTRAINT "project_opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_opportunities" ADD CONSTRAINT "project_opportunities_opportunity_id_opportunities_strengths_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities_strengths"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_platforms" ADD CONSTRAINT "campaign_platforms_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_platforms" ADD CONSTRAINT "content_platforms_content_id_content_pipeline_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_pipeline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_years_status" ON "years" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_years_annual_goals" ON "years" USING btree ("annual_goals");--> statement-breakpoint
CREATE INDEX "idx_years_quarters" ON "years" USING btree ("quarters");--> statement-breakpoint
CREATE INDEX "idx_years_quarterly_goals" ON "years" USING btree ("quarterly_goals");--> statement-breakpoint
CREATE INDEX "idx_quarters_status" ON "quarters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_quarters_years_id" ON "quarters" USING btree ("years_id");--> statement-breakpoint
CREATE INDEX "idx_quarters_quarter_number" ON "quarters" USING btree ("quarter_number");--> statement-breakpoint
CREATE INDEX "idx_quarters_quarter_start" ON "quarters" USING btree ("quarter_start");--> statement-breakpoint
CREATE INDEX "idx_quarters_quarter_end" ON "quarters" USING btree ("quarter_end");--> statement-breakpoint
CREATE INDEX "idx_quarters_months" ON "quarters" USING btree ("months");--> statement-breakpoint
CREATE INDEX "idx_quarters_quarterly_goals" ON "quarters" USING btree ("quarterly_goals");--> statement-breakpoint
CREATE INDEX "idx_months_status" ON "months" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_months_quarters_id" ON "months" USING btree ("quarters_id");--> statement-breakpoint
CREATE INDEX "idx_months_year" ON "months" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_months_month_number" ON "months" USING btree ("month_number");--> statement-breakpoint
CREATE INDEX "idx_months_month_start" ON "months" USING btree ("month_start");--> statement-breakpoint
CREATE INDEX "idx_months_month_end" ON "months" USING btree ("month_end");--> statement-breakpoint
CREATE INDEX "idx_months_days" ON "months" USING btree ("days");--> statement-breakpoint
CREATE INDEX "idx_months_financial_log" ON "months" USING btree ("financial_log");--> statement-breakpoint
CREATE INDEX "idx_months_quarterly_goals" ON "months" USING btree ("quarterly_goals");--> statement-breakpoint
CREATE INDEX "idx_months_accounts_involved" ON "months" USING btree ("accounts_involved");--> statement-breakpoint
CREATE INDEX "idx_weeks_status" ON "weeks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_weeks_year" ON "weeks" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_weeks_week_number" ON "weeks" USING btree ("week_number");--> statement-breakpoint
CREATE INDEX "idx_weeks_week_start" ON "weeks" USING btree ("week_start");--> statement-breakpoint
CREATE INDEX "idx_weeks_week_end" ON "weeks" USING btree ("week_end");--> statement-breakpoint
CREATE INDEX "idx_weeks_days" ON "weeks" USING btree ("days");--> statement-breakpoint
CREATE INDEX "idx_weeks_tasks" ON "weeks" USING btree ("tasks");--> statement-breakpoint
CREATE INDEX "idx_weeks_financial_log" ON "weeks" USING btree ("financial_log");--> statement-breakpoint
CREATE INDEX "idx_days_status" ON "days" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_days_months_id" ON "days" USING btree ("months_id");--> statement-breakpoint
CREATE INDEX "idx_days_year" ON "days" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_days_day_number" ON "days" USING btree ("day_number");--> statement-breakpoint
CREATE INDEX "idx_days_date" ON "days" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_days_weeks" ON "days" USING btree ("weeks");--> statement-breakpoint
CREATE INDEX "idx_days_diet_log" ON "days" USING btree ("diet_log");--> statement-breakpoint
CREATE INDEX "idx_days_subjective_journal" ON "days" USING btree ("subjective_journal");--> statement-breakpoint
CREATE INDEX "idx_days_relational_journal" ON "days" USING btree ("relational_journal");--> statement-breakpoint
CREATE INDEX "idx_days_systemic_journal" ON "days" USING btree ("systemic_journal");--> statement-breakpoint
CREATE INDEX "idx_days_activity_log" ON "days" USING btree ("activity_log");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_status" ON "annual_goals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_years_id" ON "annual_goals" USING btree ("years_id");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_goal_id" ON "annual_goals" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_vision_id" ON "annual_goals" USING btree ("vision_id");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_primary_metric_id" ON "annual_goals" USING btree ("primary_metric_id");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_quarterly_goals" ON "annual_goals" USING btree ("quarterly_goals");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_goal_archetype" ON "annual_goals" USING btree ("goal_archetype");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_is_current_goal" ON "annual_goals" USING btree ("is_current_goal");--> statement-breakpoint
CREATE INDEX "idx_quarterly_goals_status" ON "quarterly_goals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_quarterly_goals_annual_goal_id" ON "quarterly_goals" USING btree ("annual_goal_id");--> statement-breakpoint
CREATE INDEX "idx_quarterly_goals_goal_id" ON "quarterly_goals" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "idx_quarterly_goals_progress" ON "quarterly_goals" USING btree ("progress");--> statement-breakpoint
CREATE INDEX "idx_quarterly_goals_quarters" ON "quarterly_goals" USING btree ("quarters");--> statement-breakpoint
CREATE INDEX "idx_quarterly_goals_projects" ON "quarterly_goals" USING btree ("projects");--> statement-breakpoint
CREATE INDEX "idx_quarterly_goals_directives_risk_log" ON "quarterly_goals" USING btree ("directives_risk_log");--> statement-breakpoint
CREATE INDEX "idx_quarterly_goals_opportunities_strengths" ON "quarterly_goals" USING btree ("opportunities_strengths");--> statement-breakpoint
CREATE INDEX "idx_quarterly_goals_is_current_goal" ON "quarterly_goals" USING btree ("is_current_goal");--> statement-breakpoint
CREATE INDEX "idx_people_networking_profile" ON "people" USING btree ("networking_profile");--> statement-breakpoint
CREATE INDEX "idx_people_relationship_status" ON "people" USING btree ("relationship_status");--> statement-breakpoint
CREATE INDEX "idx_people_value_exchange_balance" ON "people" USING btree ("value_exchange_balance");--> statement-breakpoint
CREATE INDEX "idx_people_desired_trajectory" ON "people" USING btree ("desired_trajectory");--> statement-breakpoint
CREATE INDEX "idx_people_city" ON "people" USING btree ("city");--> statement-breakpoint
CREATE INDEX "idx_people_timezone" ON "people" USING btree ("timezone");--> statement-breakpoint
CREATE INDEX "idx_people_last_connected_date" ON "people" USING btree ("last_connected_date");--> statement-breakpoint
CREATE INDEX "idx_people_community_id" ON "people" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "idx_people_stories" ON "people" USING btree ("stories");--> statement-breakpoint
CREATE INDEX "idx_people_projects" ON "people" USING btree ("projects");--> statement-breakpoint
CREATE INDEX "idx_people_influence_toolkit" ON "people" USING btree ("influence_toolkit");--> statement-breakpoint
CREATE INDEX "idx_people_dominant_power_strategy" ON "people" USING btree ("dominant_power_strategy");--> statement-breakpoint
CREATE INDEX "idx_people_primary_conflict_style" ON "people" USING btree ("primary_conflict_style");--> statement-breakpoint
CREATE INDEX "idx_people_explanatory_style" ON "people" USING btree ("explanatory_style");--> statement-breakpoint
CREATE INDEX "idx_activity_types_category" ON "activity_types" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_activity_types_frequency" ON "activity_types" USING btree ("frequency");--> statement-breakpoint
CREATE INDEX "idx_activity_types_activity_log" ON "activity_types" USING btree ("activity_log");--> statement-breakpoint
CREATE INDEX "idx_activity_log_energy" ON "activity_log" USING btree ("energy");--> statement-breakpoint
CREATE INDEX "idx_activity_log_mood_delta" ON "activity_log" USING btree ("mood_delta");--> statement-breakpoint
CREATE INDEX "idx_activity_log_activity_type" ON "activity_log" USING btree ("activity_type");--> statement-breakpoint
CREATE INDEX "idx_activity_log_activity_type_id" ON "activity_log" USING btree ("activity_type_id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_days_id" ON "activity_log" USING btree ("days_id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_projects" ON "activity_log" USING btree ("projects");--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_priority" ON "tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_tasks_project_id" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_week_id" ON "tasks" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_parent_task_id" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_blocked_by" ON "tasks" USING btree ("blocked_by");--> statement-breakpoint
CREATE INDEX "idx_tasks_action_date" ON "tasks" USING btree ("action_date");--> statement-breakpoint
CREATE INDEX "idx_tasks_tags" ON "tasks" USING btree ("tags");--> statement-breakpoint
CREATE INDEX "idx_tasks_blocks" ON "tasks" USING btree ("blocks");--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_projects_phase" ON "projects" USING btree ("phase");--> statement-breakpoint
CREATE INDEX "idx_projects_priority" ON "projects" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_projects_deadline" ON "projects" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "idx_projects_quarterly_goal_id" ON "projects" USING btree ("quarterly_goal_id");--> statement-breakpoint
CREATE INDEX "idx_projects_team" ON "projects" USING btree ("team");--> statement-breakpoint
CREATE INDEX "idx_projects_tasks" ON "projects" USING btree ("tasks");--> statement-breakpoint
CREATE INDEX "idx_projects_depends_on" ON "projects" USING btree ("depends_on");--> statement-breakpoint
CREATE INDEX "idx_projects_dependents" ON "projects" USING btree ("dependents");--> statement-breakpoint
CREATE INDEX "idx_projects_people" ON "projects" USING btree ("people");--> statement-breakpoint
CREATE INDEX "idx_projects_campaigns" ON "projects" USING btree ("campaigns");--> statement-breakpoint
CREATE INDEX "idx_projects_activity_log" ON "projects" USING btree ("activity_log");--> statement-breakpoint
CREATE INDEX "idx_projects_financial_log" ON "projects" USING btree ("financial_log");--> statement-breakpoint
CREATE INDEX "idx_projects_systemic_journal" ON "projects" USING btree ("systemic_journal");--> statement-breakpoint
CREATE INDEX "idx_projects_documents" ON "projects" USING btree ("documents");--> statement-breakpoint
CREATE INDEX "idx_projects_notes" ON "projects" USING btree ("notes");--> statement-breakpoint
CREATE INDEX "idx_projects_directives_risks" ON "projects" USING btree ("directives_risks");--> statement-breakpoint
CREATE INDEX "idx_projects_opportunities" ON "projects" USING btree ("opportunities");--> statement-breakpoint
CREATE INDEX "idx_campaigns_status" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_campaigns_start_date" ON "campaigns" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "idx_campaigns_end_date" ON "campaigns" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "idx_campaigns_content_frequency" ON "campaigns" USING btree ("content_frequency");--> statement-breakpoint
CREATE INDEX "idx_campaigns_platforms" ON "campaigns" USING btree ("platforms");--> statement-breakpoint
CREATE INDEX "idx_campaigns_content_types" ON "campaigns" USING btree ("content_types");--> statement-breakpoint
CREATE INDEX "idx_campaigns_automation_workflows" ON "campaigns" USING btree ("automation_workflows");--> statement-breakpoint
CREATE INDEX "idx_campaigns_projects" ON "campaigns" USING btree ("projects");--> statement-breakpoint
CREATE INDEX "idx_campaigns_content_pipeline" ON "campaigns" USING btree ("content_pipeline");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_status" ON "content_pipeline" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_pillar" ON "content_pipeline" USING btree ("pillar");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_funnel_stage" ON "content_pipeline" USING btree ("funnel_stage");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_publish_date" ON "content_pipeline" USING btree ("publish_date");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_parent_content_id" ON "content_pipeline" USING btree ("parent_content_id");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_campaign_id" ON "content_pipeline" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_platforms" ON "content_pipeline" USING btree ("platforms");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_format" ON "content_pipeline" USING btree ("format");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_child_content" ON "content_pipeline" USING btree ("child_content");--> statement-breakpoint
CREATE INDEX "idx_content_pipeline_projects" ON "content_pipeline" USING btree ("projects");--> statement-breakpoint
CREATE INDEX "idx_subjective_journal_date" ON "subjective_journal" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_subjective_journal_days_id" ON "subjective_journal" USING btree ("days_id");--> statement-breakpoint
CREATE INDEX "idx_subjective_journal_stress_level" ON "subjective_journal" USING btree ("stress_level");--> statement-breakpoint
CREATE INDEX "idx_subjective_journal_energy_level" ON "subjective_journal" USING btree ("energy_level");--> statement-breakpoint
CREATE INDEX "idx_subjective_journal_mood_trigger" ON "subjective_journal" USING btree ("mood_trigger");--> statement-breakpoint
CREATE INDEX "idx_relational_journal_date" ON "relational_journal" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_relational_journal_days_id" ON "relational_journal" USING btree ("days_id");--> statement-breakpoint
CREATE INDEX "idx_relational_journal_people_id" ON "relational_journal" USING btree ("people_id");--> statement-breakpoint
CREATE INDEX "idx_relational_journal_interaction_type" ON "relational_journal" USING btree ("interaction_type");--> statement-breakpoint
CREATE INDEX "idx_relational_journal_sentiment" ON "relational_journal" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "idx_relational_journal_relationship_status" ON "relational_journal" USING btree ("relationship_status");--> statement-breakpoint
CREATE INDEX "idx_systemic_journal_date" ON "systemic_journal" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_systemic_journal_created_time" ON "systemic_journal" USING btree ("created_time");--> statement-breakpoint
CREATE INDEX "idx_systemic_journal_days_id" ON "systemic_journal" USING btree ("days_id");--> statement-breakpoint
CREATE INDEX "idx_systemic_journal_impact" ON "systemic_journal" USING btree ("impact");--> statement-breakpoint
CREATE INDEX "idx_systemic_journal_projects" ON "systemic_journal" USING btree ("projects");--> statement-breakpoint
CREATE INDEX "idx_systemic_journal_directives_risk_log" ON "systemic_journal" USING btree ("directives_risk_log");--> statement-breakpoint
CREATE INDEX "idx_systemic_journal_opportunities_strengths" ON "systemic_journal" USING btree ("opportunities_strengths");--> statement-breakpoint
CREATE INDEX "idx_diet_log_entry_id" ON "diet_log" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "idx_diet_log_date" ON "diet_log" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_diet_log_log_type" ON "diet_log" USING btree ("log_type");--> statement-breakpoint
CREATE INDEX "idx_diet_log_meal_type" ON "diet_log" USING btree ("meal_type");--> statement-breakpoint
CREATE INDEX "idx_diet_log_mood" ON "diet_log" USING btree ("mood");--> statement-breakpoint
CREATE INDEX "idx_diet_log_days_id" ON "diet_log" USING btree ("days_id");--> statement-breakpoint
CREATE INDEX "idx_diet_log_supplements" ON "diet_log" USING btree ("supplements");--> statement-breakpoint
CREATE INDEX "idx_diet_log_symptoms" ON "diet_log" USING btree ("symptoms");--> statement-breakpoint
CREATE INDEX "idx_diet_log_environment" ON "diet_log" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "idx_financial_log_transaction_id" ON "financial_log" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_financial_log_date" ON "financial_log" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_financial_log_category" ON "financial_log" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_financial_log_capital_engine" ON "financial_log" USING btree ("capital_engine");--> statement-breakpoint
CREATE INDEX "idx_financial_log_signed_amount" ON "financial_log" USING btree ("signed_amount");--> statement-breakpoint
CREATE INDEX "idx_financial_log_is_recurring" ON "financial_log" USING btree ("is_recurring");--> statement-breakpoint
CREATE INDEX "idx_financial_log_week_id" ON "financial_log" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "idx_financial_log_month_id" ON "financial_log" USING btree ("month_id");--> statement-breakpoint
CREATE INDEX "idx_financial_log_project_id" ON "financial_log" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_financial_log_account_id" ON "financial_log" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_financial_log_transaction_type" ON "financial_log" USING btree ("transaction_type");--> statement-breakpoint
CREATE INDEX "idx_financial_accounts_status" ON "financial_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_financial_accounts_sub_type" ON "financial_accounts" USING btree ("sub_type");--> statement-breakpoint
CREATE INDEX "idx_financial_accounts_capital_engine" ON "financial_accounts" USING btree ("capital_engine");--> statement-breakpoint
CREATE INDEX "idx_financial_accounts_currency" ON "financial_accounts" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "idx_financial_accounts_type" ON "financial_accounts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_financial_accounts_financial_logs" ON "financial_accounts" USING btree ("financial_logs");--> statement-breakpoint
CREATE INDEX "idx_drl_entry_id" ON "directives_risk_log" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "idx_drl_log_type" ON "directives_risk_log" USING btree ("log_type");--> statement-breakpoint
CREATE INDEX "idx_drl_status" ON "directives_risk_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_drl_likelihood" ON "directives_risk_log" USING btree ("likelihood");--> statement-breakpoint
CREATE INDEX "idx_drl_impact" ON "directives_risk_log" USING btree ("impact");--> statement-breakpoint
CREATE INDEX "idx_drl_threat_level" ON "directives_risk_log" USING btree ("threat_level");--> statement-breakpoint
CREATE INDEX "idx_drl_last_assessed" ON "directives_risk_log" USING btree ("last_assessed");--> statement-breakpoint
CREATE INDEX "idx_drl_quarterly_goal_id" ON "directives_risk_log" USING btree ("quarterly_goal_id");--> statement-breakpoint
CREATE INDEX "idx_drl_projects" ON "directives_risk_log" USING btree ("projects");--> statement-breakpoint
CREATE INDEX "idx_drl_systemic_journal" ON "directives_risk_log" USING btree ("systemic_journal");--> statement-breakpoint
CREATE INDEX "idx_drl_mitigates" ON "directives_risk_log" USING btree ("mitigates");--> statement-breakpoint
CREATE INDEX "idx_os_log_type" ON "opportunities_strengths" USING btree ("log_type");--> statement-breakpoint
CREATE INDEX "idx_os_status" ON "opportunities_strengths" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_os_leverage_score" ON "opportunities_strengths" USING btree ("leverage_score");--> statement-breakpoint
CREATE INDEX "idx_os_opportunity_type" ON "opportunities_strengths" USING btree ("opportunity_type");--> statement-breakpoint
CREATE INDEX "idx_os_last_assessed" ON "opportunities_strengths" USING btree ("last_assessed");--> statement-breakpoint
CREATE INDEX "idx_os_activation_date" ON "opportunities_strengths" USING btree ("activation_date");--> statement-breakpoint
CREATE INDEX "idx_os_quarterly_goal_id" ON "opportunities_strengths" USING btree ("quarterly_goal_id");--> statement-breakpoint
CREATE INDEX "idx_os_projects" ON "opportunities_strengths" USING btree ("projects");--> statement-breakpoint
CREATE INDEX "idx_os_systemic_journal" ON "opportunities_strengths" USING btree ("systemic_journal");--> statement-breakpoint
CREATE INDEX "idx_os_synergizes_with" ON "opportunities_strengths" USING btree ("synergizes_with");--> statement-breakpoint
CREATE INDEX "idx_reports_report_id" ON "reports" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "idx_reports_agent" ON "reports" USING btree ("agent");--> statement-breakpoint
CREATE INDEX "idx_reports_report_type" ON "reports" USING btree ("report_type");--> statement-breakpoint
CREATE INDEX "idx_reports_period_covered" ON "reports" USING btree ("period_covered");--> statement-breakpoint
CREATE INDEX "idx_notes_status" ON "notes_management" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_notes_agent" ON "notes_management" USING btree ("agent");--> statement-breakpoint
CREATE INDEX "idx_notes_project_id" ON "notes_management" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_notes_knowledge_categories" ON "notes_management" USING btree ("knowledge_categories");--> statement-breakpoint
CREATE INDEX "idx_notes_created_time" ON "notes_management" USING btree ("created_time");