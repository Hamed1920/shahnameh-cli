// Database schema (plain Postgres, no vendor features). Drizzle reads this file to
// generate migrations: `npm run db:generate`, then `npm run db:migrate`.
import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

// ---- BetterAuth core tables (field names are what BetterAuth expects) ----

// A person who can sign in. `role` is owner | production | director | supervisor.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('supervisor'),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('user_role_check', sql`${t.role} in ('owner', 'production', 'director', 'supervisor')`),
]);

// One row per signed-in browser.
export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (t) => [index('session_user_id_idx').on(t.userId)]);

// A login method for a user (the email + password lives here).
export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('account_user_id_idx').on(t.userId)]);

// Short-lived tokens (email verification, password reset).
export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('verification_identifier_idx').on(t.identifier)]);

// ---- Our tables ----

// Which projects a user may open. Project slugs are folder names, not rows, so no fk.
export const projectMember = pgTable('project_member', {
  projectSlug: text('project_slug').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.projectSlug, t.userId] })]);

// An action someone asked for that the owner must approve before it runs.
// `capability` names the action, `payload` carries its inputs, `result` / `error` its outcome.
export const approvalRequest = pgTable('approval_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectSlug: text('project_slug').notNull(),
  capability: text('capability').notNull(),
  summary: text('summary').notNull(),
  payload: jsonb('payload'),
  requestedBy: text('requested_by').notNull().references(() => user.id),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy: text('decided_by').references(() => user.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  result: jsonb('result'),
  error: text('error'),
}, (t) => [
  check('approval_request_status_check', sql`${t.status} in ('pending', 'approved', 'rejected', 'executed', 'failed')`),
  index('approval_request_status_created_idx').on(t.status, t.createdAt),
]);

// ---- Production panel (Persimmon Dreams): sequences, blocks, generations, review ----

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const personFk = (name: string) => text(name).references(() => user.id);

// A sequence of blocks. `id` is an opaque key, `<project_slug>:<display id>` (lib/pd/keys.ts), so two
// projects with the same code cannot collide; `display_id` is the id people see (PD-S01);
// `internal_id` is the episode id in the project.
export const sequence = pgTable('sequence', {
  id: text('id').primaryKey(),
  displayId: text('display_id').notNull(),
  projectSlug: text('project_slug').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  displayOrder: integer('display_order').notNull(),
  internalId: text('internal_id'),
  createdBy: personFk('created_by'),
  createdAt: createdAt(),
  retiredAt: ts('retired_at'),
}, (t) => [
  uniqueIndex('sequence_project_number_unique').on(t.projectSlug, t.number),
  uniqueIndex('sequence_project_display_unique').on(t.projectSlug, t.displayId),
]);

// A block (one shot). `id` is an opaque key (`<project_slug>:<display id>`); `display_id` is
// PD-S01-B003; `internal_id` the scene/shot id, unique within its project.
export const block = pgTable('block', {
  id: text('id').primaryKey(),
  displayId: text('display_id').notNull(),
  projectSlug: text('project_slug').notNull(),
  sequenceId: text('sequence_id').notNull().references(() => sequence.id),
  number: integer('number').notNull(),
  internalId: text('internal_id'),
  title: text('title').notNull(),
  displayOrder: integer('display_order').notNull(),
  targetDurationSeconds: integer('target_duration_seconds'),
  createdBy: personFk('created_by'),
  createdAt: createdAt(),
  retiredAt: ts('retired_at'),
}, (t) => [
  uniqueIndex('block_sequence_number_unique').on(t.sequenceId, t.number),
  uniqueIndex('block_project_display_unique').on(t.projectSlug, t.displayId),
  uniqueIndex('block_project_internal_unique').on(t.projectSlug, t.internalId),
]);

// Every saved wording of a block's prompt. The hash is of the normalized text.
export const promptVersion = pgTable('prompt_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  blockId: text('block_id').notNull().references(() => block.id),
  versionNumber: integer('version_number').notNull(),
  promptText: text('prompt_text').notNull(),
  promptHash: text('prompt_hash').notNull(),
  refs: jsonb('refs').notNull().default(sql`'[]'::jsonb`),
  createdBy: personFk('created_by'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('prompt_version_block_number_unique').on(t.blockId, t.versionNumber),
  index('prompt_version_block_hash_idx').on(t.blockId, t.promptHash),
]);

// An asset (and optionally one look of it) used by a block.
export const blockAssetLink = pgTable('block_asset_link', {
  id: uuid('id').primaryKey().defaultRandom(),
  blockId: text('block_id').notNull().references(() => block.id),
  entityId: text('entity_id').notNull(),
  variant: text('variant'),
  role: text('role'),
  createdBy: personFk('created_by'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('block_asset_link_unique').on(t.blockId, t.entityId, sql`coalesce(${t.variant}, '')`),
]);

// One take of a block, synced from the worker's records. `g_number` is frozen once given.
export const generation = pgTable('generation', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectSlug: text('project_slug').notNull(),
  blockId: text('block_id').notNull().references(() => block.id),
  gNumber: integer('g_number').notNull(),
  hfJobId: text('hf_job_id'),
  jobId: text('job_id'),
  candidate: text('candidate'),
  parentJobId: text('parent_job_id'),
  stage: text('stage'),
  model: text('model'),
  resolution: text('resolution'),
  durationSeconds: numeric('duration_seconds'),
  costCredits: numeric('cost_credits'),
  operationType: text('operation_type').notNull(),
  promptVersionId: uuid('prompt_version_id').references(() => promptVersion.id),
  createdBy: text('created_by'),
  createdAt: ts('created_at').notNull(),
  syncedAt: ts('synced_at').notNull().defaultNow(),
}, (t) => [
  check('generation_operation_type_check', sql`${t.operationType} in ('generate', 'edit', 'revision', 'final_of_draft')`),
  uniqueIndex('generation_block_g_unique').on(t.blockId, t.gNumber),
  uniqueIndex('generation_block_job_candidate_unique').on(t.blockId, t.hfJobId, t.candidate),
]);

// A generation put forward for the director. At most one active submission per block.
export const reviewSubmission = pgTable('review_submission', {
  id: uuid('id').primaryKey().defaultRandom(),
  blockId: text('block_id').notNull().references(() => block.id),
  generationId: uuid('generation_id').notNull().references(() => generation.id),
  roundNumber: integer('round_number').notNull(),
  submittedBy: text('submitted_by').notNull().references(() => user.id),
  submittedAt: ts('submitted_at').notNull().defaultNow(),
  status: text('status').notNull().default('pending'),
  isActive: boolean('is_active').notNull().default(true),
  decidedBy: personFk('decided_by'),
  decidedAt: ts('decided_at'),
  fileSha256: text('file_sha256'),
}, (t) => [
  check('review_submission_status_check', sql`${t.status} in ('pending', 'approved', 'revision_requested')`),
  uniqueIndex('review_submission_block_round_unique').on(t.blockId, t.roundNumber),
  uniqueIndex('review_submission_active_unique').on(t.blockId).where(sql`${t.isActive}`),
]);

// A note on a submission, from the director or on continuity.
export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => reviewSubmission.id),
  authorId: text('author_id').notNull().references(() => user.id),
  authorRole: text('author_role').notNull(),
  category: text('category').notNull(),
  body: text('body').notNull(),
  timecodeSeconds: numeric('timecode_seconds'),
  resolutionStatus: text('resolution_status').notNull().default('open'),
  resolvedBy: personFk('resolved_by'),
  resolvedAt: ts('resolved_at'),
  createdAt: createdAt(),
}, (t) => [
  check('feedback_category_check', sql`${t.category} in ('director', 'continuity')`),
  check('feedback_resolution_check', sql`${t.resolutionStatus} in ('open', 'in_progress', 'resolved')`),
  index('feedback_submission_idx').on(t.submissionId),
]);

// Who has read which feedback.
export const feedbackRead = pgTable('feedback_read', {
  feedbackId: uuid('feedback_id').notNull().references(() => feedback.id),
  userId: text('user_id').notNull().references(() => user.id),
  readAt: ts('read_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.feedbackId, t.userId] })]);

// An asset look shown to the director. Approval appends an INDEX_OPS request (`index_op_id`).
export const assetReview = pgTable('asset_review', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectSlug: text('project_slug').notNull(),
  entityId: text('entity_id').notNull(),
  variant: text('variant'),
  presentedBy: text('presented_by').notNull().references(() => user.id),
  presentedAt: ts('presented_at').notNull().defaultNow(),
  status: text('status').notNull().default('presented'),
  directorNotes: text('director_notes'),
  decidedBy: personFk('decided_by'),
  decidedAt: ts('decided_at'),
  indexOpId: text('index_op_id'),
}, (t) => [
  check('asset_review_status_check', sql`${t.status} in ('presented', 'selected', 'revision_requested', 'approved')`),
  index('asset_review_entity_idx').on(t.projectSlug, t.entityId),
]);

// The one current Final of a block. Earlier Finals live on in audit_log.
export const blockFinal = pgTable('block_final', {
  blockId: text('block_id').primaryKey().references(() => block.id),
  generationId: uuid('generation_id').notNull().references(() => generation.id),
  submissionId: uuid('submission_id').notNull().references(() => reviewSubmission.id),
  finalizedBy: text('finalized_by').notNull().references(() => user.id),
  finalizedAt: ts('finalized_at').notNull().defaultNow(),
});

// Append-only record of who did what.
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectSlug: text('project_slug'),
  actorId: text('actor_id'),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  detail: jsonb('detail'),
  createdAt: createdAt(),
}, (t) => [index('audit_log_project_created_idx').on(t.projectSlug, t.createdAt)]);
