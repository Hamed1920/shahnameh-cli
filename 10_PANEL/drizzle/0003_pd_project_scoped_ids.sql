-- Sequence and block keys become "<project_slug>:<display id>" so two projects with the same code
-- cannot collide. Existing rows (test data only, none in production yet) cannot be rewritten in
-- place, so the Persimmon Dreams structure tables are emptied first, children before parents.
-- Users, accounts, memberships, approvals, asset reviews and the audit log are untouched.
DELETE FROM "feedback_read";--> statement-breakpoint
DELETE FROM "feedback";--> statement-breakpoint
DELETE FROM "block_final";--> statement-breakpoint
DELETE FROM "review_submission";--> statement-breakpoint
DELETE FROM "generation";--> statement-breakpoint
DELETE FROM "block_asset_link";--> statement-breakpoint
DELETE FROM "prompt_version";--> statement-breakpoint
DELETE FROM "block";--> statement-breakpoint
DELETE FROM "sequence";--> statement-breakpoint
ALTER TABLE "block" DROP CONSTRAINT "block_internal_id_unique";--> statement-breakpoint
ALTER TABLE "block" ADD COLUMN "display_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "display_id" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "block_project_display_unique" ON "block" USING btree ("project_slug","display_id");--> statement-breakpoint
CREATE UNIQUE INDEX "block_project_internal_unique" ON "block" USING btree ("project_slug","internal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_project_display_unique" ON "sequence" USING btree ("project_slug","display_id");