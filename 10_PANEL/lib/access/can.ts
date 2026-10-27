import { CAPABILITIES } from './capabilities.ts'
import type { Mode, Role } from './capabilities.ts'

export function isRole(x: unknown): x is Role {
  return x === 'owner' || x === 'production' || x === 'director' || x === 'supervisor'
}

/** What this role may do with this capability. An unknown role or capability is 'deny'. */
export function can(role: string, cap: string): Mode {
  if (!isRole(role)) return 'deny'
  if (!Object.prototype.hasOwnProperty.call(CAPABILITIES, cap)) return 'deny'
  return CAPABILITIES[cap as keyof typeof CAPABILITIES][role]
}

/** The owner sees every project; anyone else only the ones they are a member of. */
export function visibleProjects<T extends { slug: string }>(
  actor: { role: Role },
  memberSlugs: readonly string[],
  all: T[],
): T[] {
  if (actor.role === 'owner') return all
  return all.filter((p) => memberSlugs.includes(p.slug))
}
