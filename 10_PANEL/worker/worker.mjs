#!/usr/bin/env node
/**
 * Shahnameh generation worker.
 *
 * Single writer for asset files and the CSV registries. Does four things:
 *   1. drains QUEUE.jsonl  -> higgsfield generate -> download to _staging
 *   2. acts on REVIEW_LOG.jsonl verdicts -> promote or reject
 *   3. builds revision jobs from denials, with approved learnings applied
 *   4. records everything in JOB_LEDGER.csv and queue/state.json
 *
 * Usage:
 *   node worker/worker.mjs            watch loop
 *   node worker/worker.mjs --once     one pass, then exit
 *   node worker/worker.mjs --dry-run  plan and price only, generate nothing
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  P, ROOT, appendJsonl, findEntity, isShotId, loadEntities, log, readCsv, readJsonl,
  readState, resolveRef, shotFolder, writeCsv, writeState,
} from './lib/project.mjs'
import { estimateCost, extractJobId, extractResultUrls, hfJson, isAuthenticated, paramsToArgs } from './lib/hf.mjs'
import { promote, reject } from './lib/promote.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const ONCE = argv.includes('--once')
const DRY = argv.includes('--dry-run')

const cfg = JSON.parse(await fs.readFile(path.join(HERE, 'config.json'), 'utf8'))

const LEDGER_HEADER = [
  'job_id', 'content_hash', 'author', 'type', 'target', 'resolved_target', 'variant',
  'engine', 'state', 'ingested', 'source_file', 'parent_job_id', 'hf_job_id', 'attempt', 'cost',
]

// ---------------------------------------------------------------- helpers

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/**
 * Lock, with stale reclaim. A killed worker leaves its lock behind; without the
 * liveness check that permanently blocks every future run and the only fix is
 * deleting a file by hand.
 */
async function acquireLock() {
  await fs.mkdir(path.dirname(P.lock), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fs.open(P.lock, 'wx')
      await fh.write(String(process.pid))
      await fh.close()
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const held = parseInt((await fs.readFile(P.lock, 'utf8').catch(() => '')).trim(), 10)
      if (pidAlive(held)) return false
      await log(`reclaiming stale lock from pid ${held || 'unknown'}`)
      await fs.rm(P.lock, { force: true })
    }
  }
  return false
}
async function releaseLock() { await fs.rm(P.lock, { force: true }) }

async function ledgerAppend(entry) {
  const { header, rows } = await readCsv(P.ledger)
  const h = header.length ? [...new Set([...header, ...LEDGER_HEADER])] : LEDGER_HEADER
  rows.push(entry)
  await writeCsv(P.ledger, rows, h)
}

/** Approved learnings whose scope matches this target. Nothing else is ever injected. */
async function applicableLearnings(entity) {
  const all = await readJsonl(P.learnings)
  const latest = new Map()
  for (const l of all) latest.set(l.id, l)
  return [...latest.values()]
    .filter((l) => l.status === 'approved')
    .filter((l) => {
      const s = l.scope ?? {}
      if (!entity) return !s.entity && !s.family && !s.kind
      if (s.entity) return entity && s.entity === entity.id
      if (s.family) return entity && entity.family === s.family
      if (s.kind) return entity && entity.kind === s.kind
      return true
    })
    .map((l) => l.rule)
}

function buildPrompt(base, learnings, revisionNotes) {
  const parts = [base.trim()]
  if (revisionNotes?.length) {
    parts.push('', 'Revision — the previous attempt was rejected for these reasons. Fix them:')
    for (const n of revisionNotes) parts.push(`- ${n}`)
  }
  if (learnings.length) {
    parts.push('', 'Established requirements for this subject:')
    for (const l of learnings) parts.push(`- ${l}`)
  }
  return parts.join('\n')
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

// ---------------------------------------------------------------- generate

// Accumulated across a dry run so we can report one total before any spend.
const dryTotal = { jobs: 0, credits: 0, unpriced: 0 }

async function runQueue(state) {
  const queue = await readJsonl(P.queue)
  const done = new Set(state.processedJobs)
  const pending = queue.filter((q) => !done.has(q.jobId)).slice(0, cfg.maxJobsPerRun)
  if (pending.length === 0) return 0

  if (!DRY && !(await isAuthenticated())) {
    await log(`HOLD ${pending.length} queued job(s): not authenticated. Run: higgsfield auth login`)
    return 0
  }

  const [entities, { rows: assets }] = await Promise.all([loadEntities(), readCsv(P.manifest)])
  let count = 0

  for (const job of pending) {
    // A shot target is valid but is not an entity; it renders into the episode.
    const shot = isShotId(job.target) ? job.target : null
    const entity = shot ? null : findEntity(entities, job.target)
    if (!shot && !entity) {
      await log(`SKIP ${job.jobId}: unknown target ${job.target}`)
      state.processedJobs.push(job.jobId)
      continue
    }
    const targetId = shot ?? entity.id

    // Resolve reference tokens to real paths before spending anything.
    const refPaths = []
    let refFailure = null
    for (const token of job.refs ?? []) {
      const r = await resolveRef(token, entities, assets)
      if (!r.ok) { refFailure = `${token}: ${r.reason}`; break }
      refPaths.push(r.path)
    }
    if (refFailure) {
      await log(`SKIP ${job.jobId}: unresolved ref ${refFailure}`)
      state.processedJobs.push(job.jobId)
      continue
    }

    const learnings = await applicableLearnings(entity)
    const prompt = buildPrompt(job.prompt, learnings, job.revisionNotes)
    const model = job.model || cfg.defaultImageModel
    const params = { prompt, ...(job.params ?? {}) }

    // Array -> repeated --image-references flags (see paramsToArgs).
    if (refPaths.length) params.image_references = refPaths

    // Seedance rejects reference media in the default t2v mode; supplying
    // references without switching mode fails the job after it is priced.
    if (refPaths.length && /^seedance/.test(model) && !params.mode) {
      params.mode = 'omni_reference'
    }

    const { credits } = await estimateCost(model, params)
    await log(`COST ${job.jobId} ${model} = ${credits ?? 'unknown'} credits`)

    if (credits != null && credits > cfg.perJobCostCeilingCredits) {
      await log(`HOLD ${job.jobId}: ${credits} credits exceeds perJobCostCeilingCredits ${cfg.perJobCostCeilingCredits}`)
      continue
    }
    if (credits != null && state.spentCredits + credits > cfg.costCeilingCredits) {
      await log(`HOLD ${job.jobId}: would exceed costCeilingCredits ${cfg.costCeilingCredits} (spent ${state.spentCredits})`)
      continue
    }

    if (DRY) {
      dryTotal.jobs++
      if (credits != null) dryTotal.credits += credits
      else dryTotal.unpriced++
      await log(`DRY-RUN would generate ${job.jobId} -> ${targetId} ${job.variant} (${model}) refs=${refPaths.length}`)
      continue
    }

    const args = [
      'generate', 'create', model,
      ...paramsToArgs(params),
      '--wait', '--wait-timeout', cfg.waitTimeout, '--wait-interval', cfg.waitInterval,
    ]
    await log(`GENERATE ${job.jobId} ${targetId} ${job.variant} model=${model}`)
    const res = await hfJson(args, { timeoutMs: 25 * 60_000 })

    if (res.code !== 0) {
      await log(`FAIL ${job.jobId}: exit ${res.code} ${res.stderr.trim().slice(0, 400)}`)
      await ledgerAppend({
        job_id: job.jobId, content_hash: '', author: job.enqueuedBy, type: 'generate.image',
        target: job.target, resolved_target: targetId, variant: job.variant, engine: 'higgsfield',
        state: 'FAILED', ingested: new Date().toISOString(), source_file: 'queue',
        parent_job_id: job.parentJobId ?? '', hf_job_id: '', attempt: String(job.attempt ?? 1),
        cost: String(credits ?? ''),
      })
      state.processedJobs.push(job.jobId)
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
      await log(`WARN ${job.jobId}: no result URLs found. Raw response saved to ${dir}/raw-response.json — update extractResultUrls() in worker/lib/hf.mjs`)
      state.processedJobs.push(job.jobId)
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

    await fs.writeFile(path.join(dir, 'job.json'), JSON.stringify({
      jobId: job.jobId,
      parentJobId: job.parentJobId ?? null,
      hfJobId,
      attempt: job.attempt ?? 1,
      stage: job.stage ?? null,
      label: job.label ?? null,
      target: targetId,
      isShot: Boolean(shot),
      outputFolder: shot ? await shotFolder(shot) : entity.folder,
      variant: job.variant || entity.canonical_variant || 'V01',
      model,
      prompt,
      params: job.params ?? {},
      refs: job.refs ?? [],
      createdAt: new Date().toISOString(),
      costCredits: credits ?? null,
      candidates,
      rawResponse: res.json ?? null,
    }, null, 2))

    await ledgerAppend({
      job_id: job.jobId, content_hash: '', author: job.enqueuedBy, type: 'generate.image',
      target: job.target, resolved_target: targetId, variant: job.variant, engine: 'higgsfield',
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

      if (DRY) {
        await log(`DRY-RUN would ${d.verdict} ${d.candidate}`)
        continue
      }
      if (d.verdict === 'accepted') {
        // Approving a cheap draft does not promote it — it buys the expensive
        // final. Only a final render becomes the entity's asset.
        if (sidecar?.stage === 'draft') {
          await archiveDraft(d)
          await enqueueFinal(d, sidecar)
        } else {
          await promote(d, sidecar)
        }
      } else {
        await reject(d)
        if (d.requeue) await enqueueRevision(d, sidecar, entities)
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
 * Re-run an approved draft at final resolution. Same prompt, same references,
 * same variant — the only thing that changes is quality, so the shot Hamed
 * approved is the shot he gets.
 */
async function enqueueFinal(decision, sidecar) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const jobId = `J-${stamp}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
  const params = { ...(sidecar.params ?? {}), resolution: cfg.videoFinalResolution }

  await appendJsonl(P.queue, {
    jobId,
    parentJobId: sidecar.jobId,
    attempt: sidecar.attempt ?? 1,
    stage: 'final',
    target: sidecar.target,
    variant: sidecar.variant,
    model: sidecar.model,
    prompt: sidecar.basePrompt ?? sidecar.prompt,
    basePrompt: sidecar.basePrompt ?? sidecar.prompt,
    params,
    refs: sidecar.refs ?? [],
    revisionNotes: sidecar.revisionNotes ?? [],
    label: sidecar.label ?? null,
    enqueuedAt: new Date().toISOString(),
    enqueuedBy: 'worker:final',
  })
  await log(`FINAL QUEUED ${sidecar.jobId} -> ${jobId} at ${cfg.videoFinalResolution}`)
}

async function enqueueRevision(decision, sidecar, entities) {
  if (!sidecar) { await log(`SKIP revision for ${decision.id}: no sidecar`); return }

  const attempt = (sidecar.attempt ?? 1) + 1
  if (attempt > cfg.maxAttempts) {
    await log(`STOP ${sidecar.jobId}: attempt ${attempt} exceeds maxAttempts ${cfg.maxAttempts}. Needs a human rethink.`)
    return
  }

  // Carry every prior note forward so attempt 3 does not reintroduce the fault
  // that attempt 2 was told to fix.
  const priorNotes = (sidecar.revisionNotes ?? [])
  const revisionNotes = [...priorNotes, decision.notes].filter(Boolean)

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const jobId = `J-${stamp}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`

  await appendJsonl(P.queue, {
    jobId,
    parentJobId: sidecar.jobId,
    attempt,
    // A rejected draft re-rolls as a draft. Never escalate cost on a failure.
    stage: sidecar.stage ?? null,
    target: sidecar.target,
    variant: sidecar.variant,
    model: sidecar.model,
    prompt: sidecar.basePrompt ?? sidecar.prompt,
    basePrompt: sidecar.basePrompt ?? sidecar.prompt,
    params: sidecar.params ?? {},
    refs: sidecar.refs ?? [],
    revisionNotes,
    enqueuedAt: new Date().toISOString(),
    enqueuedBy: 'worker:revision',
  })
  await log(`REQUEUED ${sidecar.jobId} -> ${jobId} (attempt ${attempt}) reason: ${decision.notes}`)
}

// ---------------------------------------------------------------- main

async function pass() {
  const state = await readState()
  const generated = await runQueue(state)
  const decided = await runDecisions(state)
  await writeState(state)

  // One total, so the spend can be reported and approved before anything runs.
  if (DRY && dryTotal.jobs > 0) {
    await log(
      `DRY-RUN TOTAL: ${dryTotal.jobs} job(s), ${dryTotal.credits} credits`
      + (dryTotal.unpriced ? ` (+${dryTotal.unpriced} could not be priced)` : '')
      + ` | ceilings: ${cfg.perJobCostCeilingCredits}/job, ${cfg.costCeilingCredits} total`,
    )
  }
  return generated + decided
}

async function main() {
  if (!(await acquireLock())) {
    console.error(`A worker is already running (lock: ${P.lock}). Delete it if that is stale.`)
    process.exit(1)
  }
  const cleanup = async () => { await releaseLock(); process.exit(0) }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  try {
    await log(`worker started (once=${ONCE} dryRun=${DRY} root=${ROOT})`)

    if (ONCE) { await pass(); return }
    for (;;) {
      try { await pass() } catch (e) { await log(`PASS ERROR: ${e.stack ?? e.message}`) }
      await new Promise((r) => setTimeout(r, cfg.pollSeconds * 1000))
    }
  } finally {
    await releaseLock()
  }
}

main().catch(async (e) => {
  await log(`FATAL: ${e.stack ?? e.message}`)
  await releaseLock()
  process.exit(1)
})
