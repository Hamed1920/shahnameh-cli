'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { P } from '@/lib/paths'
import { getCandidates, getLearnings } from '@/lib/store'
import type { Learning, ReviewDecision, Verdict } from '@/lib/types'

/**
 * Write side of the panel — append-only JSONL, nothing else.
 *
 * The panel deliberately does not move files or touch the CSV registries. It
 * records intent; the worker observes REVIEW_LOG.jsonl and performs the actual
 * promotion, rejection and requeue. One writer for the filesystem means no
 * races against the PowerShell tools.
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
 * Returns a result rather than throwing: a thrown error in a Server Action
 * surfaces as a full-page crash, which would lose the note Hamed just typed.
 */
export async function decide(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const candidatePath = String(formData.get('candidate') ?? '')
  const verdict = String(formData.get('verdict') ?? '') as Verdict
  const notes = String(formData.get('notes') ?? '').trim()
  const tags = String(formData.get('tags') ?? '')
    .split(',').map((t) => t.trim()).filter(Boolean)
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

  const candidates = await getCandidates()
  const candidate = candidates.find((c) => c.path === candidatePath)
  if (!candidate) return { ok: false, error: `Unknown candidate: ${candidatePath}` }
  if (candidate.decided) return { ok: true } // idempotent: already reviewed

  const record: ReviewDecision = {
    id: newId('rev'),
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
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
  }

  await appendJsonl(P.reviewLog, record)
  revalidatePath('/')
  revalidatePath('/queue')
  return { ok: true }
}

export async function decideLearning(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  const edited = String(formData.get('rule') ?? '').trim()

  if (!id) throw new Error('missing id')
  if (status !== 'approved' && status !== 'rejected') throw new Error('bad status')

  const existing = (await getLearnings()).find((l) => l.id === id)
  if (!existing) throw new Error(`unknown learning: ${id}`)

  const updated: Learning = {
    ...existing,
    rule: edited || existing.rule,
    status,
    decidedBy: REVIEWER,
    decidedAt: new Date().toISOString(),
  }

  // Append rather than rewrite; getLearnings folds by id, last write wins.
  await appendJsonl(P.learnings, updated)
  revalidatePath('/learnings')
}
