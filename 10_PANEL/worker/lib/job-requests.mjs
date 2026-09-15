import {
  P, appendJsonl, loadEntities, log, readCsv, readJsonl, readText, restoreText, writeCsv,
} from './project.mjs'
import { parseCsv } from './csv.mjs'
import { checkBatch, isVideoModel, makeJob, newJobId } from './batch.mjs'
import { reserveEntity } from './promote.mjs'
import { planJob } from './plan.mjs'
import { estimateCost, isAuthenticated } from './hf.mjs'

/**
 * Requests from the panel's Prompts page and its Regenerate button.
 *
 * The panel appends to JOB_REQUESTS.jsonl; this is the only code that acts on
 * one. Outcomes are appended as events to JOB_REQUEST_RESULTS.jsonl and the
 * cursor is state.processedRequests. A batch moves through
 *   received -> validated -> pricing -> priced -> queued | discarded | rejected
 * and nothing spends until Hamed approves it: pricing calls `generate cost`,
 * which is free, and only an approve appends to QUEUE.jsonl.
 *
 * Entity numbers for NEW/KIND/SLUG proposals are reserved at approval, never
 * at validation, so a batch discarded after a typo burns no number. Numbers
 * are never reused (INDEXING.md), which is why that order matters.
 */

/** A request that breaks a rule. Retrying cannot help, so it is recorded as refused. */
export class RequestError extends Error {}
const fail = (msg) => { throw new RequestError(msg) }

const emit = (event) => appendJsonl(P.jobRequestResults, { ...event, ts: new Date().toISOString() })

let cfg = null
export function configure(c) { cfg = c }

// ---------------------------------------------------------------- folding

/**
 * A batch's state from its events. Mirrored by getBatches() in lib/store.ts,
 * so the page and the worker read the same status from the same lines.
 */
export function foldBatch(events, batchId) {
  const st = { status: 'received', validated: null, priced: null, prices: {}, queued: null, message: null }
  for (const e of events) {
    if (e.batchId !== batchId) continue
    switch (e.event) {
      case 'validated': st.validated = e; st.status = 'validated'; break
      case 'price': st.prices[e.key] = e.credits; if (st.status === 'validated') st.status = 'pricing'; break
      case 'priced': st.priced = e; st.status = 'priced'; break
      case 'queued': st.queued = e; st.status = 'queued'; break
      case 'discarded': st.status = 'discarded'; break
      case 'rejected':
        st.message = e.reason
        if (e.scope === 'batch') st.status = 'rejected'
        break
      case 'error': st.message = e.reason; break
      default: break
    }
  }
  return st
}

// ---------------------------------------------------------------- handlers

async function registries() {
  const [entities, { rows: assets }] = await Promise.all([loadEntities(), readCsv(P.manifest)])
  return { entities, assets }
}

/** Rows of a submitted batch, checked against the registries as they are now. */
async function checkSubmit(req, { entities, assets }) {
  const rows = Array.isArray(req.jobs) ? req.jobs : []
  if (rows.length === 0) fail('the batch has no rows')
  if (rows.length > 200) fail('at most 200 rows in one batch')
  return checkBatch(rows, { entities, assets, cfg, allowNew: true })
}

const HANDLERS = {
  async 'batch.submit'(req) {
    if (!req.batchId) fail('missing batchId')
    const { ok, bad, newEntities } = await checkSubmit(req, await registries())
    const jobs = [
      ...ok.map((r) => ({ key: r.key, ok: true, target: r.targetId, jobId: newJobId() })),
      ...bad.map(([at, reason, key]) => ({ key: key ?? at, ok: false, reason, target: '', jobId: '' })),
    ]
    if (ok.length === 0) {
      fail(`no row can run: ${bad.map(([at, why]) => `${at}: ${why}`).join('; ').slice(0, 600)}`)
    }
    await emit({ batchId: req.batchId, reqId: req.id, event: 'validated', jobs, newEntities: newEntities.map((n) => ({ key: n.key, kind: n.kind, slug: n.slug })) })
    await log(`BATCH ${req.batchId} validated: ${ok.length} ok, ${bad.length} skipped`)
  },

  async 'batch.approve'(req, { state, dry }) {
    const events = await readJsonl(P.jobRequestResults)
    const st = foldBatch(events, req.batchId)
    if (st.status !== 'priced') fail(`batch is ${st.status}, not priced`)
    if (req.expectedTotal != null && st.priced && Math.abs(Number(st.priced.total) - Number(req.expectedTotal)) > 0.5) {
      fail(`the price changed to ${st.priced.total} credits since the page was loaded; approve again`)
    }
    if (dry) { await log(`DRY-RUN would approve ${req.batchId} (${st.priced?.total} credits)`); return }

    const submit = (await readJsonl(P.jobRequests)).find((r) => r.type === 'batch.submit' && r.batchId === req.batchId)
    if (!submit) fail('the submission for this batch is missing')

    // Snapshot the entity registry as text: if anything below fails half-way
    // it is put back byte for byte and the request is retried, never half-applied.
    const entitiesText = await readText(P.entities)
    const { header, rows: eRows } = parseCsv(entitiesText)
    const { rows: assets } = await readCsv(P.manifest)

    // Rows this batch reserved in an earlier, interrupted approve are adopted,
    // not counted as clashes: the same proposal gets the same number back.
    const mine = eRows.filter((e) => String(e.description).includes(`Reserved by ${req.batchId}`))
    const others = eRows.filter((e) => !mine.includes(e))
    const { ok, bad } = await checkBatch(submit.jobs, { entities: others, assets, cfg, allowNew: true })
    const jobIdFor = new Map((st.validated?.jobs ?? []).filter((j) => j.ok).map((j) => [j.key, j.jobId]))
    if (ok.some((r) => !jobIdFor.has(r.key))) fail('a row changed since validation; submit the batch again')
    const brokeSince = bad.filter(([, , key]) => jobIdFor.has(key))
    if (brokeSince.length) fail(`no longer valid: ${brokeSince.map(([at, why]) => `${at}: ${why}`).join('; ')}`)

    const assigned = []
    const idFor = new Map() // NEW/KIND/SLUG -> reserved id
    try {
      for (const r of ok) {
        if (!r.targetId.startsWith('NEW/')) continue
        const [, kind, slug] = r.targetId.split('/')
        let row = mine.find((e) => e.kind === kind && e.slug === slug)
        if (!row) {
          row = reserveEntity(eRows, {
            kind, slug, name: r.newEntity?.name, description: r.newEntity?.description
              ? `${String(r.newEntity.description).trim()} (Reserved by ${req.batchId}.)`
              : null, by: req.batchId,
          })
        }
        idFor.set(r.targetId, row.id)
        assigned.push({ key: r.key, proposal: r.targetId, id: row.id, shortId: row.short_id })
      }
      if (assigned.length) await writeCsv(P.entities, eRows, header)

      const present = new Set((await readJsonl(P.queue)).map((q) => q.jobId))
      const jobIds = {}
      let queued = 0
      for (const r of ok) {
        const jobId = jobIdFor.get(r.key)
        jobIds[r.key] = jobId
        if (present.has(jobId)) continue // a crash between the append and the state write: already queued
        await appendJsonl(P.queue, makeJob(r, { jobId, enqueuedBy: 'panel:batch', batchId: req.batchId, targetId: idFor.get(r.targetId) ?? r.targetId }))
        queued++
      }
      const total = st.priced?.total ?? null
      const room = cfg.costCeilingCredits - (state.spentCredits ?? 0)
      const ceilingNote = total != null && total > room
        ? `${total} credits is more than the ${room} left under costCeilingCredits this run; the worker will hold the rest until spentCredits is cleared in queue/state.json`
        : undefined
      await emit({ batchId: req.batchId, reqId: req.id, event: 'queued', jobIds, assigned, total, ...(ceilingNote && { ceilingNote }) })
      await log(`BATCH ${req.batchId} approved: ${queued} job(s) queued${assigned.length ? `, reserved ${assigned.map((a) => a.id).join(', ')}` : ''}`)
    } catch (e) {
      await restoreText(P.entities, entitiesText).catch((r) => log(`ROLLBACK entities failed: ${r.message}`))
      throw e
    }
  },

  async 'batch.discard'(req) {
    const st = foldBatch(await readJsonl(P.jobRequestResults), req.batchId)
    if (st.status === 'queued') fail('already queued; jobs cannot be un-queued from here')
    if (st.status === 'discarded') fail('already discarded')
    await emit({ batchId: req.batchId, reqId: req.id, event: 'discarded' })
    await log(`BATCH ${req.batchId} discarded`)
  },

  /**
   * Run an accepted take's job again. The queue record is the source of
   * truth: the staging sidecar leaves with the file when a take is promoted.
   */
  async regenerate(req, { state, dry }) {
    const queue = await readJsonl(P.queue)
    const src = queue.find((q) => q.jobId === req.jobId)
    if (!src) fail(`job ${req.jobId} is not in the queue file`)
    if (!(state.processedJobs ?? []).includes(req.jobId)) fail(`job ${req.jobId} has not generated yet`)
    if (dry) { await log(`DRY-RUN would regenerate ${req.jobId}`); return }

    const jobId = newJobId()
    const note = String(req.note ?? '').trim()
    const params = { ...(src.params ?? {}) }
    if (isVideoModel(src.model) && typeof req.sound === 'boolean') params.generate_audio = req.sound
    await appendJsonl(P.queue, {
      jobId,
      parentJobId: src.jobId,
      attempt: (src.attempt ?? 1) + 1,
      stage: src.stage ?? null,
      target: src.target,
      variant: src.variant,
      model: src.model,
      prompt: src.basePrompt ?? src.prompt,
      basePrompt: src.basePrompt ?? src.prompt,
      params,
      refs: src.refs ?? [],
      revisionNotes: [...(src.revisionNotes ?? []), note].filter(Boolean),
      label: src.label ?? null,
      enqueuedAt: new Date().toISOString(),
      enqueuedBy: 'panel:regenerate',
    })
    await emit({ batchId: null, reqId: req.id, event: 'queued', jobIds: { [req.jobId]: jobId }, assigned: [], total: null })
    await log(`REGENERATE ${req.jobId} -> ${jobId} (attempt ${(src.attempt ?? 1) + 1})${note ? ` note: ${note}` : ''}`)
  },
}

// Last retryable error per request, so a locked file is logged once, not every few seconds.
const retrying = new Map()

/**
 * Handle every request the panel has appended and the worker has not seen.
 * Fast: validation and approval only. The caller holds the registry lock.
 * Returns how many requests were settled.
 */
export async function runJobRequests(state, { dry = false } = {}) {
  const reqs = await readJsonl(P.jobRequests)
  state.processedRequests ??= []
  const seen = new Set(state.processedRequests)
  let count = 0
  for (const req of reqs.filter((r) => r && r.id && !seen.has(r.id))) {
    const handler = HANDLERS[req.type]
    try {
      if (!handler) fail(`unknown request type '${req.type}'`)
      await handler(req, { state, dry })
      // In dry mode an approve or regenerate is only described; leave it for a real run.
      if (dry && (req.type === 'batch.approve' || req.type === 'regenerate')) continue
      state.processedRequests.push(req.id)
      retrying.delete(req.id)
      count++
    } catch (e) {
      if (!(e instanceof RequestError)) {
        if (retrying.get(req.id) !== e.message) {
          await log(`ERROR job request ${req.id} (${req.type}), will retry: ${e.message}`)
          await emit({ batchId: req.batchId ?? null, reqId: req.id, event: 'error', reason: e.message })
        }
        retrying.set(req.id, e.message)
        continue
      }
      retrying.delete(req.id)
      await emit({
        batchId: req.batchId ?? null, reqId: req.id, event: 'rejected',
        scope: req.type === 'batch.submit' ? 'batch' : 'request', reason: e.message,
      })
      await log(`JOB REQUEST ${req.id} ${req.type} refused: ${e.message}`)
      state.processedRequests.push(req.id)
      count++
    }
  }
  return count
}

// Batches being priced right now, so a pass and the watcher never price one twice.
const inFlight = new Set()
let authWarned = false

/**
 * Price every validated batch with `generate cost`, one job at a time, with
 * no lock held: a cost call takes seconds and a batch can have dozens. Only
 * the registry read for planning runs under `exclusive`.
 */
export async function priceBatches(state, { dry = false, exclusive = (fn) => fn() } = {}) {
  const processed = new Set(state.processedRequests ?? [])
  const submits = (await readJsonl(P.jobRequests)).filter((r) => r.type === 'batch.submit' && processed.has(r.id))
  if (submits.length === 0) return 0
  const events = await readJsonl(P.jobRequestResults)
  let priced = 0

  for (const submit of submits) {
    const st = foldBatch(events, submit.batchId)
    if (st.status !== 'validated' && st.status !== 'pricing') continue
    if (inFlight.has(submit.batchId)) continue
    inFlight.add(submit.batchId)
    try {
      if (!(await isAuthenticated())) {
        if (!authWarned) {
          await emit({ batchId: submit.batchId, reqId: submit.id, event: 'error', reason: 'not authenticated: run higgsfield auth login, then the batch is priced' })
          await log(`HOLD pricing ${submit.batchId}: not authenticated`)
          authWarned = true
        }
        continue
      }
      authWarned = false
      const okKeys = new Set((st.validated?.jobs ?? []).filter((j) => j.ok).map((j) => j.key))
      const { ok } = await exclusive(async () => checkBatch(submit.jobs, { ...(await registries()), cfg, allowNew: true }))
      let total = 0
      let unpriced = 0
      for (const row of ok) {
        if (!okKeys.has(row.key)) continue
        let credits = st.prices[row.key]
        if (credits === undefined) {
          const job = makeJob(row, { jobId: 'price', enqueuedBy: 'price' })
          const plan = await exclusive(async () => { const { entities, assets } = await registries(); return planJob(job, entities, assets, { cfg, priceOnly: true }) })
          credits = plan.skip ? null : (await estimateCost(plan.model, plan.params)).credits
          await emit({ batchId: submit.batchId, event: 'price', key: row.key, credits })
          await log(`COST ${submit.batchId}/${row.key} ${row.model} = ${credits ?? 'unknown'} credits`)
        }
        if (credits == null) unpriced++
        else total += credits
      }
      await emit({ batchId: submit.batchId, event: 'priced', total, unpriced })
      await log(`BATCH ${submit.batchId} priced: ${total} credits${unpriced ? ` (+${unpriced} unpriced)` : ''}${dry ? ' [dry-run: waiting for approval as usual]' : ''}`)
      priced++
    } catch (e) {
      await log(`ERROR pricing ${submit.batchId}: ${e.message}`)
      await emit({ batchId: submit.batchId, event: 'error', reason: `pricing failed: ${e.message}` })
    } finally {
      inFlight.delete(submit.batchId)
    }
  }
  return priced
}
