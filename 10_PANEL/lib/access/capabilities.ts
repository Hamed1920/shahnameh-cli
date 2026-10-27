/**
 * Who may do what. One table, four roles, three answers.
 *
 *   allow    do it now
 *   propose  ask Hamed: the request waits in his approvals inbox and nothing is
 *            spent or changed until he says yes
 *   deny     not for this role
 *
 * The roles: the owner (Hamed, the project manager), production (the team that
 * makes the film), the director and the script supervisor (who only review what
 * was sent to them). No role proposes today; the approvals inbox stays for when
 * one does.
 *
 * Pure data: no imports, so tests and server code can both read it. The panel
 * checks it through can() in ./can.ts. Learnings stay Hamed's call.
 */

export type Role = 'owner' | 'production' | 'director' | 'supervisor'
export type Mode = 'allow' | 'propose' | 'deny'

type Row = { owner: Mode; production: Mode; director: Mode; supervisor: Mode }

const row = (owner: Mode, production: Mode, director: Mode, supervisor: Mode): Row => ({ owner, production, director, supervisor })

// An operational capability: the owner can, production as given, the reviewers never.
const staff = (production: Mode): Row => row('allow', production, 'deny', 'deny')

// The owner alone.
const ownerOnly = (): Row => row('allow', 'deny', 'deny', 'deny')

// The review area: the owner can; the director and the supervisor as given; production no.
const review = (director: Mode, supervisor: Mode): Row => row('allow', 'deny', director, supervisor)

export const CAPABILITIES = {
  /** Review decisions that cost nothing (notes, discard, like). */
  'review.decide': staff('allow'),
  /** Accept a draft to final, or deny and requeue: both spend credits. */
  'review.decide.spend': staff('allow'),
  /** Submit a Prompts-page batch for pricing, generate from a prompt, read documents, refresh models. */
  'batch.submit': staff('allow'),
  /** Approve a priced batch: this is what queues the jobs. */
  'batch.approve': staff('allow'),
  /** Throw away a batch that was priced but not approved. */
  'batch.discard': staff('allow'),
  /** Price a reference-studio try. */
  'studio.price': staff('allow'),
  /** Generate in the studio, or pick a result to file. */
  'studio.spend': staff('allow'),
  /** Close a studio session. */
  'studio.close': staff('allow'),
  /** Ask for a regeneration of a take. */
  'regen.spend': staff('allow'),
  /** Retry a failed job. */
  'job.retry': staff('allow'),
  /** Dismiss a failed job from the Queue page. */
  'job.dismiss': staff('allow'),
  /** Approve or reject a learning (a rule that reaches prompts). Only Hamed decides. */
  'learning.decide': ownerOnly(),
  /** Gallery likes, tags and order. */
  'gallery.curate': staff('allow'),
  /** References page: add, restore, change status, canonical look, role, unarchive. */
  'index.write': staff('allow'),
  /** References page: retire, archive, rename, move. */
  'index.destructive': staff('allow'),
  /** Episodes: start, file, add footage, assign shots. */
  'episode.write': staff('allow'),
  /** Episodes: rename, archive, restore, remove. */
  'episode.destructive': staff('allow'),
  /** Start a new project. */
  'project.create': ownerOnly(),
  /** Stop or start the workers. */
  'workers.control': ownerOnly(),
  /** "Show in folder": opens the machine's file explorer. */
  'reveal.local': ownerOnly(),
  /** Approve or reject what was proposed (the inbox). */
  'approval.decide': ownerOnly(),
  /** Prompts pages and the prompts inside records. */
  'view.prompts': staff('allow'),
  /** Credits, prices and the spend ledger. */
  'view.costs': staff('allow'),
  /** Draft renders. */
  'view.drafts': staff('allow'),
  /** Rejected takes. */
  'view.rejects': staff('allow'),
  /** Blocks projects: create, rename, reorder and retire sequences and blocks, edit prompts. */
  'block.write': staff('allow'),
  /** Blocks projects: send a generation to the director's review. */
  'submission.create': staff('allow'),
  /** Blocks projects: pick the final generation of a block. */
  'final.set': staff('allow'),
  /** Library: present an asset version to the director. */
  'asset.present': staff('allow'),
  /** The review area: what was sent to this person. */
  'review.view': review('allow', 'allow'),
  /** Write a director's note. */
  'feedback.director': review('allow', 'deny'),
  /** Write a continuity note. */
  'feedback.continuity': review('deny', 'allow'),
  /** Approve a submission or request a revision. Director only (the owner can too). */
  'review.decide.director': review('allow', 'deny'),
  /** Select, approve or comment on a library asset. */
  'asset.review': review('allow', 'deny'),
  /** Accounts: create a user, set a role, deactivate. */
  'users.manage': ownerOnly(),
  /** The activity log. */
  'audit.view': ownerOnly(),
} as const satisfies Record<string, Row>

export type Capability = keyof typeof CAPABILITIES

/** Everything that spends credits. Production may spend; the spend ceiling still applies. The reviewers never. */
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
