// Sequences and blocks (database). Server only, and only loaded with SHM_AUTH=on:
// import it dynamically behind authEnabled(), like lib/approvals.ts.
//
// A Sequence S01 is the internal episode PD-EP001; a Block B003 in it is the internal shot
// PD-EP001-SC003-SH0010 (lib/structure.ts). Numbers are allocated here, inside one transaction
// with the audit row, and never reused -- retired rows keep theirs. Reordering changes
// display_order only: an id and a number never change.
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Actor } from './actor-core.ts'
import { audit } from './audit.ts'
import { getDb } from './db/client.ts'
import { block, blockFinal, feedback, feedbackRead, generation, reviewSubmission, sequence } from './db/schema.ts'
import { checkDuration, checkTitle, sameIds } from './pd-order.ts'
import { nextNumber } from './pd/numbering.ts'
import { blockStatus, feedbackCounts, type BlockStatus } from './pd/status.ts'
import { blockDisplayId, blockInternalId, sequenceDisplayId, sequenceInternalId } from './structure.ts'

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type SubStatus = 'pending' | 'approved' | 'revision_requested'
type NoteStatus = 'open' | 'in_progress' | 'resolved'

const MAX_NUMBER = 999

/** One lock per key for the length of a transaction, so two creates cannot take the same number. */
async function lock(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
}

export type SequenceRow = typeof sequence.$inferSelect
export type BlockRow = typeof block.$inferSelect

export interface SequenceSummary {
  id: string
  number: number
  title: string
  description: string | null
  internalId: string | null
  displayOrder: number
  counts: { total: number; ready: number; revision: number; final: number }
}

export interface BlockLine {
  id: string
  number: number
  title: string
  internalId: string | null
  displayOrder: number
  targetDurationSeconds: number | null
  status: BlockStatus
  generations: number
  /** The active submission's round, or null when nothing is sent. */
  round: number | null
  /** Notes not yet resolved. */
  open: number
  /** Notes this person has not read (their own are never unread). */
  unread: number
}

// ---- status inputs -------------------------------------------------------------------------

interface Facts {
  generations: number
  active: { id: string; round: number; status: SubStatus } | null
  final: boolean
  finalApproved: boolean
}

async function factsFor(db: Db, blockIds: string[]): Promise<Map<string, Facts>> {
  const out = new Map<string, Facts>(blockIds.map((id) => [id, { generations: 0, active: null, final: false, finalApproved: false }]))
  if (blockIds.length === 0) return out
  const gens = await db.select({ blockId: generation.blockId, n: count() }).from(generation).where(inArray(generation.blockId, blockIds)).groupBy(generation.blockId)
  for (const g of gens) out.get(g.blockId)!.generations = Number(g.n)
  const subs = await db.select().from(reviewSubmission).where(and(inArray(reviewSubmission.blockId, blockIds), eq(reviewSubmission.isActive, true)))
  for (const s of subs) out.get(s.blockId)!.active = { id: s.id, round: s.roundNumber, status: s.status as SubStatus }
  const finals = await db
    .select({ blockId: blockFinal.blockId, submissionStatus: reviewSubmission.status })
    .from(blockFinal)
    .innerJoin(reviewSubmission, eq(reviewSubmission.id, blockFinal.submissionId))
    .where(inArray(blockFinal.blockId, blockIds))
  for (const f of finals) {
    const x = out.get(f.blockId)!
    x.final = true
    x.finalApproved = f.submissionStatus === 'approved'
  }
  return out
}

const statusOf = (f: Facts): BlockStatus =>
  blockStatus({ generations: f.generations, activeSubmission: f.active ? { status: f.active.status } : null, final: f.final, finalApproved: f.finalApproved })

// ---- sequences -----------------------------------------------------------------------------

export async function listSequences(project: string): Promise<SequenceSummary[]> {
  const db = getDb()
  const seqs = await db.select().from(sequence).where(and(eq(sequence.projectSlug, project), isNull(sequence.retiredAt))).orderBy(asc(sequence.displayOrder), asc(sequence.number))
  const blocks = await db.select({ id: block.id, sequenceId: block.sequenceId }).from(block).where(and(eq(block.projectSlug, project), isNull(block.retiredAt)))
  const facts = await factsFor(db, blocks.map((b) => b.id))
  return seqs.map((s) => {
    const counts = { total: 0, ready: 0, revision: 0, final: 0 }
    for (const b of blocks) {
      if (b.sequenceId !== s.id) continue
      counts.total++
      const st = statusOf(facts.get(b.id)!)
      if (st === 'ready_for_review') counts.ready++
      else if (st === 'revision_required') counts.revision++
      else if (st === 'final_ready') counts.final++
    }
    return { id: s.id, number: s.number, title: s.title, description: s.description, internalId: s.internalId, displayOrder: s.displayOrder, counts }
  })
}

/** A live sequence of this project by its display id (PD-S01), or null. */
export async function getSequence(project: string, id: string): Promise<SequenceRow | null> {
  const [row] = await getDb().select().from(sequence).where(and(eq(sequence.projectSlug, project), eq(sequence.id, id), isNull(sequence.retiredAt))).limit(1)
  return row ?? null
}

export async function createSequence(
  project: string, code: string, title: string, description: string, actor: Actor,
): Promise<Result<{ sequence: SequenceRow }>> {
  const t = checkTitle(title)
  if (!t.ok) return t
  const desc = String(description ?? '').trim().slice(0, 1000) || null
  return getDb().transaction(async (tx) => {
    await lock(tx, `pd-seq:${project}`)
    // Every number ever used, retired included, so a retired sequence's number is never given out again.
    const rows = await tx.select({ n: sequence.number, o: sequence.displayOrder }).from(sequence).where(eq(sequence.projectSlug, project))
    const n = nextNumber(rows.map((r) => r.n))
    if (n > MAX_NUMBER) return { ok: false as const, error: `A project can have at most ${MAX_NUMBER} sequences.` }
    const order = Math.max(0, ...rows.map((r) => r.o)) + 1
    const [row] = await tx.insert(sequence).values({
      id: sequenceDisplayId(code, n), projectSlug: project, number: n, title: t.title, description: desc,
      displayOrder: order, internalId: sequenceInternalId(code, n), createdBy: actor.id === 'local' ? null : actor.id,
    }).returning()
    await audit({ project, actor, action: 'sequence.create', objectType: 'sequence', objectId: row.id, detail: { title: row.title, internalId: row.internalId } }, tx)
    return { ok: true as const, sequence: row }
  })
}

export async function renameSequence(project: string, id: string, title: string, actor: Actor): Promise<Result> {
  const t = checkTitle(title)
  if (!t.ok) return t
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(sequence).where(and(eq(sequence.projectSlug, project), eq(sequence.id, id), isNull(sequence.retiredAt))).for('update')
    if (!row) return { ok: false as const, error: 'That sequence does not exist.' }
    if (row.title === t.title) return { ok: true as const }
    await tx.update(sequence).set({ title: t.title }).where(eq(sequence.id, id))
    await audit({ project, actor, action: 'sequence.rename', objectType: 'sequence', objectId: id, detail: { from: row.title, to: t.title } }, tx)
    return { ok: true as const }
  })
}

/** Film order of the live sequences. `orderedIds` must be exactly the live ones. Ids and numbers never change. */
export async function reorderSequences(project: string, orderedIds: string[], actor: Actor): Promise<Result> {
  return getDb().transaction(async (tx) => {
    await lock(tx, `pd-seq:${project}`)
    const live = await tx.select({ id: sequence.id }).from(sequence).where(and(eq(sequence.projectSlug, project), isNull(sequence.retiredAt)))
    if (!sameIds(live.map((r) => r.id), orderedIds)) return { ok: false as const, error: 'The list changed. Reload and try again.' }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(sequence).set({ displayOrder: i + 1 }).where(and(eq(sequence.projectSlug, project), eq(sequence.id, orderedIds[i])))
    }
    await audit({ project, actor, action: 'sequence.reorder', objectType: 'project', objectId: project, detail: { order: orderedIds } }, tx)
    return { ok: true as const }
  })
}

/** Soft delete. Refused while the sequence still has live blocks: retire those first. The number stays spent. */
export async function retireSequence(project: string, id: string, actor: Actor): Promise<Result> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(sequence).where(and(eq(sequence.projectSlug, project), eq(sequence.id, id), isNull(sequence.retiredAt))).for('update')
    if (!row) return { ok: false as const, error: 'That sequence does not exist.' }
    const [{ n }] = await tx.select({ n: count() }).from(block).where(and(eq(block.sequenceId, id), isNull(block.retiredAt)))
    if (Number(n) > 0) return { ok: false as const, error: `${id} still has ${n} block${Number(n) === 1 ? '' : 's'}. Retire them first.` }
    await tx.update(sequence).set({ retiredAt: new Date() }).where(eq(sequence.id, id))
    await audit({ project, actor, action: 'sequence.retire', objectType: 'sequence', objectId: id, detail: { title: row.title } }, tx)
    return { ok: true as const }
  })
}

// ---- blocks --------------------------------------------------------------------------------

export async function listBlocks(sequenceId: string, viewer: Actor | null): Promise<BlockLine[]> {
  const db = getDb()
  const rows = await db.select().from(block).where(and(eq(block.sequenceId, sequenceId), isNull(block.retiredAt))).orderBy(asc(block.displayOrder), asc(block.number))
  const ids = rows.map((b) => b.id)
  const facts = await factsFor(db, ids)

  // Notes live on submissions; a block's notes are those of every round it has had.
  const notes = ids.length
    ? await db
        .select({ id: feedback.id, blockId: reviewSubmission.blockId, status: feedback.resolutionStatus, author: feedback.authorId })
        .from(feedback)
        .innerJoin(reviewSubmission, eq(reviewSubmission.id, feedback.submissionId))
        .where(inArray(reviewSubmission.blockId, ids))
    : []
  const read = new Set<string>()
  if (viewer && notes.length) {
    const r = await db.select({ id: feedbackRead.feedbackId }).from(feedbackRead).where(and(eq(feedbackRead.userId, viewer.id), inArray(feedbackRead.feedbackId, notes.map((n) => n.id))))
    for (const x of r) read.add(x.id)
    for (const n of notes) if (n.author === viewer.id) read.add(n.id)
  }

  return rows.map((b) => {
    const f = facts.get(b.id)!
    const mine = notes.filter((n) => n.blockId === b.id).map((n) => ({ id: n.id, resolutionStatus: n.status as NoteStatus }))
    const c = feedbackCounts(mine, read)
    return {
      id: b.id, number: b.number, title: b.title, internalId: b.internalId, displayOrder: b.displayOrder,
      targetDurationSeconds: b.targetDurationSeconds, status: statusOf(f), generations: f.generations,
      round: f.active?.round ?? null, open: c.open, unread: viewer ? c.unread : 0,
    }
  })
}

/** A live block of this project by its display id (PD-S01-B003), or null. */
export async function getBlock(project: string, id: string): Promise<BlockRow | null> {
  const [row] = await getDb().select().from(block).where(and(eq(block.projectSlug, project), eq(block.id, id), isNull(block.retiredAt))).limit(1)
  return row ?? null
}

export async function createBlock(
  sequenceId: string, title: string, targetDuration: unknown, actor: Actor,
): Promise<Result<{ block: BlockRow }>> {
  const t = checkTitle(title)
  if (!t.ok) return t
  const d = checkDuration(targetDuration)
  if (!d.ok) return d
  return getDb().transaction(async (tx) => {
    const [seq] = await tx.select().from(sequence).where(and(eq(sequence.id, sequenceId), isNull(sequence.retiredAt)))
    if (!seq) return { ok: false as const, error: 'That sequence does not exist.' }
    await lock(tx, `pd-block:${sequenceId}`)
    const rows = await tx.select({ n: block.number, o: block.displayOrder }).from(block).where(eq(block.sequenceId, sequenceId))
    const n = nextNumber(rows.map((r) => r.n))
    if (n > MAX_NUMBER) return { ok: false as const, error: `A sequence can have at most ${MAX_NUMBER} blocks.` }
    const order = Math.max(0, ...rows.map((r) => r.o)) + 1
    const code = seq.id.replace(/-S\d+$/, '')
    const [row] = await tx.insert(block).values({
      id: blockDisplayId(code, seq.number, n), projectSlug: seq.projectSlug, sequenceId, number: n,
      internalId: blockInternalId(code, seq.number, n), title: t.title, displayOrder: order,
      targetDurationSeconds: d.seconds, createdBy: actor.id === 'local' ? null : actor.id,
    }).returning()
    await audit({ project: seq.projectSlug, actor, action: 'block.create', objectType: 'block', objectId: row.id, detail: { title: row.title, internalId: row.internalId, targetDurationSeconds: d.seconds } }, tx)
    return { ok: true as const, block: row }
  })
}

async function liveBlock(tx: Tx, project: string, id: string): Promise<BlockRow | null> {
  const [row] = await tx.select().from(block).where(and(eq(block.projectSlug, project), eq(block.id, id), isNull(block.retiredAt))).for('update')
  return row ?? null
}

export async function renameBlock(project: string, id: string, title: string, actor: Actor): Promise<Result> {
  const t = checkTitle(title)
  if (!t.ok) return t
  return getDb().transaction(async (tx) => {
    const row = await liveBlock(tx, project, id)
    if (!row) return { ok: false as const, error: 'That block does not exist.' }
    if (row.title === t.title) return { ok: true as const }
    await tx.update(block).set({ title: t.title }).where(eq(block.id, id))
    await audit({ project, actor, action: 'block.rename', objectType: 'block', objectId: id, detail: { from: row.title, to: t.title } }, tx)
    return { ok: true as const }
  })
}

export async function setTargetDuration(project: string, id: string, duration: unknown, actor: Actor): Promise<Result> {
  const d = checkDuration(duration)
  if (!d.ok) return d
  return getDb().transaction(async (tx) => {
    const row = await liveBlock(tx, project, id)
    if (!row) return { ok: false as const, error: 'That block does not exist.' }
    if (row.targetDurationSeconds === d.seconds) return { ok: true as const }
    await tx.update(block).set({ targetDurationSeconds: d.seconds }).where(eq(block.id, id))
    await audit({ project, actor, action: 'block.duration', objectType: 'block', objectId: id, detail: { from: row.targetDurationSeconds, to: d.seconds } }, tx)
    return { ok: true as const }
  })
}

/** Film order of the live blocks of one sequence. Changes display_order only: ids and numbers stay. */
export async function reorderBlocks(project: string, sequenceId: string, orderedIds: string[], actor: Actor): Promise<Result> {
  return getDb().transaction(async (tx) => {
    await lock(tx, `pd-block:${sequenceId}`)
    const live = await tx.select({ id: block.id }).from(block).where(and(eq(block.projectSlug, project), eq(block.sequenceId, sequenceId), isNull(block.retiredAt)))
    if (!sameIds(live.map((r) => r.id), orderedIds)) return { ok: false as const, error: 'The list changed. Reload and try again.' }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(block).set({ displayOrder: i + 1 }).where(eq(block.id, orderedIds[i]))
    }
    await audit({ project, actor, action: 'block.reorder', objectType: 'sequence', objectId: sequenceId, detail: { order: orderedIds } }, tx)
    return { ok: true as const }
  })
}

/** Soft delete: the row, its number and its history stay; the number is never reused. */
export async function retireBlock(project: string, id: string, actor: Actor): Promise<Result> {
  return getDb().transaction(async (tx) => {
    const row = await liveBlock(tx, project, id)
    if (!row) return { ok: false as const, error: 'That block does not exist.' }
    await tx.update(block).set({ retiredAt: new Date() }).where(eq(block.id, id))
    await audit({ project, actor, action: 'block.retire', objectType: 'block', objectId: id, detail: { title: row.title } }, tx)
    return { ok: true as const }
  })
}
