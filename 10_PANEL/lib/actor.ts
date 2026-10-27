import { authEnabled, Forbidden, localActor, stamp, type Actor } from './actor-core.ts'
import { can } from './access/can.ts'
import type { Capability } from './access/capabilities.ts'

/**
 * Who is acting, and whether they may. Server-only.
 *
 * With login off (SHM_AUTH unset) every call here is synchronous work in disguise:
 * the local owner, no session, no database, and lib/auth/session is never imported.
 * Server Actions are public POST endpoints, so each one calls gate() / requireCan()
 * itself; the proxy is only a fast redirect (Next authentication guide, Server Actions).
 */

export async function getActor(): Promise<Actor> {
  if (!authEnabled()) return localActor()
  const { sessionActor } = await import('./auth/session')
  const actor = await sessionActor()
  if (!actor) throw new Forbidden('login', 'Sign in first.')
  return actor
}

/**
 * The actor, once they may do `cap` here. `project` is the slug, or null for something
 * that belongs to no project (starting a new one). Throws Forbidden when denied or not a
 * member; `mode` is 'propose' when the actor must ask Hamed instead of doing it.
 */
export async function requireCan(
  project: string | null,
  cap: Capability,
): Promise<{ actor: Actor; mode: 'allow' | 'propose' }> {
  const actor = await getActor()
  if (authEnabled() && actor.role !== 'owner' && project !== null) {
    const { memberProjects } = await import('./auth/session')
    if (!(await memberProjects(actor.id)).includes(project)) throw new Forbidden(cap, 'You are not on this project.')
  }
  const mode = can(actor.role, cap)
  if (mode === 'deny') throw new Forbidden(cap)
  return { actor, mode }
}

/** The who-did-it fields for a record: `reviewer` always, actorId and actorRole only with login on. */
export function whoStamp(actor: Actor) {
  return stamp(actor, authEnabled())
}

/** What someone is told when a capability needs Hamed. Phase 6 routes the four spending ones to an inbox. */
export function proposalRefused(_cap: Capability): string {
  return "This needs Hamed's approval. The approvals inbox is not built yet."
}

export type Gate = { ok: true; actor: Actor } | { ok: false; error: string }

/**
 * requireCan for Server Actions: never throws for a refusal. A denial or a proposal comes
 * back as `{ ok: false, error }` so the action can return it in its own failure shape.
 */
export async function gate(project: string | null, cap: Capability): Promise<Gate> {
  try {
    const { actor, mode } = await requireCan(project, cap)
    if (mode === 'propose') return { ok: false, error: proposalRefused(cap) }
    return { ok: true, actor }
  } catch (e) {
    if (e instanceof Forbidden) return { ok: false, error: e.message }
    throw e
  }
}

export type ModeGate = { ok: true; actor: Actor; mode: 'allow' | 'propose' } | { ok: false; error: string }

/**
 * gate() for the actions that can wait in the approvals inbox: a proposal is not refused here,
 * the caller sees `mode` and either does the work ('allow') or files a request ('propose').
 */
export async function gateMode(project: string | null, cap: Capability): Promise<ModeGate> {
  try {
    const { actor, mode } = await requireCan(project, cap)
    return { ok: true, actor, mode }
  } catch (e) {
    if (e instanceof Forbidden) return { ok: false, error: e.message }
    throw e
  }
}

/** A Response for a Forbidden: 401 when nobody is signed in, 403 otherwise. Null for any other error. */
export function forbiddenResponse(e: unknown): Response | null {
  if (!(e instanceof Forbidden)) return null
  return new Response(e.capability === 'login' ? 'sign in' : 'forbidden', { status: e.capability === 'login' ? 401 : 403 })
}

/** requireCan for route handlers: the actor, or the Response to return. Proposals are refused (a GET cannot propose). */
export async function gateRoute(
  project: string,
  cap: Capability,
): Promise<{ ok: true; actor: Actor } | { ok: false; response: Response }> {
  try {
    const { actor, mode } = await requireCan(project, cap)
    if (mode === 'propose') return { ok: false, response: new Response('forbidden', { status: 403 }) }
    return { ok: true, actor }
  } catch (e) {
    const r = forbiddenResponse(e)
    if (r) return { ok: false, response: r }
    throw e
  }
}
