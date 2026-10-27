import type { Actor } from './actor-core'
import type { Capability } from './access/capabilities'

/** What an action returns when it was sent to Hamed instead of done. */
export const PENDING_MESSAGE = 'Sent to Hamed for approval'
export type Proposed = { ok: true; pending: true; message: string }

/**
 * An agent's request to do something that spends or destroys: it waits in the approvals inbox
 * and nothing is appended to the project's files. Only reached with login on (a local actor is
 * the owner and never proposes), so the database is loaded here and nowhere on the off path.
 */
export async function proposeApproval(
  project: string, cap: Capability, summary: string, payload: unknown, actor: Actor,
): Promise<Proposed> {
  const { createApproval } = await import('./approvals')
  await createApproval(project, cap, summary, payload, actor)
  return { ok: true, pending: true, message: PENDING_MESSAGE }
}
