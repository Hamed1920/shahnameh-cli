ALTER TABLE "client_comment" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "release" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "client_comment" CASCADE;--> statement-breakpoint
DROP TABLE "release" CASCADE;--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_role_check";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'supervisor';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "user" SET "role" = 'production' WHERE "role" = 'agent';--> statement-breakpoint
UPDATE "user" SET "role" = 'director' WHERE "role" = 'client';--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("user"."role" in ('owner', 'production', 'director', 'supervisor'));