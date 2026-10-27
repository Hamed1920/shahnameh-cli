/**
 * Who may do what. One table, three roles, three answers.
 *
 *   allow    do it now
 *   propose  ask Hamed: the request waits in his approvals inbox and nothing is
 *            spent or changed until he says yes
 *   deny     not for this role
 *
 * Pure data: no imports, so tests and server code can both read it. The panel
 * checks it through can() in ./can.ts. Learnings stay Hamed's call: an agent can
 * only propose one.
 */

export type Role = 'owner' | 'agent' | 'client'
export type Mode = 'allow' | 'propose' | 'deny'

type Row = { owner: Mode; agent: Mode; client: Mode }

const row = (owner: Mode, agent: Mode, client: Mode): Row => ({ owner, agent, client })

// A staff capability: the owner can, an agent can or must ask, a client never.
const staff = (agent: Mode): Row => row('allow', agent, 'deny')

export const CAPABILITIES = {
  /** Review decisions that cost nothing (notes, discard, like). */
  'review.decide': staff('allow'),
  /** Accept a draft to final, or deny and requeue: both spend credits. */
  'review.decide.spend': staff('propose'),
  /** Submit a Prompts-page batch for pricing, generate from a prompt, read documents, refresh models. */
  'batch.submit': staff('allow'),
  /** Approve a priced batch: this is what queues the jobs. */
  'batch.approve': staff('propose'),
  /** Throw away a batch that was priced but not approved. */
  'batch.discard': staff('allow'),
  /** Price a reference-studio try. */
  'studio.price': staff('allow'),
  /** Generate in the studio, or pick a result to file. */
  'studio.spend': staff('propose'),
  /** Close a studio session. */
  'studio.close': staff('allow'),
  /** Ask for a regeneration of a take. */
  'regen.spend': staff('propose'),
  /** Retry a failed job. */
  'job.retry': staff('propose'),
  /** Dismiss a failed job from the Queue page. */
  'job.dismiss': staff('allow'),
  /** Approve or reject a learning (a rule that reaches prompts). */
  'learning.decide': staff('propose'),
  /** Gallery likes, tags and order. */
  'gallery.curate': staff('allow'),
  /** References page: add, restore, change status, canonical look, role, unarchive. */
  'index.write': staff('allow'),
  /** References page: retire, archive, rename, move. */
  'index.destructive': staff('propose'),
  /** Episodes: start, file, add footage, assign shots. */
  'episode.write': staff('allow'),
  /** Episodes: rename, archive, restore, remove. */
  'episode.destructive': staff('propose'),
  /** Start a new project. */
  'project.create': staff('propose'),
  /** Stop or start the workers. */
  'workers.control': staff('deny'),
  /** "Show in folder": opens the machine's file explorer. */
  'reveal.local': staff('deny'),
  /** Approve or reject what an agent proposed (the inbox). */
  'approval.decide': staff('deny'),
  /** Release a take, shot or episode to clients, or take it back. */
  'release.manage': staff('allow'),
  /** Prompts pages and the prompts inside records. */
  'view.prompts': staff('allow'),
  /** Credits, prices and the spend ledger. */
  'view.costs': staff('allow'),
  /** Draft renders. */
  'view.drafts': staff('allow'),
  /** Rejected takes. */
  'view.rejects': staff('allow'),
  /** Items released to clients, and progress counts. */
  'view.released': row('allow', 'allow', 'allow'),
  /** Comment and approve or reject on a released item. Clients only. */
  'comment.client': row('deny', 'deny', 'allow'),
} as const satisfies Record<string, Row>

export type Capability = keyof typeof CAPABILITIES

/** Everything that spends credits. An agent is never 'allow' on any of these. */
export const SPENDING: ReadonlySet<Capability> = new Set<Capability>([
  'review.decide.spend',
  'batch.approve',
  'studio.spend',
  'regen.spend',
  'job.retry',
])

/**
 * Which capability a References-page or episode index op needs, by op type
 * (IndexOpType in lib/types, OPS in worker/lib/index-ops.mjs).
 * Destructive: retire, archive, rename, move. 'status' only sets Concept,
 * Approved or Locked (the worker refuses RETIRED), so it is a plain write.
 * Episode ops split the same way. Anything unknown fails closed.
 */
export function indexOpCapability(type: string): Capability {
  switch (type) {
    case 'add':
    case 'restore':
    case 'status':
    case 'canonical':
    case 'role':
    case 'unarchive':
      return 'index.write'
    case 'retire':
    case 'archive':
    case 'rename':
    case 'move':
      return 'index.destructive'
    case 'new-episode':
    case 'add-shot':
    case 'restore-shot':
      return 'episode.write'
    case 'rename-episode':
    case 'archive-shot':
    case 'remove-episode':
    case 'move-shot':
      return 'episode.destructive'
    default:
      return 'index.destructive'
  }
}
