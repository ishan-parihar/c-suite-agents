CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
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
ALTER TABLE "diet_log" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "notes_management" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "notes_management" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "notes_management" ADD COLUMN "cover_image" text;--> statement-breakpoint
ALTER TABLE "notes_management" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "notes_management" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "notes_management" ADD COLUMN "ord" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "notes_management" ADD COLUMN "is_favorite" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "notes_management" ADD COLUMN "is_archived" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "board_meetings" ADD COLUMN "content" jsonb;--> statement-breakpoint
CREATE INDEX "idx_outbox_published" ON "outbox_events" USING btree ("published");--> statement-breakpoint
CREATE INDEX "idx_outbox_entity" ON "outbox_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_outbox_created" ON "outbox_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_attempts" ON "outbox_events" USING btree ("attempts");--> statement-breakpoint
CREATE INDEX "idx_transition_log_task" ON "transition_log" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_transition_log_occurred" ON "transition_log" USING btree ("occurred_at");--> statement-breakpoint
ALTER TABLE "notes_management" ADD CONSTRAINT "notes_management_parent_id_notes_management_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."notes_management"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notes_parent_id" ON "notes_management" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_notes_is_archived" ON "notes_management" USING btree ("is_archived");