ALTER TABLE "notes_management" DROP CONSTRAINT "notes_management_parent_id_notes_management_id_fk";
--> statement-breakpoint
ALTER TABLE "notes_management" ADD CONSTRAINT "notes_management_parent_id_notes_management_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."notes_management"("id") ON DELETE set null ON UPDATE no action;