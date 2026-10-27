import type { Role } from './access/capabilities.ts'

/** Who is doing something. With login off this is always the local owner. */
export type Actor = { id: string; name: string; role: Role }

type Env = Record<string, string | undefined>

/** Login is on only when SHM_AUTH is exactly 'on'. Anything else is today's behaviour. */
export function authEnabled(env: Env = process.env): boolean {
  return env.SHM_AUTH === 'on'
}

/** The person at this machine when there is no login. */
export function localActor(env: Env = process.env): Actor {
  return { id: 'local', name: env.SHM_REVIEWER || 'hamed', role: 'owner' }
}

/**
 * The who-did-it fields for a record. With login off only `reviewer`, so the
 * lines written are the same as before login existed; with it on, the actor's id
 * and role too.
 */
export function stamp(actor: Actor, on: boolean): { reviewer: string; actorId?: string; actorRole?: Role } {
  if (!on) return { reviewer: actor.name }
  return { reviewer: actor.name, actorId: actor.id, actorRole: actor.role }
}

/** Thrown when an actor's role does not allow a capability. */
export class Forbidden extends Error {
  capability: string
  constructor(capability: string, message?: string) {
    super(message ?? `Not allowed: ${capability}`)
    this.name = 'Forbidden'
    this.capability = capability
  }
}
