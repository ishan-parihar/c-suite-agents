CREATE TABLE "notion_unmapped" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"database_name" text NOT NULL,
	"notion_id" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_notion_unmapped_database" ON "notion_unmapped" USING btree ("database_name");--> statement-breakpoint
CREATE INDEX "idx_notion_unmapped_notion_id" ON "notion_unmapped" USING btree ("notion_id");