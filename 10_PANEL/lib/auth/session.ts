/**
 * STUB. Phase 4 (BetterAuth wiring) replaces the bodies of both functions.
 * lib/actor.ts imports this module only when SHM_AUTH=on, so with login off it
 * is never loaded.
 */
import type { Actor } from '../actor-core.ts'

const NOT_WIRED = 'Login is switched on (SHM_AUTH=on) but not wired yet'

/** The signed-in person for this request, or null when nobody is signed in. */
export async function sessionActor(): Promise<Actor | null> {
  throw new Error(NOT_WIRED)
}

/** The project slugs this user is a member of. */
export async function memberProjects(_userId: string): Promise<string[]> {
  throw new Error(NOT_WIRED)
}
