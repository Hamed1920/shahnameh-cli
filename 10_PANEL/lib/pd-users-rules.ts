// The rules for who may change whom. Pure: no database, so they are tested on their own.

export const ROLES = ['owner', 'production', 'director', 'supervisor'] as const
export type UserRole = (typeof ROLES)[number]

export type RuleUser = { id: string; role: string; disabled: boolean }
export type RuleResult = { ok: true } | { ok: false; error: string }

const activeOwners = (users: RuleUser[]) => users.filter((u) => u.role === 'owner' && !u.disabled)

/** A role change is refused when it would leave no active owner. */
export function checkRoleChange(users: RuleUser[], targetId: string, newRole: string): RuleResult {
  if (!(ROLES as readonly string[]).includes(newRole)) return { ok: false, error: `Unknown role "${newRole}".` }
  const target = users.find((u) => u.id === targetId)
  if (!target) return { ok: false, error: 'No such account.' }
  if (target.role === 'owner' && newRole !== 'owner' && !target.disabled) {
    if (activeOwners(users).length <= 1) return { ok: false, error: 'This is the last active owner. Make someone else an owner first.' }
  }
  return { ok: true }
}

/** Disabling is refused for yourself and for the last active owner. Enabling is always fine. */
export function checkDisable(users: RuleUser[], targetId: string, actorId: string, disabled: boolean): RuleResult {
  const target = users.find((u) => u.id === targetId)
  if (!target) return { ok: false, error: 'No such account.' }
  if (!disabled) return { ok: true }
  if (targetId === actorId) return { ok: false, error: 'You cannot disable your own account.' }
  if (target.role === 'owner' && !target.disabled && activeOwners(users).length <= 1) {
    return { ok: false, error: 'This is the last active owner.' }
  }
  return { ok: true }
}

/** Slugs must all be known projects. Duplicates are folded; unknown ones are named. */
export function checkSlugs(slugs: string[], known: string[]): { ok: true; slugs: string[] } | { ok: false; error: string } {
  const set = new Set(known)
  const unique = [...new Set(slugs)]
  const bad = unique.filter((s) => !set.has(s))
  if (bad.length) return { ok: false, error: `Unknown project${bad.length > 1 ? 's' : ''}: ${bad.join(', ')}.` }
  return { ok: true, slugs: unique }
}

/** What changed between two slug lists. */
export function diffSlugs(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before)
  const a = new Set(after)
  return { added: after.filter((s) => !b.has(s)), removed: before.filter((s) => !a.has(s)) }
}
