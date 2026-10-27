// Accounts: list, create, change role, disable, project membership, reset password.
// Server only, database. Every change by a person is audited (lib/audit.ts). The shared part
// (upsertUser) is also what scripts/add-user.ts runs, so the CLI and the panel make accounts alike.
import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Actor } from './actor-core.ts'
import { audit } from './audit.ts'
import { getDb } from './db/client.ts'
import { account, projectMember, session, user } from './db/schema.ts'
import { ROLES, checkDisable, checkRoleChange, checkSlugs, diffSlugs } from './pd-users-rules.ts'

export type UserRow = {
  id: string
  name: string
  email: string
  role: string
  disabled: boolean
  createdAt: Date
  projects: string[]
}

export type Done<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const newPassword = () => randomBytes(12).toString('base64url')

/** The shared part of add-user: create the account, or update an existing one. No audit, no slug check. */
export async function upsertUser(input: {
  email: string
  name: string
  role: string
  projects?: string[]
  password?: string
}): Promise<{ userId: string; created: boolean; generatedPassword: string | null }> {
  const db = getDb()
  const email = input.email.trim().toLowerCase()
  const [existing] = await db.select().from(user).where(eq(user.email, email))
  let userId: string
  let generatedPassword: string | null = null
  if (existing) {
    userId = existing.id
    await db.update(user).set({ name: input.name, role: input.role, updatedAt: new Date() }).where(eq(user.id, userId))
    if (input.password !== undefined) {
      const hash = await hashPassword(input.password)
      const [cred] = await db.select().from(account).where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
      if (cred) await db.update(account).set({ password: hash, updatedAt: new Date() }).where(eq(account.id, cred.id))
      else await db.insert(account).values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password: hash })
    }
  } else {
    userId = randomUUID()
    const password = input.password ?? newPassword()
    if (input.password === undefined) generatedPassword = password
    await db.insert(user).values({ id: userId, name: input.name, email, emailVerified: true, role: input.role })
    await db.insert(account).values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password: await hashPassword(password) })
  }
  for (const slug of input.projects ?? []) {
    await db.insert(projectMember).values({ projectSlug: slug, userId }).onConflictDoNothing()
  }
  return { userId, created: !existing, generatedPassword }
}

async function knownSlugs(): Promise<string[]> {
  const { listProjects } = await import('./projects.ts')
  return (await listProjects()).map((p) => p.slug)
}

export async function listUsers(): Promise<UserRow[]> {
  const db = getDb()
  const [users, members] = await Promise.all([db.select().from(user), db.select().from(projectMember)])
  return users
    .map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role, disabled: u.disabled, createdAt: u.createdAt,
      projects: members.filter((m) => m.userId === u.id).map((m) => m.projectSlug).sort(),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

const ruleUsers = (rows: UserRow[]) => rows.map((u) => ({ id: u.id, role: u.role, disabled: u.disabled }))

/** A new account. A password is generated unless one is given; it is returned once and never stored in clear. */
export async function createUser(
  input: { email: string; name: string; role: string; projects: string[]; password?: string },
  actor: Actor,
): Promise<Done<{ userId: string; password: string }>> {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'That is not an email address.' }
  if (!name) return { ok: false, error: 'Give the account a name.' }
  if (!(ROLES as readonly string[]).includes(input.role)) return { ok: false, error: `Unknown role "${input.role}".` }
  if (input.password !== undefined && input.password.length < 8) return { ok: false, error: 'A password needs at least 8 characters.' }
  const slugs = checkSlugs(input.projects, await knownSlugs())
  if (!slugs.ok) return slugs
  const [dupe] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email))
  if (dupe) return { ok: false, error: 'An account with that email already exists.' }

  const r = await upsertUser({ email, name, role: input.role, projects: slugs.slugs, password: input.password })
  await audit({ actor, project: null, action: 'user.create', objectType: 'user', objectId: r.userId, detail: { email, name, role: input.role, projects: slugs.slugs } })
  return { ok: true, userId: r.userId, password: r.generatedPassword ?? input.password ?? '' }
}

export async function setRole(userId: string, role: string, actor: Actor): Promise<Done> {
  const rows = await listUsers()
  const check = checkRoleChange(ruleUsers(rows), userId, role)
  if (!check.ok) return check
  const target = rows.find((u) => u.id === userId)!
  if (target.role === role) return { ok: true }
  await getDb().transaction(async (tx) => {
    await tx.update(user).set({ role, updatedAt: new Date() }).where(eq(user.id, userId))
    await audit({ actor, project: null, action: 'user.role', objectType: 'user', objectId: userId, detail: { email: target.email, before: { role: target.role }, after: { role } } }, tx)
  })
  return { ok: true }
}

/** Disabling also deletes the person's sessions, so a cookie they hold stops working at once. */
export async function setDisabled(userId: string, disabled: boolean, actor: Actor): Promise<Done> {
  const rows = await listUsers()
  const check = checkDisable(ruleUsers(rows), userId, actor.id, disabled)
  if (!check.ok) return check
  const target = rows.find((u) => u.id === userId)!
  if (target.disabled === disabled) return { ok: true }
  await getDb().transaction(async (tx) => {
    await tx.update(user).set({ disabled, updatedAt: new Date() }).where(eq(user.id, userId))
    if (disabled) await tx.delete(session).where(eq(session.userId, userId))
    await audit({ actor, project: null, action: disabled ? 'user.disable' : 'user.enable', objectType: 'user', objectId: userId, detail: { email: target.email, before: { disabled: target.disabled }, after: { disabled } } }, tx)
  })
  return { ok: true }
}

/** Replace the person's projects. One audit row per project gained or lost, filed under that project. */
export async function setMemberships(userId: string, projects: string[], actor: Actor): Promise<Done> {
  const slugs = checkSlugs(projects, await knownSlugs())
  if (!slugs.ok) return slugs
  const rows = await listUsers()
  const target = rows.find((u) => u.id === userId)
  if (!target) return { ok: false, error: 'No such account.' }
  const { added, removed } = diffSlugs(target.projects, slugs.slugs)
  if (!added.length && !removed.length) return { ok: true }
  await getDb().transaction(async (tx) => {
    for (const slug of added) {
      await tx.insert(projectMember).values({ projectSlug: slug, userId }).onConflictDoNothing()
      await audit({ actor, project: slug, action: 'user.member.add', objectType: 'user', objectId: userId, detail: { email: target.email, before: { member: false }, after: { member: true } } }, tx)
    }
    if (removed.length) {
      await tx.delete(projectMember).where(and(eq(projectMember.userId, userId), inArray(projectMember.projectSlug, removed)))
      for (const slug of removed) {
        await audit({ actor, project: slug, action: 'user.member.remove', objectType: 'user', objectId: userId, detail: { email: target.email, before: { member: true }, after: { member: false } } }, tx)
      }
    }
  })
  return { ok: true }
}

/** A new random password, returned once. The person's sessions end, so the old one cannot linger. */
export async function resetPassword(userId: string, actor: Actor): Promise<Done<{ password: string }>> {
  const db = getDb()
  const [target] = await db.select().from(user).where(eq(user.id, userId))
  if (!target) return { ok: false, error: 'No such account.' }
  const password = newPassword()
  const hash = await hashPassword(password)
  await db.transaction(async (tx) => {
    const [cred] = await tx.select().from(account).where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    if (cred) await tx.update(account).set({ password: hash, updatedAt: new Date() }).where(eq(account.id, cred.id))
    else await tx.insert(account).values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password: hash })
    await tx.delete(session).where(eq(session.userId, userId))
    await audit({ actor, project: null, action: 'user.password.reset', objectType: 'user', objectId: userId, detail: { email: target.email } }, tx)
  })
  return { ok: true, password }
}
