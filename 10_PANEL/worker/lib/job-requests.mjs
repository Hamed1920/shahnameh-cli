import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CODE, P, appendJsonl, loadEntities, log, readCsv, readJsonl, readText, resolveRef, restoreText, spentWithin,
  usedShotIds, writeCsv,
} from './project.mjs'
import { parseCsv } from './csv.mjs'
import { checkBatch, isVideoModel, makeJob, newJobId } from './batch.mjs'
import { FilingError, checkUploads, fileUpload, reserveEntity } from './promote.mjs'
import { NEXT_SCENE_RX, assignScenes } from './scenes.mjs'
import { stripCode } from './ids.mjs'
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
 * Entity numbers for NEW/KIND/SLUG proposals, and scene numbers for NEXT/EPnnn
 * rows, are reserved at approval, never
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

/**
 * File the images a Regenerate request carries, the way a Review decision's
 * uploads are filed (worker.mjs fileDecisionUploads). Keyed by request id in
 * FILINGS.jsonl, so a retry after a crash reuses what was filed. A bad upload
 * refuses the request before any of them is filed.
 * Returns { uploadId: '@KIND-NNN/Vnn' }.
 */
async function fileRequestUploads(req, uploads) {
  const tokens = {}
  if (uploads.length === 0) return tokens
  for (const f of await readJsonl(P.filings)) {
    if (f.requestId === req.id && f.ok && f.uploadId) tokens[f.uploadId] = f.token
  }
  try {
    await checkUploads(uploads, new Set(Object.keys(tokens)))
    for (const u of uploads) {
      if (tokens[u.id]) continue
      const filed = await fileUpload(u, { id: req.id, reviewer: req.reviewer })
      tokens[u.id] = filed.token
      await appendJsonl(P.filings, {
        requestId: req.id, uploadId: u.id, ok: true, token: filed.token,
        entity: filed.entity, filename: filed.filename, ts: new Date().toISOString(),
      })
    }
  } catch (e) {
    if (e instanceof FilingError) fail(e.message)
    throw e
  }
  // Every file has moved into the index; drop the emptied working folder.
  await fs.rmdir(path.join(P.uploads, req.id)).catch(() => {})
  return tokens
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

      const present = new Map((await readJsonl(P.queue)).map((q) => [q.jobId, q]))

      // NEXT/EPnnn rows take the next free scenes, in row order, past every scene
      // already queued or on disk and every explicit shot in this batch. A row that
      // an interrupted approve already queued keeps the scene it got then.
      const isNext = (r) => NEXT_SCENE_RX.test(r.targetId)
      const sceneFor = assignScenes(
        ok.filter((r) => isNext(r) && !present.has(jobIdFor.get(r.key))),
        [...(await usedShotIds()), ...ok.filter((r) => !isNext(r)).map((r) => r.targetId)],
        CODE,
      )
      for (const r of ok.filter(isNext)) {
        const id = present.get(jobIdFor.get(r.key))?.target ?? sceneFor.get(r.key)
        sceneFor.set(r.key, id)
        assigned.push({ key: r.key, proposal: r.targetId, id, shortId: stripCode(CODE, id) })
      }

      const jobIds = {}
      let queued = 0
      for (const r of ok) {
        const jobId = jobIdFor.get(r.key)
        jobIds[r.key] = jobId
        if (present.has(jobId)) continue // a crash between the append and the state write: already queued
        const targetId = sceneFor.get(r.key) ?? idFor.get(r.targetId) ?? r.targetId
        await appendJsonl(P.queue, makeJob(r, { jobId, enqueuedBy: 'panel:batch', batchId: req.batchId, targetId }))
        queued++
      }
      const total = st.priced?.total ?? null
      const hours = Number(cfg.costWindowHours ?? 24)
      const room = cfg.costCeilingCredits - (await spentWithin(hours))
      const ceilingNote = total != null && total > room
        ? `${total} credits is more than the ${room} left under costCeilingCredits for the last ${hours} h; the worker holds the rest and starts them as older spend leaves the window`
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
   * The request may change the prompt, references, model, first render,
   * look, parameters and sound; anything it does not name is kept as it was.
   */
  async regenerate(req, { state, dry }) {
    const queue = await readJsonl(P.queue)
    const src = queue.find((q) => q.jobId === req.jobId)
    if (!src) fail(`job ${req.jobId} is not in the queue file`)
    if (!(state.processedJobs ?? []).includes(req.jobId)) fail(`job ${req.jobId} has not generated yet`)

    const model = String(req.model || src.model)
    const stage = req.stage === 'draft' || req.stage === 'final' ? req.stage : (src.stage ?? null)
    const variant = String(req.variant || src.variant || 'V01').toUpperCase()
    if (!/^V\d{2}$/.test(variant)) fail(`look '${variant}' is not V01, V02, ...`)
    let basePrompt = String(req.prompt ?? '').trim() || (src.basePrompt ?? src.prompt)
    const asked = Array.isArray(req.refs) ? [...new Set(req.refs.map((r) => String(r).trim()).filter(Boolean))] : (src.refs ?? [])
    const uploads = Array.isArray(req.uploads) ? req.uploads : []
    const uploadIds = new Set(uploads.map((u) => u.id))
    const { entities, assets } = await registries()
    for (const token of asked) {
      if (token.startsWith('upload:')) {
        if (!uploadIds.has(token.slice(7))) fail(`reference ${token} has no matching upload`)
        continue
      }
      const r = await resolveRef(token, entities, assets)
      if (!r.ok) fail(`reference ${token}: ${r.reason}`)
    }
    const params = { ...(src.params ?? {}) }
    // Going from draft to final (or back) moves the resolution with it, unless the request sets one.
    if (isVideoModel(model) && stage && stage !== (src.stage ?? null)) {
      params.resolution = stage === 'final' ? cfg.videoFinalResolution : cfg.videoDraftResolution
    }
    if (req.params && typeof req.params === 'object') {
      for (const [k, v] of Object.entries(req.params)) if (v !== undefined && v !== null && v !== '') params[k] = v
    }
    if (isVideoModel(model)) {
      if (typeof req.sound === 'boolean') params.generate_audio = req.sound
    } else {
      delete params.generate_audio; delete params.duration; delete params.resolution
    }
    if (dry) {
      try {
        for (const line of await checkUploads(uploads)) await log(`DRY-RUN would file ${line}`)
      } catch (e) {
        if (!(e instanceof FilingError)) throw e
        await log(`DRY-RUN filing would FAIL for ${req.id}: ${e.message}`)
      }
      await log(`DRY-RUN would regenerate ${req.jobId}`)
      return
    }

    // Images added in the dialog are filed into the index first, exactly as a
    // Review upload is, and only then is anything queued. Filed before (a retry
    // after a crash) means reused, never filed twice.
    const filedAs = await fileRequestUploads(req, uploads)
    const refs = []
    for (const raw of asked) {
      const token = raw.startsWith('upload:') ? filedAs[raw.slice(7)] : raw
      if (!token) fail(`reference ${raw} points at an upload that was not filed`)
      if (!refs.includes(token)) refs.push(token)
    }
    if (uploads.length) {
      const now = await registries()
      for (const token of refs) {
        const r = await resolveRef(token, now.entities, now.assets)
        if (!r.ok) fail(`reference ${token}: ${r.reason}`)
      }
    }
    const withFiled = (text) => String(text).replace(/@upload:(u\d{1,3})(?![\w/-])/g, (m, id) => filedAs[id] ?? m)
    basePrompt = withFiled(basePrompt)

    const jobId = newJobId()
    const note = withFiled(String(req.note ?? '').trim())
    const changed = []
    if (basePrompt !== (src.basePrompt ?? src.prompt)) changed.push('prompt')
    if (JSON.stringify(refs) !== JSON.stringify(src.refs ?? [])) changed.push('refs')
    if (model !== src.model) changed.push(`model ${model}`)
    if (stage !== (src.stage ?? null)) changed.push(`stage ${stage}`)
    if (variant !== String(src.variant || 'V01').toUpperCase()) changed.push(`look ${variant}`)
    await appendJsonl(P.queue, {
      jobId,
      parentJobId: src.jobId,
      attempt: (src.attempt ?? 1) + 1,
      stage,
      target: src.target,
      variant,
      model,
      prompt: basePrompt,
      basePrompt,
      params,
      refs,
      revisionNotes: [...(src.revisionNotes ?? []), note].filter(Boolean),
      label: src.label ?? null,
      enqueuedAt: new Date().toISOString(),
      enqueuedBy: 'panel:regenerate',
    })
    await emit({ batchId: null, reqId: req.id, event: 'queued', jobIds: { [req.jobId]: jobId }, assigned: [], total: null })
    await log(`REGENERATE ${req.jobId} -> ${jobId} (attempt ${(src.attempt ?? 1) + 1})${changed.length ? ` changed: ${changed.join(', ')}` : ''}${note ? ` note: ${note}` : ''}`)
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
