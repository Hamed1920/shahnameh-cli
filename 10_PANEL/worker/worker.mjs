#!/usr/bin/env node
/**
 * Film Making for Dummies generation worker. One per project.
 *
 * Single writer for asset files and the CSV registries. Does six things:
 *   1. drains QUEUE.jsonl  -> higgsfield generate -> download to _staging
 *   2. acts on REVIEW_LOG.jsonl verdicts -> promote or reject
 *   3. builds revision jobs from denials, with approved learnings applied
 *   4. applies References-page requests from INDEX_OPS.jsonl, every few seconds
 *   5. validates, prices and (once approved) queues Prompts-page batches and
 *      Regenerate requests from JOB_REQUESTS.jsonl, every few seconds
 *   6. records everything in JOB_LEDGER.csv and queue/state.json
 *
 * Usage (the panel starts one per project with SHM_ROOT set; by hand, name the project):
 *   node worker/worker.mjs --project <slug>            watch loop
 *   node worker/worker.mjs --project <slug> --once     one pass, then exit
 *   node worker/worker.mjs --project <slug> --dry-run  plan and price only, generate nothing
 *
 * The panel can ask a running worker to stop by creating queue/worker.stop;
 * the worker finishes the job in hand, then exits and releases its lock.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GENERATE_LOCK, P, PROJECT, ROOT, appendJsonl, currentShotId, loadEntities, log, readCsv, readJsonl, rel,
  readState, resolveRef, shotFolder, spentWithin, stateStartProblem, writeCsv, writeState,
} from './lib/project.mjs'
import { acquireFileLock, releaseFileLock } from './lib/locks.mjs'
import { cliProblem, cliReady, estimateCost, extractJobId, extractResultUrls, hfJson, paramsToArgs } from './lib/hf.mjs'
import { FilingError, checkUploads, fileUpload, promote, reject } from './lib/promote.mjs'
import { runIndexOps } from './lib/index-ops.mjs'
import { planJob } from './lib/plan.mjs'
import { isVideoModel, stageResolution } from './lib/batch.mjs'
import { soundOf } from './lib/model-schema.mjs'
import { ensureFreshCatalog } from './lib/models.mjs'
import { configure as configureRequests, priceBatches, priceStudioTries, runJobRequests } from './lib/job-requests.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const ONCE = argv.includes('--once')
const DRY = argv.includes('--dry-run')

const cfg = JSON.parse(await fs.readFile(path.join(HERE, 'config.json'), 'utf8'))
configureRequests(cfg)

const LEDGER_HEADER = [
  'job_id', 'content_hash', 'author', 'type', 'target', 'resolved_target', 'variant',
  'engine', 'state', 'ingested', 'source_file', 'parent_job_id', 'hf_job_id', 'attempt', 'cost',
]

// ---------------------------------------------------------------- helpers

/** This project's worker lock. The panel reads the pid in it to show the worker as running. */
const acquireLock = () => acquireFileLock(P.lock, {
  onReclaim: (held) => log(`reclaiming stale lock from pid ${held || 'unknown'}`),
})
const releaseLock = () => releaseFileLock(P.lock)

/** The panel asked this worker to stop. Checked between jobs, never mid-generation. */
async function stopRequested() {
  try { await fs.access(P.stopFlag); return true } catch { return false }
}
async function stopNow(where) {
  // Never between the file moves and the registry write of an index change
  // (lib/tx.mjs): wait for whatever holds the registry lock to finish.
  await exclusive(async () => {})
  await log(`worker stopping: panel request (${where})`)
  if (state) await writeState(state)
  await releaseGenerateLock()
  await releaseLock()
  process.exit(0)
}

/**
 * The project was deleted under this worker. Stop without writing anything:
 * state or a log line would recreate files in a folder being removed, and the
 * open handles are what make Windows refuse to delete it, leaving a husk that
 * blocks a new project of the same name.
 */
async function projectGone() {
  try { await fs.access(path.join(ROOT, 'project.json')); return false } catch { return true }
}
async function exitGone() {
  console.error(`project.json is gone from ${ROOT}; worker exiting`)
  await releaseGenerateLock()
  await releaseLock()
  process.exit(0)
}

async function ledgerAppend(entry) {
  const { header, rows } = await readCsv(P.ledger)
  const h = header.length ? [...new Set([...header, ...LEDGER_HEADER])] : LEDGER_HEADER
  rows.push(entry)
  await writeCsv(P.ledger, rows, h)
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(dest, buf)
  return buf.length
}

function extFromUrl(url, fallback = '.png') {
  const m = String(url).split('?')[0].match(/\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i)
  return m ? m[0].toLowerCase() : fallback
}

const ledgerType = (model) => (isVideoModel(model) ? 'generate.video' : 'generate.image')

/** "25m", "90s", "1h" -> milliseconds; null when unreadable. */
function durationMs(text) {
  const m = String(text ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i)
  if (!m) return null
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[(m[2] ?? 's').toLowerCase()]
  return Number(m[1]) * unit
}

/**
 * How long the worker lets `generate create --wait` run before killing it. Longer
 * than the CLI's own --wait-timeout, so the CLI reports its timeout (with the job id)
 * rather than being killed first and leaving a job that may still be charged unrecorded.
 */
const GENERATE_KILL_MS = (durationMs(cfg.waitTimeout) ?? 25 * 60_000) + 5 * 60_000

/**
 * Why a job ended without a take, kept in state.failedJobs so the Queue page, the
 * prompt library and the studio can say so instead of just "failed".
 */
function recordFailure(state, jobId, reason) {
  state.failedJobs = { ...(state.failedJobs ?? {}), [jobId]: { reason, at: new Date().toISOString() } }
}

// ---------------------------------------------------------------- generate

// Accumulated across a dry run so we can report one total before any spend.
const dryTotal = { jobs: 0, credits: 0, unpriced: 0 }

const COST_WINDOW_HOURS = Number(cfg.costWindowHours ?? 24)
// A held job is looked at again after this long, not every pass: each look
// plans and prices it, and the loop runs every few seconds.
const HOLD_RECHECK_MS = 60_000
const heldUntil = new Map()

/**
 * Record why a job is not generating, in state.held, so the panel can say so
 * instead of showing it as simply queued. Logged once per reason, not per pass.
 */
async function hold(state, jobId, reason, credits = null) {
  heldUntil.set(jobId, Date.now() + HOLD_RECHECK_MS)
  const prev = state.held?.[jobId]
  if (prev?.reason === reason) return
  state.held = { ...(state.held ?? {}), [jobId]: { reason, credits, since: prev?.since ?? new Date().toISOString() } }
  await log(`HOLD ${jobId}: ${reason}`)
  await writeState(state)
}

function unhold(state, jobId) {
  heldUntil.delete(jobId)
  if (!state.held?.[jobId]) return
  const { [jobId]: _, ...rest } = state.held
  state.held = rest
}

/**
 * The machine-wide generation lock (GENERATE_LOCK in project.mjs), held by this
 * worker from the spend ceiling check until the ledger records the spend, so two
 * projects' workers can never both spend the same remaining room. Taken per job
 * and released between jobs, so the other projects get their turn.
 */
let holdingGenerateLock = false
let waitingForGenerateLock = false
async function releaseGenerateLock() {
  if (!holdingGenerateLock) return
  holdingGenerateLock = false
  await releaseFileLock(GENERATE_LOCK)
}

async function runQueue(state) {
  try { return await drainQueue(state) } finally { await releaseGenerateLock() }
}

async function drainQueue(state) {
  const queue = await readJsonl(P.queue)
  const done = new Set(state.processedJobs)
  // Holds for jobs that are no longer pending (processed, or gone) are stale.
  for (const id of Object.keys(state.held ?? {})) if (done.has(id) || !queue.some((q) => q.jobId === id)) unhold(state, id)
  // Reference-studio tries go first: Hamed is waiting on them in an open dialog.
  // They pass the same price, lock and ceiling checks as everything else.
  // Held jobs waiting out their recheck are left out BEFORE the per-run cap, so a
  // run of held jobs (over the per-job ceiling, say) never starves the ones behind.
  const waiting = queue.filter((q) => !done.has(q.jobId) && (DRY || (heldUntil.get(q.jobId) ?? 0) <= Date.now()))
  const pending = [...waiting.filter((q) => q.priority), ...waiting.filter((q) => !q.priority)].slice(0, cfg.maxJobsPerRun)
  if (pending.length === 0) return 0

  if (!DRY) {
    const ready = await cliReady()
    if (!ready.ok) {
      for (const job of pending) await hold(state, job.jobId, ready.reason)
      return 0
    }
  }

  let count = 0

  for (const job of pending) {
    await releaseGenerateLock()
    if (await stopRequested()) await stopNow('before ' + job.jobId)
    if (!DRY && (heldUntil.get(job.jobId) ?? 0) > Date.now()) continue

    // Read the registries per job, under the registry lock: index requests are
    // applied while earlier jobs generate, so a copy from the start of the run
    // can be minutes out of date.
    const plan = await exclusive(async () => {
      const [entities, { rows: assets }] = await Promise.all([loadEntities(), readCsv(P.manifest)])
      return planJob(job, entities, assets, { cfg, dry: DRY })
    })
    if (plan.skip) {
      await log(`SKIP ${job.jobId}: ${plan.skip}`)
      state.processedJobs.push(job.jobId)
      continue
    }
    const { shot, entity, targetId, refPaths, prompt, model, params, entry } = plan
    // Sound as the model took it (generate_audio, or Kling's sound on|off); undefined for images.
    const sound = isVideoModel(model) ? soundOf(entry, params) : undefined

    const { credits, error: priceError } = await estimateCost(model, params)
    await log(`COST ${job.jobId} ${model} = ${credits ?? `unknown (${priceError})`}${credits != null ? ' credits' : ''}`)

    // Never spend without a price: an unpriced job would pass both ceilings unchecked.
    if (credits == null && !DRY) {
      await hold(state, job.jobId, `could not be priced, so it will not generate: ${priceError}`)
      continue
    }
    if (credits != null && credits > cfg.perJobCostCeilingCredits) {
      await hold(state, job.jobId, `${credits} credits is more than perJobCostCeilingCredits ${cfg.perJobCostCeilingCredits}`, credits)
      continue
    }
    // Busy means another project is generating right now: stop here and try
    // again next pass. Decisions and index requests carry on meanwhile.
    if (!DRY) {
      if (!(await acquireFileLock(GENERATE_LOCK, { note: PROJECT.slug }))) {
        if (!waitingForGenerateLock) await log(`WAIT another project is generating (lock ${GENERATE_LOCK}); ${job.jobId} goes next`)
        waitingForGenerateLock = true
        break
      }
      holdingGenerateLock = true
      waitingForGenerateLock = false
    }
    const recent = await spentWithin(COST_WINDOW_HOURS)
    if (credits != null && recent + credits > cfg.costCeilingCredits) {
      await hold(state, job.jobId, `${credits} credits would pass costCeilingCredits ${cfg.costCeilingCredits} for the last ${COST_WINDOW_HOURS} h (${recent} spent across all projects); it runs once older spend leaves the window`, credits)
      continue
    }
    unhold(state, job.jobId)

    if (DRY) {
      dryTotal.jobs++
      if (credits != null) dryTotal.credits += credits
      else dryTotal.unpriced++
      await log(`DRY-RUN would generate ${job.jobId} -> ${targetId} ${job.variant} (${model}) refs=${refPaths.length}${sound !== undefined ? ` sound=${sound}` : ''}`)
      continue
    }

    const args = [
      'generate', 'create', model,
      ...paramsToArgs(params),
      '--wait', '--wait-timeout', cfg.waitTimeout, '--wait-interval', cfg.waitInterval,
    ]
    await log(`GENERATE ${job.jobId} ${targetId} ${job.variant} model=${model}${sound !== undefined ? ` sound=${sound}` : ''}`)
    // What the panel shows as "generating", and what its live refresh watches
    // instead of the whole log. The job's end moves state.json, so no clear-up.
    await fs.writeFile(P.workerNow, JSON.stringify({ jobId: job.jobId, since: new Date().toISOString() })).catch(() => {})
    const res = await hfJson(args, { timeoutMs: GENERATE_KILL_MS })

    // One ledger row per job that reached Higgsfield, whatever came of it: the
    // spend ceiling reads the ledger, and a charge missing from it is room that
    // is not really there (lib/spend.mjs says which states count).
    const ledgerRow = (ledgerState, hfJobId) => ledgerAppend({
      job_id: job.jobId, content_hash: '', author: job.enqueuedBy, type: ledgerType(model),
      target: job.target ?? '', resolved_target: targetId, variant: job.variant ?? '', engine: 'higgsfield',
      state: ledgerState, ingested: new Date().toISOString(), source_file: 'queue',
      parent_job_id: job.parentJobId ?? '', hf_job_id: hfJobId ?? '', attempt: String(job.attempt ?? 1),
      cost: String(credits ?? ''),
    })

    if (res.code !== 0) {
      const timedOut = /\[worker\] timed out|timed out waiting|wait(?:ing)? timeout (?:reached|exceeded)|deadline exceeded/i.test(res.stderr)
      const reason = timedOut
        ? `Higgsfield did not finish within ${cfg.waitTimeout}; it may still complete and be charged`
        : cliProblem(res.stderr || res.stdout)
      await log(`FAIL ${job.jobId}: exit ${res.code} ${res.stderr.trim().slice(0, 400)}`)
      await ledgerRow(timedOut ? 'TIMED_OUT' : 'FAILED', extractJobId(res.json))
      recordFailure(state, job.jobId, reason)
      state.processedJobs.push(job.jobId)
      await writeState(state)
      continue
    }

    const hfJobId = extractJobId(res.json) ?? `local_${Date.now().toString(36)}`
    const urls = extractResultUrls(res.json)
    if (urls.length === 0) {
      // Do not guess. Keep the raw response so the schema can be pinned down.
      const dir = path.join(P.staging, hfJobId)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'raw-response.json'),
        JSON.stringify(res.json ?? res.stdout, null, 2))
      const status = [res.json].flat().map((j) => j?.status).filter(Boolean).join(', ')
      await log(`WARN ${job.jobId}: no result URLs found${status ? ` (status ${status})` : ''}. Raw response saved to ${dir}/raw-response.json`)
      await ledgerRow('NO_RESULT', hfJobId)
      recordFailure(state, job.jobId, `Higgsfield returned no file${status ? ` (status: ${status})` : ''}`)
      state.processedJobs.push(job.jobId)
      await writeState(state)
      continue
    }

    const dir = path.join(P.staging, hfJobId)
    await fs.mkdir(dir, { recursive: true })
    const candidates = []
    for (let i = 0; i < urls.length; i++) {
      const take = 'T' + String(i + 1).padStart(2, '0')
      const file = `${take}${extFromUrl(urls[i])}`
      try {
        const bytes = await download(urls[i], path.join(dir, file))
        candidates.push({ file, take, resultUrl: urls[i] })
        await log(`DOWNLOADED ${hfJobId}/${file} (${bytes} bytes)`)
      } catch (e) {
        await log(`WARN download failed for ${urls[i]}: ${e.message}`)
      }
    }

    // The sidecar keeps the normalised params (a real boolean for sound), so a
    // revision or final inherits what was actually sent.
    const sentParams = { ...(job.params ?? {}) }
    // Kept as generate_audio whatever the model calls it: that is the job's intent, which planJob maps.
    if (sound !== undefined) sentParams.generate_audio = sound
    else delete sentParams.generate_audio

    await fs.writeFile(path.join(dir, 'job.json'), JSON.stringify({
      jobId: job.jobId,
      parentJobId: job.parentJobId ?? null,
      hfJobId,
      attempt: job.attempt ?? 1,
      stage: job.stage ?? null,
      label: job.label ?? null,
      target: targetId,
      isShot: Boolean(shot),
      outputFolder: shot ? await shotFolder(shot) : entity?.folder ?? null,
      variant: job.variant || entity?.canonical_variant || 'V01',
      // A reference-studio try: decided in the studio, not on the Review page.
      ...(job.studio && { studio: job.studio }),
      model,
      prompt,
      // The un-augmented prompt and the notes so far. Revisions rebuild from
      // these; without them attempt 3 stacks a second revision block on the first.
      basePrompt: job.basePrompt ?? job.prompt,
      revisionNotes: job.revisionNotes ?? [],
      params: sentParams,
      refs: job.refs ?? [],
      createdAt: new Date().toISOString(),
      costCredits: credits ?? null,
      candidates,
      rawResponse: res.json ?? null,
    }, null, 2))

    await ledgerAppend({
      job_id: job.jobId, content_hash: '', author: job.enqueuedBy, type: ledgerType(model),
      target: job.target ?? '', resolved_target: targetId, variant: job.variant ?? '', engine: 'higgsfield',
      state: 'GENERATED', ingested: new Date().toISOString(), source_file: 'queue',
      parent_job_id: job.parentJobId ?? '', hf_job_id: hfJobId,
      attempt: String(job.attempt ?? 1), cost: String(credits ?? ''),
    })

    if (credits != null) state.spentCredits += credits
    state.processedJobs.push(job.jobId)
    // Persist after EVERY job. A kill between jobs would otherwise lose the
    // record of work already paid for, and the next run would buy it again.
    await writeState(state)
    count++
  }
  return count
}

// ---------------------------------------------------------------- verdicts

async function runDecisions(state) {
  const decisions = await readJsonl(P.reviewLog)
  const seen = new Set(state.processedDecisions)
  const fresh = decisions.filter((d) => !seen.has(d.id))
  if (fresh.length === 0) return 0

  const entities = await loadEntities()
  let count = 0

  for (const d of fresh) {
    try {
      const batchDir = path.join(ROOT, path.dirname(d.candidate))
      let sidecar = null
      try {
        sidecar = JSON.parse(await fs.readFile(path.join(batchDir, 'job.json'), 'utf8'))
      } catch { /* candidate may predate sidecars */ }

      const uploads = Array.isArray(d.uploads) ? d.uploads : []

      if (DRY) {
        if (uploads.length) {
          try {
            for (const line of await checkUploads(uploads)) await log(`DRY-RUN would file ${line}`)
          } catch (e) {
            if (!(e instanceof FilingError)) throw e
            await log(`DRY-RUN filing would FAIL for ${d.id}: ${e.message}`)
          }
        }
        if (Array.isArray(d.refs)) await log(`DRY-RUN refs for ${d.id}: ${d.refs.join(', ') || '(none)'}`)
        await log(`DRY-RUN would ${d.verdict} ${d.candidate}`)
        continue
      }

      // Uploads are filed, and the new reference list proven resolvable, BEFORE
      // the candidate is moved or anything is queued. A decision either applies
      // whole or not at all -- never a half-applied change that then spends.
      let refs = sidecar?.refs ?? []
      let uploadTokens = {}
      try {
        const tokens = await fileDecisionUploads(d, uploads)
        uploadTokens = tokens
        if (Array.isArray(d.refs)) {
          refs = await resolveDecisionRefs(d.refs, tokens)
          await log(`REFS ${d.id}: [${(sidecar?.refs ?? []).join(', ')}] -> [${refs.join(', ')}]`)
        }
      } catch (e) {
        if (!(e instanceof FilingError)) throw e
        await appendJsonl(P.filings, { decisionId: d.id, ok: false, reason: e.message, ts: new Date().toISOString() })
        await log(`FAILED decision ${d.id}: ${e.message}. Candidate returned to review.`)
        state.failedDecisions = { ...(state.failedDecisions ?? {}), [d.id]: e.message }
        state.processedDecisions.push(d.id)
        count++
        continue
      }

      if (d.verdict === 'accepted') {
        // Approving a cheap draft does not promote it — it buys the expensive
        // final. Only a final render becomes the entity's asset.
        if (sidecar?.stage === 'draft') {
          await archiveDraft(d)
          await enqueueFinal(d, sidecar, refs)
        } else {
          await promote(d, sidecar)
        }
      } else {
        await reject(d)
        if (d.requeue) await enqueueRevision(d, sidecar, entities, refs, uploadTokens)
      }
      state.processedDecisions.push(d.id)
      count++
    } catch (e) {
      await log(`ERROR handling decision ${d.id}: ${e.message}`)
      // Leave it unprocessed so it is retried next pass rather than silently lost.
    }
  }
  return count
}

/**
 * File every upload on a decision. Already-filed uploads (a retry after a crash)
 * reuse their recorded token instead of being filed twice.
 * Returns { uploadId: '@KIND-NNN/Vnn' }.
 */
async function fileDecisionUploads(decision, uploads) {
  const tokens = {}
  if (uploads.length === 0) return tokens

  for (const f of await readJsonl(P.filings)) {
    if (f.decisionId === decision.id && f.ok && f.uploadId) tokens[f.uploadId] = f.token
  }
  await checkUploads(uploads, new Set(Object.keys(tokens)))

  for (const u of uploads) {
    if (tokens[u.id]) continue
    const filed = await fileUpload(u, decision)
    tokens[u.id] = filed.token
    await appendJsonl(P.filings, {
      decisionId: decision.id, uploadId: u.id, ok: true, token: filed.token,
      entity: filed.entity, filename: filed.filename, ts: new Date().toISOString(),
    })
  }
  // Every file has moved into the index; drop the emptied working folder.
  await fs.rmdir(path.join(P.uploads, decision.id)).catch(() => {})
  return tokens
}

/** Swap upload placeholders for real tokens and prove every token resolves to a file. */
async function resolveDecisionRefs(list, tokens) {
  const [entities, { rows: assets }] = await Promise.all([loadEntities(), readCsv(P.manifest)])
  const out = []
  for (const raw of list) {
    const token = String(raw).startsWith('upload:') ? tokens[String(raw).slice(7)] : String(raw)
    if (!token) throw new FilingError(`reference ${raw} points at an upload that was not filed`)
    const r = await resolveRef(token, entities, assets)
    if (!r.ok) throw new FilingError(`reference ${token}: ${r.reason}`)
    if (!out.includes(token)) out.push(token)
  }
  return out
}

/** Keep the approved draft as a record; it is not the deliverable. */
async function archiveDraft(decision) {
  const src = path.join(ROOT, decision.candidate)
  const dir = path.join(P.drafts, decision.hfJobId)
  await fs.mkdir(dir, { recursive: true })
  const dest = path.join(dir, path.basename(src))
  try {
    await fs.copyFile(src, dest)
    await fs.rm(src, { force: true })
  } catch (e) { if (e.code !== 'ENOENT') throw e }
  await log(`DRAFT APPROVED ${decision.candidate} -> ${rel(dest)}`)
}

/**
 * The parameters a decision's follow-up job carries: the sidecar's, with the
 * reviewer's Sound choice on top when the model makes video. Absent a choice,
 * the sidecar value stands and planJob fills a missing one with the default (on).
 */
function paramsFor(decision, sidecar) {
  const params = { ...(sidecar.params ?? {}) }
  if (isVideoModel(sidecar.model) && typeof decision.sound === 'boolean') params.generate_audio = decision.sound
  return params
}

/**
 * Re-run an approved draft at final resolution. Same prompt, same references,
 * same variant — the only thing that changes is quality, so the shot Hamed
 * approved is the shot he gets.
 */
async function enqueueFinal(decision, sidecar, refs) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const jobId = `J-${stamp}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
  const finalRes = stageResolution(sidecar.model, 'final', cfg)
  const params = { ...paramsFor(decision, sidecar), ...(finalRes && { resolution: finalRes }) }

  await appendJsonl(P.queue, {
    jobId,
    parentJobId: sidecar.jobId,
    attempt: sidecar.attempt ?? 1,
    stage: 'final',
    target: await currentShotId(sidecar.target),
    variant: sidecar.variant,
    model: sidecar.model,
    prompt: sidecar.basePrompt ?? sidecar.prompt,
    basePrompt: sidecar.basePrompt ?? sidecar.prompt,
    params,
    refs: refs ?? sidecar.refs ?? [],
    revisionNotes: sidecar.revisionNotes ?? [],
    label: sidecar.label ?? null,
    enqueuedAt: new Date().toISOString(),
    enqueuedBy: 'worker:final',
  })
  await log(`FINAL QUEUED ${sidecar.jobId} -> ${jobId} at ${finalRes ?? 'its own resolution'}${'generate_audio' in params ? ` sound=${params.generate_audio}` : ''}`)
}

async function enqueueRevision(decision, sidecar, entities, refs, uploadTokens = {}) {
  if (!sidecar) { await log(`SKIP revision for ${decision.id}: no sidecar`); return }

  const attempt = (sidecar.attempt ?? 1) + 1
  if (attempt > cfg.maxAttempts) {
    await log(`STOP ${sidecar.jobId}: attempt ${attempt} exceeds maxAttempts ${cfg.maxAttempts}. Needs a human rethink.`)
    return
  }

  // Carry every prior note forward so attempt 3 does not reintroduce the fault
  // that attempt 2 was told to fix.
  const priorNotes = (sidecar.revisionNotes ?? [])
  // The reviewer may write in Farsi; an English version, when given, is what the model reads.
  // An "@upload:u1" mention becomes the token that upload was filed as.
  const note = String(decision.notesEn || decision.notes || '')
    .replace(/@upload:(u\d{1,3})(?![\w/-])/g, (m, id) => uploadTokens[id] ?? m)
  const revisionNotes = [...priorNotes, note].filter(Boolean)

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const jobId = `J-${stamp}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
  const params = paramsFor(decision, sidecar)

  await appendJsonl(P.queue, {
    jobId,
    parentJobId: sidecar.jobId,
    attempt,
    // A rejected draft re-rolls as a draft. Never escalate cost on a failure.
    stage: sidecar.stage ?? null,
    target: await currentShotId(sidecar.target),
    variant: sidecar.variant,
    model: sidecar.model,
    prompt: sidecar.basePrompt ?? sidecar.prompt,
    basePrompt: sidecar.basePrompt ?? sidecar.prompt,
    params,
    refs: refs ?? sidecar.refs ?? [],
    revisionNotes,
    label: sidecar.label ?? null,
    enqueuedAt: new Date().toISOString(),
    enqueuedBy: 'worker:revision',
  })
  await log(`REQUEUED ${sidecar.jobId} -> ${jobId} (attempt ${attempt})${'generate_audio' in params ? ` sound=${params.generate_audio}` : ''} reason: ${note}`)
}

// ---------------------------------------------------------------- main

/**
 * The worker's state, shared by the passes and the watchers. Read once at
 * start: only the worker writes state.json, and the in-use checks must see a
 * job that is generating right now as still pending.
 */
let state

// In-process registry lock. A generation waits minutes on the CLI, and the
// References page should not wait with it, so index requests are applied
// during generations. Anything that reads the registries and then writes them
// (or relies on files staying put) holds this; the generation itself does not.
let lockTail = Promise.resolve()
async function exclusive(fn) {
  let release
  const mine = new Promise((r) => { release = r })
  const before = lockTail
  lockTail = lockTail.then(() => mine)
  await before
  try { return await fn() } finally { release() }
}

/** Apply requests from the References page. Returns how many were handled. */
async function applyIndexOps() {
  const n = await exclusive(() => runIndexOps(state, { dry: DRY }))
  if (n) await writeState(state)
  return n
}

/**
 * Prompts-page batches and Regenerate requests. Validation and approval are
 * quick and run under the lock; pricing spawns the CLI per job and runs
 * without it, so a long batch never stalls decisions or index requests.
 */
async function applyJobRequests() {
  const n = await exclusive(() => runJobRequests(state, { dry: DRY }))
  if (n) await writeState(state)
  await priceBatches(state, { dry: DRY, exclusive })
  await priceStudioTries(state, { exclusive })
  return n
}

/**
 * Between passes the loop sleeps only pollSeconds, but a pass that generates
 * can take many minutes. Check for panel requests every few seconds regardless.
 * Files used by a queued or generating job are safe: index-ops refuses to move them.
 */
const WATCH_EVERY_MS = 3000
function watch(name, fn) {
  const tick = async () => {
    try {
      await fn()
    } catch (e) {
      // A log that cannot be written (worker.log locked) must not end the watcher.
      try { await log(`${name} ERROR: ${e.stack ?? e.message}`) } catch { /* nothing more to do */ }
    } finally {
      setTimeout(tick, WATCH_EVERY_MS)
    }
  }
  setTimeout(tick, WATCH_EVERY_MS)
}

async function pass() {
  const generated = await runQueue(state)
  const decided = await exclusive(() => runDecisions(state))
  await writeState(state)
  const managed = await applyIndexOps()
  const requested = await applyJobRequests()

  // One total, so the spend can be reported and approved before anything runs.
  if (DRY && dryTotal.jobs > 0) {
    await log(
      `DRY-RUN TOTAL: ${dryTotal.jobs} job(s), ${dryTotal.credits} credits`
      + (dryTotal.unpriced ? ` (+${dryTotal.unpriced} could not be priced)` : '')
      + ` | ceilings: ${cfg.perJobCostCeilingCredits}/job, ${cfg.costCeilingCredits} per ${COST_WINDOW_HOURS} h`,
    )
  }
  return generated + decided + managed + requested
}

async function main() {
  // A sandbox points SHM_HIGGSFIELD_JS at the stub CLI. If that path is wrong,
  // quietly finding the real CLI instead would spend real credits on test data.
  const stub = process.env.SHM_HIGGSFIELD_JS
  if (stub && !(await fs.access(stub).then(() => true, () => false))) {
    console.error(`SHM_HIGGSFIELD_JS is set to ${stub}, which does not exist. Refusing to start rather than fall back to the real Higgsfield CLI.`)
    process.exit(1)
  }
  const replay = await stateStartProblem()
  if (replay) {
    console.error(`Refusing to start ${PROJECT.slug}: ${replay}`)
    process.exit(1)
  }
  if (!(await acquireLock())) {
    console.error(`A worker is already running (lock: ${P.lock}). Delete it if that is stale.`)
    process.exit(1)
  }
  const cleanup = async () => { await releaseGenerateLock(); await releaseLock(); process.exit(0) }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  try {
    // A stop flag left by a crash must not stop this worker before it starts.
    await fs.rm(P.stopFlag, { force: true })
    // Nothing is in flight in a worker that has only just started.
    await fs.rm(P.workerNow, { force: true })
    await log(`worker started (project=${PROJECT.slug} code=${PROJECT.code} once=${ONCE} dryRun=${DRY} root=${ROOT})`)
    state = await readState()
    // The model list, once a day. A failure keeps the old list; it never stops the worker.
    const cat = await ensureFreshCatalog({ log })
    if (!cat.ok) await log(`MODELS not refreshed: ${cat.error}`)

    if (ONCE) { await pass(); return }
    if (!DRY) {
      watch('INDEX OPS', applyIndexOps)
      watch('JOB REQUESTS', applyJobRequests)
    }
    for (;;) {
      if (await projectGone()) await exitGone()
      try { await pass() } catch (e) { await log(`PASS ERROR: ${e.stack ?? e.message}`).catch(() => {}) }
      if (await stopRequested()) await stopNow('idle')
      await new Promise((r) => setTimeout(r, cfg.pollSeconds * 1000))
    }
  } finally {
    await releaseLock()
  }
}

main().catch(async (e) => {
  await log(`FATAL: ${e.stack ?? e.message}`)
  await releaseGenerateLock()
  await releaseLock()
  process.exit(1)
})
