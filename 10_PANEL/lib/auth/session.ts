// Who is signed in. lib/actor.ts imports this module only when SHM_AUTH=on.
import { cache } from 'react'
import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import type { Actor } from '../actor-core.ts'
import { isRole } from '../access/can.ts'
import { getDb } from '../db/client.ts'
import { projectMember, user } from '../db/schema.ts'
import { getAuth } from './server.ts'

/** The signed-in person for this request, or null when nobody is signed in. */
export const sessionActor = cache(async (): Promise<Actor | null> => {
  const s = await getAuth().api.getSession({ headers: await headers() })
  if (!s) return null
  // A disabled account is signed out everywhere, even if a cookie survives (lib/pd-users.ts also deletes its sessions).
  const [row] = await getDb().select({ disabled: user.disabled }).from(user).where(eq(user.id, s.user.id))
  if (!row || row.disabled) return null
  const role = (s.user as { role?: unknown }).role
  // An unknown role falls to the least privilege.
  return { id: s.user.id, name: s.user.name, role: isRole(role) ? role : 'supervisor' }
})

/** The project slugs this user is a member of. */
export async function memberProjects(userId: string): Promise<string[]> {
  const rows = await getDb().select({ slug: projectMember.projectSlug }).from(projectMember).where(eq(projectMember.userId, userId))
  return rows.map((r) => r.slug)
}
