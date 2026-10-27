// The review flow (database + files). Server only, behind authEnabled(): import dynamically.
//
// Production sends one generation at a time to the director: a submission, numbered in rounds.
// The newest generation never replaces the active one by itself; only submit() does, and it keeps
// the old round. The director and the script supervisor only ever see submissions, never a
// generation that was not sent (PRD 8, 9, 14). Approval belongs to one submission.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Actor } from './actor-core.ts'
import { can } from './access/can.ts'
import type { Capability } from './access/capabilities.ts'
import { audit } from './audit.ts'
import { getDb } from './db/client.ts'
import { block, blockFinal, feedback, feedbackRead, generation, reviewSubmission, sequence, user } from './db/schema.ts'
import { resolveGenerationFiles } from './pd-generations.ts'
import { gLabel } from './pd/numbering.ts'
import {
  alreadyActive, canAddNote, canSetResolution, categoryFor, checkDecision, checkNote, checkTimecode, isResolution,
  pickActiveSubmission, shaCacheKey,
  type Decision, type FeedbackCategory, type Resolution, type SubStatus,
} from './pd/review-rules.ts'
import { blockStatus, type BlockStatus } from './pd/status.ts'
import { canFinalize, continuityWarning, nextRound } from './pd/submission.ts'
import { safeResolve } from './paths.ts'
import type { Project } from './projects'

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }
type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

async function lock(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
}

const may = (actor: Actor, cap: Capability) => can(actor.role, cap) === 'allow'
const denied = (): { ok: false; error: string } => ({ ok: false, error: 'Your role cannot do that.' })

// ---- file hash -----------------------------------------------------------------------------

const hashCache = new Map<string, string>()
const HASH_CACHE_MAX = 500

/** sha256 of a file, streamed. Cached by path + modified time + size, so serving does not re-hash. */
export async function fileSha256(abs: string): Promise<string> {
  const st = await fs.stat(abs)
  const key = shaCacheKey(abs, st.mtimeMs, st.size)
  const hit = hashCache.get(key)
  if (hit) return hit
  const h = createHash('sha256')
  await pipeline(createReadStream(abs), h)
  const hex = h.digest('hex')
  if (hashCache.size >= HASH_CACHE_MAX) hashCache.delete(hashCache.keys().next().value as string)
  hashCache.set(key, hex)
  return hex
}

// ---- views ---------------------------------------------------------------------------------

export interface NoteView {
  id: string
  submissionId: string
  round: number
  category: FeedbackCategory
  body: string
  timecodeSeconds: number | null
  authorId: string
  authorName: string
  authorRole: string
  resolutionStatus: Resolution
  resolvedAt: Date | null
  createdAt: Date
  read: boolean
  mine: boolean
}

export interface SubmissionView {
  id: string
  /** Only production gets this; the reviewers' views leave it empty. */
  generationId: string
  round: number
  gNumber: number
  gLabel: string
  status: SubStatus
  isActive: boolean
  submittedAt: Date
  submittedByName: string
  decidedByName: string | null
  decidedAt: Date | null
  notes: NoteView[]
}

async function loadSubmissions(db: Db, blockId: string, viewerId: string): Promise<SubmissionView[]> {
  const subs = await db
    .select({ s: reviewSubmission, g: generation.gNumber })
    .from(reviewSubmission)
    .innerJoin(generation, eq(generation.id, reviewSubmission.generationId))
    .where(eq(reviewSubmission.blockId, blockId))
    .orderBy(desc(reviewSubmission.roundNumber))
  if (subs.length === 0) return []
  const notes = await db.select().from(feedback).where(inArray(feedback.submissionId, subs.map((x) => x.s.id))).orderBy(asc(feedback.createdAt))
  const ids = [...new Set([...subs.flatMap((x) => [x.s.submittedBy, x.s.decidedBy]), ...notes.map((n) => n.authorId)].filter((x): x is string => !!x))]
  const names = new Map((await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))).map((u) => [u.id, u.name]))
  const read = new Set(
    notes.length
      ? (await db.select({ id: feedbackRead.feedbackId }).from(feedbackRead).where(and(eq(feedbackRead.userId, viewerId), inArray(feedbackRead.feedbackId, notes.map((n) => n.id))))).map((r) => r.id)
      : [],
  )
  const round = new Map(subs.map((x) => [x.s.id, x.s.roundNumber]))
  return subs.map(({ s, g }) => ({
    id: s.id, generationId: s.generationId, round: s.roundNumber, gNumber: g, gLabel: gLabel(g),
    status: s.status as SubStatus, isActive: s.isActive, submittedAt: s.submittedAt,
    submittedByName: names.get(s.submittedBy) ?? 'Unknown', decidedByName: s.decidedBy ? names.get(s.decidedBy) ?? 'Unknown' : null, decidedAt: s.decidedAt,
    notes: notes.filter((n) => n.submissionId === s.id).map((n) => ({
      id: n.id, submissionId: n.submissionId, round: round.get(n.submissionId)!, category: n.category as FeedbackCategory, body: n.body,
      timecodeSeconds: n.timecodeSeconds === null ? null : Number(n.timecodeSeconds), authorId: n.authorId, authorName: names.get(n.authorId) ?? 'Unknown',
      authorRole: n.authorRole, resolutionStatus: n.resolutionStatus as Resolution, resolvedAt: n.resolvedAt, createdAt: n.createdAt,
      read: read.has(n.id) || n.authorId === viewerId, mine: n.authorId === viewerId,
    })),
  }))
}

export interface NeighbourBlock { id: string; sequenceId: string; title: string }

/** The block before and after this one in film order (sequences first, then blocks), across sequences. */
async function neighbours(db: Db, project: string, blockId: string): Promise<{ prev: NeighbourBlock | null; next: NeighbourBlock | null }> {
  const rows = await db
    .select({ id: block.id, sequenceId: block.sequenceId, title: block.title, bo: block.displayOrder, bn: block.number, so: sequence.displayOrder, sn: sequence.number })
    .from(block)
    .innerJoin(sequence, eq(sequence.id, block.sequenceId))
    .where(and(eq(block.projectSlug, project), isNull(block.retiredAt), isNull(sequence.retiredAt)))
  rows.sort((a, b) => a.so - b.so || a.sn - b.sn || a.bo - b.bo || a.bn - b.bn)
  const i = rows.findIndex((r) => r.id === blockId)
  const pick = (r?: (typeof rows)[number]) => (r ? { id: r.id, sequenceId: r.sequenceId, title: r.title } : null)
  return { prev: i > 0 ? pick(rows[i - 1]) : null, next: i >= 0 ? pick(rows[i + 1]) : null }
}

export interface ReviewerBlockView {
  block: { id: string; title: string; targetDurationSeconds: number | null; displayOrder: number; sequenceId: string; sequenceTitle: string }
  status: BlockStatus
  /** The round the reviewer is asked about. */
  active: SubmissionView | null
  /** Rounds before it, newest first. Never an unsent generation. */
  history: SubmissionView[]
  prev: NeighbourBlock | null
  next: NeighbourBlock | null
}

/** The reviewer's view of one block. No prompt, no cost, no generation that was not sent. */
export async function reviewBlock(project: string, blockId: string, viewerId: string): Promise<ReviewerBlockView | null> {
  const db = getDb()
  const [row] = await db
    .select({ b: block, st: sequence.title })
    .from(block).innerJoin(sequence, eq(sequence.id, block.sequenceId))
    .where(and(eq(block.projectSlug, project), eq(block.id, blockId), isNull(block.retiredAt)))
  if (!row) return null
  const all = (await loadSubmissions(db, blockId, viewerId)).map((s) => ({ ...s, generationId: '' }))
  const active = pickActiveSubmission(all)
  const [fin] = await db.select({ s: reviewSubmission.status }).from(blockFinal).innerJoin(reviewSubmission, eq(reviewSubmission.id, blockFinal.submissionId)).where(eq(blockFinal.blockId, blockId))
  const status = blockStatus({ generations: all.length, activeSubmission: active ? { status: active.status } : null, final: !!fin, finalApproved: fin?.s === 'approved' })
  const near = await neighbours(db, project, blockId)
  return {
    block: { id: row.b.id, title: row.b.title, targetDurationSeconds: row.b.targetDurationSeconds, displayOrder: row.b.displayOrder, sequenceId: row.b.sequenceId, sequenceTitle: row.st },
    status, active, history: all.filter((s) => s !== active), ...near,
  }
}

/** Past rounds only: what was sent before the active one. Never an unsent generation. */
export async function reviewHistory(project: string, blockId: string, viewerId: string): Promise<SubmissionView[]> {
  return (await reviewBlock(project, blockId, viewerId))?.history ?? []
}

export interface FinalView { generationId: string; gLabel: string; submissionId: string; round: number | null; byName: string; at: Date }

export interface ProductionReview {
  submissions: SubmissionView[]
  activeId: string | null
  final: FinalView | null
  openContinuity: number
  unreadIds: string[]
}

/** Everything about one block's review, for production: every round, every note, the Final. */
export async function productionReview(blockId: string, viewerId: string): Promise<ProductionReview> {
  const db = getDb()
  const submissions = await loadSubmissions(db, blockId, viewerId)
  const [fin] = await db
    .select({ f: blockFinal, g: generation.gNumber, by: user.name })
    .from(blockFinal).innerJoin(generation, eq(generation.id, blockFinal.generationId)).innerJoin(user, eq(user.id, blockFinal.finalizedBy))
    .where(eq(blockFinal.blockId, blockId))
  const notes = submissions.flatMap((s) => s.notes)
  return {
    submissions,
    activeId: pickActiveSubmission(submissions)?.id ?? null,
    final: fin ? { generationId: fin.f.generationId, gLabel: gLabel(fin.g), submissionId: fin.f.submissionId, round: submissions.find((s) => s.id === fin.f.submissionId)?.round ?? null, byName: fin.by, at: fin.f.finalizedAt } : null,
    openContinuity: notes.filter((n) => n.category === 'continuity' && n.resolutionStatus !== 'resolved').length,
    unreadIds: notes.filter((n) => !n.read).map((n) => n.id),
  }
}

// ---- writes --------------------------------------------------------------------------------

/**
 * Send one generation to the director as the next round. The previous active round is kept (only
 * is_active turns off); the new one is pending. Nothing else ever changes the active round.
 */
export async function submit(pr: Project, blockId: string, generationId: string, actor: Actor): Promise<Result<{ round: number; gLabel: string; submissionId: string }>> {
  if (!may(actor, 'submission.create')) return denied()
  const db = getDb()
  const [b] = await db.select().from(block).where(and(eq(block.projectSlug, pr.slug), eq(block.id, blockId), isNull(block.retiredAt)))
  if (!b) return { ok: false, error: 'That block does not exist.' }
  const [g] = await db.select().from(generation).where(and(eq(generation.id, generationId), eq(generation.blockId, blockId), eq(generation.projectSlug, pr.slug)))
  if (!g) return { ok: false, error: 'That generation does not belong to this block.' }
  const st = (await resolveGenerationFiles(pr, [g])).get(`${g.hfJobId ?? ''}|${g.candidate ?? ''}`)
  if (st && (st.decision === 'denied' || st.decision === 'discarded')) return { ok: false, error: `${gLabel(g.gNumber)} was ${st.decision}, so it cannot be sent.` }
  const rel = st?.file ?? null
  const abs = rel ? safeResolve(pr.root, rel) : null
  if (!abs) return { ok: false, error: `${gLabel(g.gNumber)} has no file right now, so it cannot be sent.` }
  let sha: string
  try { sha = await fileSha256(abs) } catch { return { ok: false, error: `${gLabel(g.gNumber)}'s file could not be read.` } }

  return db.transaction(async (tx) => {
    await lock(tx, `pd-review:${blockId}`)
    const subs = await tx.select().from(reviewSubmission).where(eq(reviewSubmission.blockId, blockId))
    const active = pickActiveSubmission(subs)
    if (alreadyActive(active, generationId)) return { ok: false as const, error: `${gLabel(g.gNumber)} is already Round ${active!.roundNumber}.` }
    if (active) await tx.update(reviewSubmission).set({ isActive: false }).where(eq(reviewSubmission.id, active.id))
    const round = nextRound(subs.map((s) => s.roundNumber))
    const [row] = await tx.insert(reviewSubmission).values({
      blockId, generationId, roundNumber: round, submittedBy: actor.id, status: 'pending', isActive: true, fileSha256: sha,
    }).returning()
    await audit({
      project: pr.slug, actor, action: 'submission.create', objectType: 'block', objectId: blockId,
      detail: { submissionId: row.id, round, generation: gLabel(g.gNumber), replacedRound: active?.roundNumber ?? null, replacedStatus: active?.status ?? null, sha256: sha },
    }, tx)
    return { ok: true as const, round, gLabel: gLabel(g.gNumber), submissionId: row.id }
  })
}

async function submissionIn(tx: Tx, project: string, submissionId: string, forUpdate = false) {
  const q = tx.select({ s: reviewSubmission, project: block.projectSlug, retired: block.retiredAt })
    .from(reviewSubmission).innerJoin(block, eq(block.id, reviewSubmission.blockId))
    .where(and(eq(reviewSubmission.id, submissionId), eq(block.projectSlug, project)))
  const [row] = forUpdate ? await q.for('update', { of: reviewSubmission }) : await q
  return row?.s ?? null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** The director (or owner) approves the active round or asks for a revision. A revision needs a note. */
export async function directorDecide(
  project: string, submissionId: string, decision: Decision | string, note: string | undefined, actor: Actor,
): Promise<Result> {
  if (!may(actor, 'review.decide.director')) return denied()
  if (!isUuid(submissionId)) return { ok: false, error: 'That round does not exist.' }
  const text = String(note ?? '').trim()
  if (text) {
    const n = checkNote(text)
    if (!n.ok) return n
  }
  return getDb().transaction(async (tx) => {
    const first = await submissionIn(tx, project, submissionId)
    if (!first) return { ok: false as const, error: 'That round does not exist.' }
    await lock(tx, `pd-review:${first.blockId}`)
    const s = await submissionIn(tx, project, submissionId, true)
    if (!s) return { ok: false as const, error: 'That round does not exist.' }
    const c = checkDecision({ status: s.status as SubStatus, isActive: s.isActive }, decision, text)
    if (!c.ok) return c
    await tx.update(reviewSubmission).set({ status: c.decision, decidedBy: actor.id, decidedAt: new Date() }).where(eq(reviewSubmission.id, s.id))
    let noteId: string | null = null
    if (text) {
      const [f] = await tx.insert(feedback).values({ submissionId: s.id, authorId: actor.id, authorRole: actor.role, category: 'director', body: text }).returning({ id: feedback.id })
      noteId = f.id
    }
    await audit({ project, actor, action: c.decision === 'approved' ? 'submission.approve' : 'submission.revision', objectType: 'submission', objectId: s.id, detail: { block: s.blockId, round: s.roundNumber, noteId } }, tx)
    return { ok: true as const }
  })
}

/** A note on the active round. The reviewers write their own category; nothing here edits the video or the prompt. */
export async function addFeedback(
  project: string, submissionId: string, category: string | null, body: string, timecode: unknown, actor: Actor,
): Promise<Result<{ id: string }>> {
  const cat = categoryFor(actor.role, category)
  if (!cat) return actor.role === 'owner' ? { ok: false, error: 'Choose director or continuity.' } : denied()
  if (!may(actor, cat === 'director' ? 'feedback.director' : 'feedback.continuity')) return denied()
  const n = checkNote(body)
  if (!n.ok) return n
  const t = checkTimecode(timecode)
  if (!t.ok) return t
  if (!isUuid(submissionId)) return { ok: false, error: 'That round does not exist.' }
  return getDb().transaction(async (tx) => {
    const s = await submissionIn(tx, project, submissionId)
    if (!s) return { ok: false as const, error: 'That round does not exist.' }
    if (!canAddNote(s)) return { ok: false as const, error: 'That round was replaced by a newer one. Add your note to the current round.' }
    // A note never changes the round's status (PRD 9.3): only directorDecide does.
    const [f] = await tx.insert(feedback).values({
      submissionId: s.id, authorId: actor.id, authorRole: actor.role, category: cat, body: n.body,
      timecodeSeconds: t.seconds === null ? null : String(t.seconds),
    }).returning({ id: feedback.id })
    await audit({ project, actor, action: 'feedback.create', objectType: 'submission', objectId: s.id, detail: { feedbackId: f.id, category: cat, block: s.blockId, round: s.roundNumber } }, tx)
    return { ok: true as const, id: f.id }
  })
}

/**
 * Production marks how a note is being handled. The text is never touched. The supervisor and
 * the director see the status but do not set it: production is the one handling the notes.
 */
export async function setResolution(project: string, feedbackId: string, status: Resolution | string, actor: Actor): Promise<Result> {
  if (!may(actor, 'block.write') || !canSetResolution(actor.role)) return denied()
  if (!isResolution(status)) return { ok: false, error: 'Unknown status.' }
  if (!isUuid(feedbackId)) return { ok: false, error: 'That note does not exist.' }
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ f: feedback, p: block.projectSlug, blockId: block.id })
      .from(feedback).innerJoin(reviewSubmission, eq(reviewSubmission.id, feedback.submissionId)).innerJoin(block, eq(block.id, reviewSubmission.blockId))
      .where(and(eq(feedback.id, feedbackId), eq(block.projectSlug, project)))
    if (!row) return { ok: false as const, error: 'That note does not exist.' }
    if (row.f.resolutionStatus === status) return { ok: true as const }
    await tx.update(feedback).set({
      resolutionStatus: status, resolvedBy: status === 'resolved' ? actor.id : null, resolvedAt: status === 'resolved' ? new Date() : null,
    }).where(eq(feedback.id, feedbackId))
    await audit({ project, actor, action: 'feedback.resolution', objectType: 'feedback', objectId: feedbackId, detail: { block: row.blockId, from: row.f.resolutionStatus, to: status } }, tx)
    return { ok: true as const }
  })
}

/** Mark notes of this project as read by this user. Unknown ids are ignored. */
export async function markRead(project: string, feedbackIds: string[], userId: string): Promise<void> {
  const ids = [...new Set(feedbackIds.filter(isUuid))].slice(0, 500)
  if (ids.length === 0) return
  const db = getDb()
  const ok = await db
    .select({ id: feedback.id }).from(feedback)
    .innerJoin(reviewSubmission, eq(reviewSubmission.id, feedback.submissionId)).innerJoin(block, eq(block.id, reviewSubmission.blockId))
    .where(and(inArray(feedback.id, ids), eq(block.projectSlug, project)))
  if (ok.length === 0) return
  await db.insert(feedbackRead).values(ok.map((r) => ({ feedbackId: r.id, userId }))).onConflictDoNothing()
}

/**
 * Pick the Final of a block. Only a generation whose submission the director approved can be it
 * (PRD 10.3, 14.8); an older approved round still counts. Open continuity notes warn, they do
 * not block. The previous Final is recorded in the audit detail before it is replaced.
 */
export async function setFinal(project: string, blockId: string, generationId: string, actor: Actor): Promise<Result<{ warning: string | null; gLabel: string }>> {
  if (!may(actor, 'final.set')) return denied()
  if (!isUuid(generationId)) return { ok: false, error: 'That generation does not exist.' }
  return getDb().transaction(async (tx) => {
    await lock(tx, `pd-review:${blockId}`)
    const [b] = await tx.select().from(block).where(and(eq(block.projectSlug, project), eq(block.id, blockId), isNull(block.retiredAt)))
    if (!b) return { ok: false as const, error: 'That block does not exist.' }
    const [g] = await tx.select().from(generation).where(and(eq(generation.id, generationId), eq(generation.blockId, blockId)))
    if (!g) return { ok: false as const, error: 'That generation does not belong to this block.' }
    const subs = await tx.select().from(reviewSubmission).where(and(eq(reviewSubmission.blockId, blockId), eq(reviewSubmission.generationId, generationId))).orderBy(desc(reviewSubmission.roundNumber))
    const sub = subs.find((s) => canFinalize({ submissionStatus: s.status as SubStatus }))
    if (!sub) {
      return { ok: false as const, error: subs.length === 0 ? `${gLabel(g.gNumber)} was never sent to the director, so it cannot be Final.` : `${gLabel(g.gNumber)} is not approved by the director yet.` }
    }
    const [prev] = await tx.select({ f: blockFinal, g: generation.gNumber }).from(blockFinal).innerJoin(generation, eq(generation.id, blockFinal.generationId)).where(eq(blockFinal.blockId, blockId))
    if (prev?.f.generationId === generationId) return { ok: false as const, error: `${gLabel(g.gNumber)} is already the Final.` }
    await tx.insert(blockFinal).values({ blockId, generationId, submissionId: sub.id, finalizedBy: actor.id })
      .onConflictDoUpdate({ target: blockFinal.blockId, set: { generationId, submissionId: sub.id, finalizedBy: actor.id, finalizedAt: new Date() } })
    const open = await tx
      .select({ id: feedback.id }).from(feedback).innerJoin(reviewSubmission, eq(reviewSubmission.id, feedback.submissionId))
      .where(and(eq(reviewSubmission.blockId, blockId), eq(feedback.category, 'continuity'), sql`${feedback.resolutionStatus} <> 'resolved'`))
    const warning = continuityWarning(open.length)
    await audit({
      project, actor, action: 'final.set', objectType: 'block', objectId: blockId,
      detail: {
        generation: gLabel(g.gNumber), submissionId: sub.id, round: sub.roundNumber, openContinuity: open.length,
        previous: prev ? { generation: gLabel(prev.g), generationId: prev.f.generationId, submissionId: prev.f.submissionId, finalizedBy: prev.f.finalizedBy, finalizedAt: prev.f.finalizedAt } : null,
      },
    }, tx)
    return { ok: true as const, warning, gLabel: gLabel(g.gNumber) }
  })
}

// ---- media lookup --------------------------------------------------------------------------

/** One submission of this project with its generation, for the media route. Null when there is none. */
export async function submissionForMedia(project: string, submissionId: string) {
  if (!isUuid(submissionId)) return null
  const [row] = await getDb()
    .select({ s: reviewSubmission, g: generation })
    .from(reviewSubmission)
    .innerJoin(block, eq(block.id, reviewSubmission.blockId))
    .innerJoin(generation, eq(generation.id, reviewSubmission.generationId))
    .where(and(eq(reviewSubmission.id, submissionId), eq(block.projectSlug, project)))
  return row ?? null
}
