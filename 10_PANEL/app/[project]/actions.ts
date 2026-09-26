'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { splitTags } from '@/lib/indexing'
import { parseMentions } from '@/lib/mentions'
import { requireProject } from '@/lib/projects'
import { Invalid, parseJsonArray, readUploads, type PendingUpload } from '@/lib/uploads'
import { getCandidates, getLearnings, resolveRefToken } from '@/lib/store'
import { revalidateProject } from '@/lib/revalidate'
import type { Project } from '@/lib/projects'
import { MACHINE } from '@/worker/lib/machine.mjs'
import type { Candidate, Learning, ReviewDecision, Verdict } from '@/lib/types'

/**
 * Write side of the panel. Two things only:
 *   - append-only JSONL (REVIEW_LOG, LEARNINGS)
 *   - raw reviewer uploads dropped into 09_OUTPUT/_uploads/<decision id>/
 *
 * Each one is told which project it belongs to, and checks it again here: a
 * form field is whatever the browser sent.
 *
 * The panel never names, moves or registers a file and never touches the CSV
 * registries. It records intent; the worker observes REVIEW_LOG.jsonl, files
 * the uploads, and performs the promotion, rejection and requeue. One writer
 * for the registries means no races against the PowerShell tools.
 */

const REVIEWER = process.env.SHM_REVIEWER || 'hamed'

async function appendJsonl(file: string, record: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8')
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * The reference list only matters when this decision queues a generation: a
 * denial that regenerates, or an accepted draft that buys the final. Returns
 * undefined when it is irrelevant or unchanged.
 */
async function readRefs(
  pr: Project,
  formData: FormData,
  candidate: Candidate,
  regenerates: boolean,
  uploadIds: Set<string>,
): Promise<string[] | undefined> {
  const raw = parseJsonArray(formData, 'refs')
  if (!raw || !regenerates) return undefined
  if (raw.length > 12) throw new Invalid('At most 12 references.')

  const refs: string[] = []
  for (const r of raw) {
    const token = String(r ?? '').trim()
    if (token.startsWith('upload:')) {
      if (!uploadIds.has(token.slice(7))) {
        throw new Invalid(`Reference ${token} has no matching upload.`)
      }
    } else if (!token.startsWith('@') || !(await resolveRefToken(pr, token))) {
      throw new Invalid(`Reference ${token} does not resolve to a file in the index.`)
    }
    if (!refs.includes(token)) refs.push(token)
  }

  const before = candidate.sidecar.refs ?? []
  const same = refs.length === before.length && refs.every((t, i) => t === before[i])
  return same ? undefined : refs
}

/**
 * An @-mention may only point at a reference this job actually carries -- the
 * list under "References for the regeneration" (or the job's own list when
 * nothing is regenerated). Anything else would describe an image the model
 * never receives.
 */
async function checkMentions(
  pr: Project,
  mentions: string[],
  candidate: Candidate,
  refs: string[] | undefined,
): Promise<void> {
  const list = refs ?? candidate.sidecar.refs ?? []
  const paths = await Promise.all(list.map((r) => (r.startsWith('upload:') ? null : resolveRefToken(pr, r))))
  for (const m of mentions) {
    const inList = m.startsWith('@upload:')
      ? list.includes(m.slice(1))
      : await resolveRefToken(pr, m).then((p) => p !== null && paths.includes(p))
    if (!inList) {
      throw new Invalid(
        `${m} is not one of the references for this job. Add it under References, or remove it from the note.`,
      )
    }
  }
}

/**
 * Returns a result rather than throwing: a thrown error in a Server Action
 * surfaces as a full-page crash, which would lose the note Hamed just typed.
 */
export async function decide(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const pr = await requireProject(formData.get('project'))
  const candidatePath = String(formData.get('candidate') ?? '')
  const verdict = String(formData.get('verdict') ?? '') as Verdict
  const notes = String(formData.get('notes') ?? '').trim()
  const tags = splitTags(String(formData.get('tags') ?? ''))
  const requeue = formData.get('requeue') === 'on'

  if (!candidatePath) return { ok: false, error: 'Missing candidate.' }
  if (verdict !== 'accepted' && verdict !== 'denied') {
    return { ok: false, error: 'Choose Accept or Deny first.' }
  }

  // A denial with no note teaches nothing and cannot build a revision prompt.
  if (verdict === 'denied' && !notes) {
    return {
      ok: false,
      error: 'A denial needs a note saying what is wrong — that note is what drives the fix.',
    }
  }

  const candidates = await getCandidates(pr)
  const candidate = candidates.find((c) => c.path === candidatePath)
  if (!candidate) return { ok: false, error: `Unknown candidate: ${candidatePath}` }
  if (candidate.decided) return { ok: true } // idempotent: already reviewed

  const id = newId('rev')
  const regenerates = verdict === 'denied' ? requeue : candidate.sidecar.stage === 'draft'

  let uploads: PendingUpload[]
  let refs: string[] | undefined
  try {
    uploads = await readUploads(pr, formData, id)
    const uploadIds = new Set(uploads.map((u) => u.meta.id))
    refs = await readRefs(pr, formData, candidate, regenerates, uploadIds)
    await checkMentions(pr, parseMentions(notes), candidate, refs)
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }

  // The review page checks first, then holds the real submit behind a few
  // seconds of Undo. Errors must surface now, while the reviewer is still here.
  if (formData.get('validateOnly') === '1') return { ok: true }

  const record: ReviewDecision = {
    id,
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    // The machine that decided: only its worker applies it (worker/lib/machine.mjs).
    machine: MACHINE,
    candidate: candidatePath,
    jobId: candidate.sidecar.jobId,
    hfJobId: candidate.hfJobId,
    target: candidate.sidecar.target,
    variant: candidate.sidecar.variant,
    take: candidate.take,
    verdict,
    notes,
    tags,
    model: candidate.sidecar.model,
    requeue: verdict === 'denied' ? requeue : false,
    // The Sound checkbox only means something when this decision queues a job.
    ...(regenerates && { sound: formData.get('sound') === 'on' }),
    ...(refs && { refs, refsBefore: candidate.sidecar.refs ?? [] }),
    ...(uploads.length > 0 && { uploads: uploads.map((u) => u.meta) }),
  }

  // Files first, decision second: the worker must never see a decision whose
  // upload is not on disk yet. If the log append fails, take the files back.
  const dir = path.join(pr.P.uploads, id)
  try {
    if (uploads.length) {
      await fs.mkdir(dir, { recursive: true })
      for (const u of uploads) await fs.writeFile(path.join(pr.root, u.meta.file), u.bytes)
    }
    await appendJsonl(pr.P.reviewLog, record)
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true })
    return { ok: false, error: `Could not save the decision: ${(e as Error).message}` }
  }

  // Review loses the candidate, the Gallery may gain an accepted take.
  revalidateProject(pr.slug)
  return { ok: true }
}

export async function decideLearning(formData: FormData): Promise<void> {
  const pr = await requireProject(formData.get('project'))
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  const edited = String(formData.get('rule') ?? '').trim()

  if (!id) throw new Error('missing id')
  if (status !== 'approved' && status !== 'rejected') throw new Error('bad status')

  const existing = (await getLearnings(pr)).find((l) => l.id === id)
  if (!existing) throw new Error(`unknown learning: ${id}`)

  const updated: Learning = {
    ...existing,
    rule: edited || existing.rule,
    status,
    decidedBy: REVIEWER,
    decidedAt: new Date().toISOString(),
  }

  // Append rather than rewrite; getLearnings folds by id, last write wins.
  await appendJsonl(pr.P.learnings, updated)
  revalidatePath(`/${pr.slug}/learnings`)
}
