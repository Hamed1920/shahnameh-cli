import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CODE, P, appendJsonl, currentShotId, loadEntities, log, readCsv, readJsonl, readText, resolveRef, restoreText,
  spentWithin, usedShotIds, writeCsv,
} from './project.mjs'
import { parseCsv } from './csv.mjs'
import { checkBatch, hasDraftStage, isVideoModel, makeJob, newJobId, stageResolution } from './batch.mjs'
import { refreshCatalog } from './models.mjs'
import { priceStudio, studioHandlers } from './studio.mjs'
import { FilingError, checkUploads, fileUpload, reserveEntity } from './promote.mjs'
import { NEXT_SCENE_RX, assignScenes } from './scenes.mjs'
import { stripCode } from './ids.mjs'
import { planJob } from './plan.mjs'
import { cliReady, estimateCost } from './hf.mjs'
import { OLD_PANEL, ownerOf, requestOwners } from './machine.mjs'
import { PULL_FIRST, remoteChangedIndex } from './git-guard.mjs'

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

/** A batch that has ended. Late events (a price that lands after a discard) must not reopen it. */
export const BATCH_FINAL = new Set(['queued', 'discarded', 'rejected'])

/**
 * A batch's state from its events. Mirrored by getBatches() in lib/store.ts,
 * so the page and the worker read the same status from the same lines.
 *
 * `message` is the latest problem, and is cleared once the batch gets past it
 * (priced or queued), so an old "not signed in" does not stay on a batch that
 * has since been priced. `priceErrors` says why a row could not be priced.
 */
export function foldBatch(events, batchId) {
  const st = { status: 'received', validated: null, priced: null, prices: {}, priceErrors: {}, queued: null, message: null }
  for (const e of events) {
    if (e.batchId !== batchId) continue
    const ended = BATCH_FINAL.has(st.status)
    switch (e.event) {
      case 'validated': if (!ended) { st.validated = e; st.status = 'validated' } break
      case 'price':
        st.prices[e.key] = e.credits
        if (e.credits == null && e.reason) st.priceErrors[e.key] = e.reason
        else delete st.priceErrors[e.key]
        if (st.status === 'validated') st.status = 'pricing'
        break
      case 'priced': if (!ended) { st.priced = e; st.status = 'priced'; st.message = null } break
      case 'queued': st.queued = e; st.status = 'queued'; st.message = null; break
      case 'discarded': if (st.status !== 'queued') st.status = 'discarded'; break
      case 'rejected':
        if (e.scope === 'batch') { st.status = 'rejected'; st.message = e.reason } else if (!ended) st.message = e.reason
        break
      case 'error': if (!ended) st.message = e.reason; break
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

/**
 * A batch's rows with every `upload:<id>` swapped for something the worker can
 * resolve. The Prompts page sends files with a batch; they are filed into the
 * index only when the batch is approved (FILINGS.jsonl, keyed by the submit's
 * request id), so a batch that is refused or discarded burns no entity number.
 * Until then a row points at the raw file (`pending:<request id>/u1`, resolved
 * by resolveRef), which is enough to validate and price it.
 */
export async function jobsOf(submit) {
  const jobs = Array.isArray(submit.jobs) ? submit.jobs : []
  if (!Array.isArray(submit.uploads) || submit.uploads.length === 0) return jobs
  const tokens = {}
  for (const f of await readJsonl(P.filings)) {
    if (f.requestId === submit.id && f.ok && f.uploadId) tokens[f.uploadId] = f.token
  }
  return jobs.map((j) => ({
    ...j,
    refs: (j.refs ?? []).map((t) => {
      if (!String(t).startsWith('upload:')) return t
      const id = String(t).slice(7)
      return tokens[id] ?? `pending:${submit.id}/${id}`
    }),
  }))
}

/** Rows of a submitted batch, checked against the registries as they are now. */
async function checkSubmit(req, { entities, assets }) {
  const rows = await jobsOf(req)
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
    // Files added on the Prompts page are checked now and filed at approval.
    const uploads = Array.isArray(req.uploads) ? req.uploads : []
    if (uploads.length) {
      try {
        await checkUploads(uploads)
      } catch (e) {
        if (e instanceof FilingError) fail(e.message)
        throw e
      }
    }
    const { ok, bad, newEntities } = await checkSubmit(req, await registries())
    const jobs = [
      ...ok.map((r) => ({ key: r.key, ok: true, target: r.targetId, jobId: newJobId() })),
      ...bad.map(([at, reason, key]) => ({ key: key ?? at, ok: false, reason, target: '', jobId: '' })),
    ]
    if (ok.length === 0) {
      // Each row's own reason is recorded (the validated event) before the refusal,
      // so the page can show it on the row rather than one long joined message.
      await emit({ batchId: req.batchId, reqId: req.id, event: 'validated', jobs, newEntities: [] })
      fail(`no row can run: ${bad.map(([at, why]) => `${at}: ${why}`).join('; ').slice(0, 600)}`)
    }
    await emit({ batchId: req.batchId, reqId: req.id, event: 'validated', jobs, newEntities: newEntities.map((n) => ({ key: n.key, kind: n.kind, slug: n.slug })) })
    await log(`BATCH ${req.batchId} validated: ${ok.length} ok, ${bad.length} skipped`)
  },

  async 'batch.approve'(req, { state, dry }) {
    const events = await readJsonl(P.jobRequestResults)
    const st = foldBatch(events, req.batchId)
    if (st.status !== 'priced') fail(`batch is ${st.status}, not priced`)
    // Never spend without a price: an unpriced row would reach the queue with no
    // figure to check against either ceiling.
    const unpriced = Number(st.priced?.unpriced ?? 0)
    if (unpriced > 0) {
      const why = [...new Set(Object.values(st.priceErrors))].join('; ')
      fail(`${unpriced} row(s) could not be priced${why ? ` (${why})` : ''}; discard the batch, fix them and submit again`)
    }
    if (req.expectedTotal != null && st.priced && Math.abs(Number(st.priced.total) - Number(req.expectedTotal)) > 0.5) {
      fail(`the price changed to ${st.priced.total} credits since the page was loaded; approve again`)
    }
    if (dry) { await log(`DRY-RUN would approve ${req.batchId} (${st.priced?.total} credits)`); return }

    const submit = (await readJsonl(P.jobRequests)).find((r) => r.type === 'batch.submit' && r.batchId === req.batchId)
    if (!submit) fail('the submission for this batch is missing')

    // New entity and scene numbers are handed out below: never on top of another
    // machine's unpulled index (git-guard.mjs). A plain Error, so the approve is
    // held and retried after the pull, not refused.
    if (await remoteChangedIndex()) throw new Error(PULL_FIRST)

    // The pictures sent with the batch go into the index now, the way a Review
    // upload is filed, before anything is numbered or queued. Filed before (a retry
    // after a crash) means reused, never filed twice.
    const uploads = Array.isArray(submit.uploads) ? submit.uploads : []
    if (uploads.length) await fileRequestUploads(submit, uploads)

    // Snapshot the entity registry as text: if anything below fails half-way
    // it is put back byte for byte and the request is retried, never half-applied.
    const entitiesText = await readText(P.entities)
    const { header, rows: eRows } = parseCsv(entitiesText)
    const { rows: assets } = await readCsv(P.manifest)

    // Rows this batch reserved in an earlier, interrupted approve are adopted,
    // not counted as clashes: the same proposal gets the same number back.
    const mine = eRows.filter((e) => String(e.description).includes(`Reserved by ${req.batchId}`))
    const others = eRows.filter((e) => !mine.includes(e))
    const { ok, bad } = await checkBatch(await jobsOf(submit), { entities: others, assets, cfg, allowNew: true })
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

  // The reference studio (worker/lib/studio.mjs).
  ...studioHandlers({ fail, emit: (e) => emit(e), getCfg: () => cfg }),

  /** Fetch the Higgsfield model list again (Prompts page, "Refresh models"). */
  async 'models.refresh'(req, { dry }) {
    if (dry) { await log('DRY-RUN would refresh the model list'); return }
    const r = await refreshCatalog({ log })
    if (!r.ok) {
      if (/another worker/.test(r.error ?? '')) return // that worker's refresh answers this request too
      fail(r.error)
    }
    await emit({ batchId: null, reqId: req.id, event: 'models', count: r.count, usable: r.usable })
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
    let stage = req.stage === 'draft' || req.stage === 'final' ? req.stage : (src.stage ?? null)
    // A model with no resolution steps renders once; an image model has no stage at all.
    if (!isVideoModel(model) || !hasDraftStage(model)) stage = null
    else if (!stage) stage = 'draft'
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
    if (isVideoModel(model) && (stage !== (src.stage ?? null) || model !== src.model)) {
      const r = stageResolution(model, stage, cfg)
      if (r) params.resolution = r
      else delete params.resolution
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
      target: await currentShotId(src.target),
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
  const ownerOfReq = requestOwners(reqs)
  for (const req of reqs.filter((r) => r && r.id && !seen.has(r.id))) {
    // Another machine's request is its worker's to act on; one from an older panel, nobody's.
    const owner = ownerOfReq(req)
    if (owner === 'other') continue
    if (owner === 'old') {
      if (dry) continue
      await emit({
        batchId: req.batchId ?? null, reqId: req.id, event: 'rejected',
        scope: req.type === 'batch.submit' ? 'batch' : 'request', reason: OLD_PANEL,
        ...(req.sessionId && { sessionId: req.sessionId }), ...(req.genId && { genId: req.genId }),
      })
      await log(`JOB REQUEST ${req.id} ${req.type} skipped: ${OLD_PANEL}`)
      state.processedRequests.push(req.id)
      count++
      continue
    }
    const handler = HANDLERS[req.type]
    try {
      if (!handler) fail(`unknown request type '${req.type}'`)
      await handler(req, { state, dry })
      // In dry mode an approve or regenerate is only described; leave it for a real run.
      // A dry run only describes what spends or files; leave those for a real run.
      const spendsOrFiles = ['batch.approve', 'regenerate', 'studio.approve', 'studio.pick', 'studio.close'].includes(req.type)
      if (dry && spendsOrFiles) continue
      state.processedRequests.push(req.id)
      retrying.delete(req.id)
      count++
    } catch (e) {
      if (!(e instanceof RequestError)) {
        if (retrying.get(req.id) !== e.message) {
          await log(`ERROR job request ${req.id} (${req.type}), will retry: ${e.message}`)
          // A studio request's error names its session and try, so the open studio
          // shows it instead of waiting on "Pricing..." (lib/studio.ts folds it).
          await emit({
            batchId: req.batchId ?? null, reqId: req.id, event: 'error', reason: e.message,
            ...(req.sessionId && { sessionId: req.sessionId }), ...(req.genId && { genId: req.genId }),
          })
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

/** Price reference-studio tries (worker/lib/studio.mjs), with this module's result log. */
export function priceStudioTries(state, { exclusive } = {}) {
  return priceStudio(state, { emit, cfg, exclusive })
}

// Batches being priced right now, so a pass and the watcher never price one twice.
const inFlight = new Set()
// The CLI problem each waiting batch was last told about: said once per batch, not
// once for the whole worker (which left every batch after the first with no reason).
const cliWarned = new Map()

/** A batch's events as they are now: read fresh, since the page and the other pass append too. */
async function batchNow(batchId) {
  return foldBatch(await readJsonl(P.jobRequestResults), batchId)
}

/**
 * Price every validated batch with `generate cost`, one job at a time, with
 * no lock held: a cost call takes seconds and a batch can have dozens. Only
 * the registry read for planning runs under `exclusive`.
 */
export async function priceBatches(state, { dry = false, exclusive = (fn) => fn() } = {}) {
  const processed = new Set(state.processedRequests ?? [])
  // Only this machine's batches: another machine's worker prices its own, with its own account.
  const submits = (await readJsonl(P.jobRequests)).filter((r) => r.type === 'batch.submit' && processed.has(r.id) && ownerOf(r) === 'mine')
  if (submits.length === 0) return 0
  const events = await readJsonl(P.jobRequestResults)
  let priced = 0

  for (const submit of submits) {
    if (!['validated', 'pricing'].includes(foldBatch(events, submit.batchId).status)) continue
    if (inFlight.has(submit.batchId)) continue
    inFlight.add(submit.batchId)
    try {
      // Read again now that this batch is ours: the other pass may have just priced it.
      const st = await batchNow(submit.batchId)
      if (st.status !== 'validated' && st.status !== 'pricing') continue
      const ready = await cliReady()
      if (!ready.ok) {
        if (cliWarned.get(submit.batchId) !== ready.reason) {
          await emit({ batchId: submit.batchId, reqId: submit.id, event: 'error', reason: `${ready.reason}; the batch is priced once that is fixed` })
          await log(`HOLD pricing ${submit.batchId}: ${ready.reason}`)
          cliWarned.set(submit.batchId, ready.reason)
        }
        continue
      }
      cliWarned.delete(submit.batchId)
      const okKeys = new Set((st.validated?.jobs ?? []).filter((j) => j.ok).map((j) => j.key))
      const rows = await jobsOf(submit)
      const { ok } = await exclusive(async () => checkBatch(rows, { ...(await registries()), cfg, allowNew: true }))
      let total = 0
      let unpriced = 0
      for (const row of ok) {
        if (!okKeys.has(row.key)) continue
        let credits = st.prices[row.key]
        if (credits === undefined) {
          const job = makeJob(row, { jobId: 'price', enqueuedBy: 'price' })
          const plan = await exclusive(async () => { const { entities, assets } = await registries(); return planJob(job, entities, assets, { cfg, priceOnly: true }) })
          let reason = null
          if (plan.skip) { credits = null; reason = plan.skip } else {
            const cost = await estimateCost(plan.model, plan.params)
            credits = cost.credits
            reason = cost.error
          }
          await emit({ batchId: submit.batchId, event: 'price', key: row.key, credits, ...(credits == null && { reason }) })
          await log(`COST ${submit.batchId}/${row.key} ${row.model} = ${credits ?? `unknown (${reason})`}${credits != null ? ' credits' : ''}`)
        }
        if (credits == null) unpriced++
        else total += credits
      }
      // Discarded while its rows were being priced: it stays discarded.
      if (BATCH_FINAL.has((await batchNow(submit.batchId)).status)) continue
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
