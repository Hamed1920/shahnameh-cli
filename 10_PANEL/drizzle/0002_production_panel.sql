CREATE TABLE "asset_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_slug" text NOT NULL,
	"entity_id" text NOT NULL,
	"variant" text,
	"presented_by" text NOT NULL,
	"presented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'presented' NOT NULL,
	"director_notes" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"index_op_id" text,
	CONSTRAINT "asset_review_status_check" CHECK ("asset_review"."status" in ('presented', 'selected', 'revision_requested', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_slug" text,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "block" (
	"id" text PRIMARY KEY NOT NULL,
	"project_slug" text NOT NULL,
	"sequence_id" text NOT NULL,
	"number" integer NOT NULL,
	"internal_id" text,
	"title" text NOT NULL,
	"display_order" integer NOT NULL,
	"target_duration_seconds" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "block_internal_id_unique" UNIQUE("internal_id")
);
--> statement-breakpoint
CREATE TABLE "block_asset_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"variant" text,
	"role" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "block_final" (
	"block_id" text PRIMARY KEY NOT NULL,
	"generation_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"finalized_by" text NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"author_role" text NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"timecode_seconds" numeric,
	"resolution_status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_category_check" CHECK ("feedback"."category" in ('director', 'continuity')),
	CONSTRAINT "feedback_resolution_check" CHECK ("feedback"."resolution_status" in ('open', 'in_progress', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "feedback_read" (
	"feedback_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_read_feedback_id_user_id_pk" PRIMARY KEY("feedback_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "generation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_slug" text NOT NULL,
	"block_id" text NOT NULL,
	"g_number" integer NOT NULL,
	"hf_job_id" text,
	"job_id" text,
	"candidate" text,
	"parent_job_id" text,
	"stage" text,
	"model" text,
	"resolution" text,
	"duration_seconds" numeric,
	"cost_credits" numeric,
	"operation_type" text NOT NULL,
	"prompt_version_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_operation_type_check" CHECK ("generation"."operation_type" in ('generate', 'edit', 'revision', 'final_of_draft'))
);
--> statement-breakpoint
CREATE TABLE "prompt_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"prompt_text" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" text NOT NULL,
	"generation_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"file_sha256" text,
	CONSTRAINT "review_submission_status_check" CHECK ("review_submission"."status" in ('pending', 'approved', 'revision_requested'))
);
--> statement-breakpoint
CREATE TABLE "sequence" (
	"id" text PRIMARY KEY NOT NULL,
	"project_slug" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"internal_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "asset_review" ADD CONSTRAINT "asset_review_presented_by_user_id_fk" FOREIGN KEY ("presented_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_review" ADD CONSTRAINT "asset_review_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_asset_link" ADD CONSTRAINT "block_asset_link_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_asset_link" ADD CONSTRAINT "block_asset_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_final" ADD CONSTRAINT "block_final_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_final" ADD CONSTRAINT "block_final_generation_id_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_final" ADD CONSTRAINT "block_final_submission_id_review_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."review_submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_final" ADD CONSTRAINT "block_final_finalized_by_user_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_submission_id_review_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."review_submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_read" ADD CONSTRAINT "feedback_read_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_read" ADD CONSTRAINT "feedback_read_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_prompt_version_id_prompt_version_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_submission" ADD CONSTRAINT "review_submission_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_submission" ADD CONSTRAINT "review_submission_generation_id_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_submission" ADD CONSTRAINT "review_submission_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_submission" ADD CONSTRAINT "review_submission_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_review_entity_idx" ON "asset_review" USING btree ("project_slug","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_project_created_idx" ON "audit_log" USING btree ("project_slug","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "block_sequence_number_unique" ON "block" USING btree ("sequence_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "block_asset_link_unique" ON "block_asset_link" USING btree ("block_id","entity_id",coalesce("variant", ''));--> statement-breakpoint
CREATE INDEX "feedback_submission_idx" ON "feedback" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_block_g_unique" ON "generation" USING btree ("block_id","g_number");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_block_job_candidate_unique" ON "generation" USING btree ("block_id","hf_job_id","candidate");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_version_block_number_unique" ON "prompt_version" USING btree ("block_id","version_number");--> statement-breakpoint
CREATE INDEX "prompt_version_block_hash_idx" ON "prompt_version" USING btree ("block_id","prompt_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "review_submission_block_round_unique" ON "review_submission" USING btree ("block_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "review_submission_active_unique" ON "review_submission" USING btree ("block_id") WHERE "review_submission"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_project_number_unique" ON "sequence" USING btree ("project_slug","number");