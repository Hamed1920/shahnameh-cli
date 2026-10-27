// Database schema (plain Postgres, no vendor features). Drizzle reads this file to
// generate migrations: `npm run db:generate`, then `npm run db:migrate`.
import { sql } from 'drizzle-orm';
import {
  boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

// ---- BetterAuth core tables (field names are what BetterAuth expects) ----

// A person who can sign in. `role` is owner | agent | client.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('client'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('user_role_check', sql`${t.role} in ('owner', 'agent', 'client')`),
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

// Something the owner has released to clients: a take, a shot or an episode.
// `ref` is the id (or asset reference) as the project knows it. Revoking sets revoked_at;
// rows are never deleted. Only one live release per (project, kind, ref).
export const release = pgTable('release', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectSlug: text('project_slug').notNull(),
  kind: text('kind').notNull(),
  ref: text('ref').notNull(),
  label: text('label'),
  releasedBy: text('released_by').notNull().references(() => user.id),
  releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  check('release_kind_check', sql`${t.kind} in ('take', 'shot', 'episode')`),
  uniqueIndex('release_live_unique').on(t.projectSlug, t.kind, t.ref).where(sql`${t.revokedAt} is null`),
]);

// A client's note on a released item, optionally with a verdict.
export const clientComment = pgTable('client_comment', {
  id: uuid('id').primaryKey().defaultRandom(),
  releaseId: uuid('release_id').notNull().references(() => release.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id),
  body: text('body').notNull(),
  verdict: text('verdict'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('client_comment_verdict_check', sql`${t.verdict} is null or ${t.verdict} in ('approve', 'reject')`),
  index('client_comment_release_idx').on(t.releaseId),
]);

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
