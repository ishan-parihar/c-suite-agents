CREATE TABLE "transition_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"reason" text NOT NULL,
	"agent_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annual_goals" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "quarterly_goals" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "subjective_journal" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "relational_journal" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "systemic_journal" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "board_meetings" ADD COLUMN "content" jsonb;--> statement-breakpoint
CREATE INDEX "idx_transition_log_task" ON "transition_log" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_transition_log_occurred" ON "transition_log" USING btree ("occurred_at");