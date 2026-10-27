'use server'

import { revalidatePath } from 'next/cache'
import { authEnabled } from '@/lib/actor-core'
import { gate } from '@/lib/actor'

/**
 * The owner's account management. Each action checks users.manage itself (Server Actions are
 * public POST endpoints); the work and its audit rows are in lib/pd-users.ts.
 */
type Result = { ok: true; password?: string } | { ok: false; error: string }

async function owner() {
  if (!authEnabled()) return { ok: false as const, error: 'Accounts need login to be on.' }
  return gate(null, 'users.manage')
}

const done = (r: { ok: boolean; error?: string; password?: string }): Result =>
  r.ok ? { ok: true, password: r.password } : { ok: false, error: r.error ?? 'Could not do that.' }

export async function createAccount(input: { email: string; name: string; role: string; projects: string[] }): Promise<Result> {
  const g = await owner()
  if (!g.ok) return g
  const { createUser } = await import('@/lib/pd-users')
  const r = await createUser(input, g.actor)
  revalidatePath('/admin/users')
  return done(r)
}

export async function changeRole(userId: string, role: string): Promise<Result> {
  const g = await owner()
  if (!g.ok) return g
  const { setRole } = await import('@/lib/pd-users')
  const r = await setRole(userId, role, g.actor)
  revalidatePath('/admin/users')
  return done(r)
}

export async function changeDisabled(userId: string, disabled: boolean): Promise<Result> {
  const g = await owner()
  if (!g.ok) return g
  const { setDisabled } = await import('@/lib/pd-users')
  const r = await setDisabled(userId, disabled, g.actor)
  revalidatePath('/admin/users')
  return done(r)
}

export async function changeProjects(userId: string, projects: string[]): Promise<Result> {
  const g = await owner()
  if (!g.ok) return g
  const { setMemberships } = await import('@/lib/pd-users')
  const r = await setMemberships(userId, projects, g.actor)
  revalidatePath('/admin/users')
  return done(r)
}

export async function resetAccountPassword(userId: string): Promise<Result> {
  const g = await owner()
  if (!g.ok) return g
  const { resetPassword } = await import('@/lib/pd-users')
  const r = await resetPassword(userId, g.actor)
  revalidatePath('/admin/users')
  return done(r)
}
