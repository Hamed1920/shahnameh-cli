import fs from 'node:fs/promises'
import path from 'node:path'
import {
  P, STUDIO_SESSION_RX, appendJsonl, findEntity, loadEntities, log, readCsv, readJsonl, rel,
} from './project.mjs'
import { FOLDER_FOR, FilingError, entitySlug, fileUploadInto, reject } from './promote.mjs'
import { transaction } from './tx.mjs'
import { planJob } from './plan.mjs'
import { cliReady, estimateCost } from './hf.mjs'
import { newJobId } from './batch.mjs'
import { loadCatalog } from './models.mjs'
import { modelKind, modelProblem } from './model-schema.mjs'

/**
 * The reference studio: make a picture of a character, location or prop with
 * an image model, try again as often as it takes, and file the one you pick.
 *
 * Four requests, all appended by the panel to JOB_REQUESTS.jsonl:
 *   studio.price    what a try would cost. Free (`generate cost`); nothing queued.
 *   studio.approve  the priced Generate button, clicked: queues the try, ahead of batch work.
 *   studio.pick     file one result: a new look of the entity, or the new entity it is for.
 *   studio.close    the rest of the session's results go to _rejected.
 *
 * Spend control is the same as anywhere else: every try is priced before it
 * can be approved, the approve is refused if the price moved, and the queued
 * job passes the per-job and rolling ceilings and the machine-wide lock.
 *
 * A try for something not in the index yet carries a proposal, never a number.
 * The number is allocated at the pick (fileUploadInto -> nextEntityNumber), so
 * abandoning a session burns nothing.
 */

const GEN_RX = /^g[a-z0-9]{3,24}$/
const HF_RX = /^[A-Za-z0-9_-]{4,80}$/
const TAKE_RX = /^T\d{2}$/
const ROLES = ['HERO', 'TURNAROUND', 'PLATE', 'DETAIL', 'BOARD']
const ASCII = /^[\x20-\x7E]*$/
export const MAX_STUDIO_COUNT = 4

/** The handlers, given job-requests.mjs's own fail/emit/cfg so a refusal reads like any other. */
export function studioHandlers({ fail, emit, getCfg }) {
  const session = (req) => {
    const id = String(req.sessionId ?? '')
    if (!STUDIO_SESSION_RX.test(id)) fail('bad studio session id')
    return id
  }

  return {
    async 'studio.price'(req) {
      const sessionId = session(req)
      if (!GEN_RX.test(String(req.genId ?? ''))) fail('bad try id')
      const why = modelProblem(loadCatalog(), req.model)
      if (why) fail(why)
      if (modelKind(loadCatalog(), req.model) !== 'image') fail(`${req.model} does not make images`)
      if (!String(req.prompt ?? '').trim()) fail('the prompt is empty')
      const count = Number(req.count)
      if (!Number.isInteger(count) || count < 1 || count > MAX_STUDIO_COUNT) fail(`1 to ${MAX_STUDIO_COUNT} results per try`)
      await checkTarget(req, fail)
      await emit({ batchId: null, reqId: req.id, sessionId, genId: req.genId, event: 'studio.received' })
    },

    async 'studio.approve'(req, { dry }) {
      const sessionId = session(req)
      const reqs = await readJsonl(P.jobRequests)
      const priceReq = reqs.find((r) => r.type === 'studio.price' && r.sessionId === sessionId && r.genId === req.genId)
      if (!priceReq) fail('that try was never priced')
      const events = await readJsonl(P.jobRequestResults)
      const priced = events.find((e) => e.event === 'studio.priced' && e.reqId === priceReq.id)
      if (!priced) fail('that try is not priced yet')
      if (priced.total == null) fail('that try could not be priced, so it cannot run')
      if (req.expectedTotal != null && Math.abs(Number(priced.total) - Number(req.expectedTotal)) > 0.5) {
        fail(`the price is ${priced.total} credits now, not ${req.expectedTotal}; press Generate again`)
      }
      if (events.some((e) => e.event === 'studio.closed' && e.sessionId === sessionId)) fail('the session is closed')
      const queue = await readJsonl(P.queue)
      if (queue.some((q) => q.studio?.genId === req.genId)) return // an approve retried after a crash
      if (dry) { await log(`DRY-RUN would queue studio try ${req.genId} (${priced.total} credits)`); return }

      const entity = priceReq.target?.entity ? findEntity(await loadEntities(), priceReq.target.entity) : null
      const jobIds = []
      for (let i = 0; i < priceReq.count; i++) {
        const jobId = newJobId()
        jobIds.push(jobId)
        await appendJsonl(P.queue, {
          jobId,
          parentJobId: null,
          attempt: 1,
          stage: null,
          target: entity?.id ?? null,
          variant: null,
          model: priceReq.model,
          prompt: priceReq.prompt,
          basePrompt: priceReq.prompt,
          params: priceReq.params ?? {},
          refs: priceReq.refs ?? [],
          revisionNotes: [],
          label: `Studio · ${entity?.name ?? priceReq.proposal?.name ?? 'new reference'}`,
          studio: { sessionId, genId: req.genId, ...(priceReq.proposal && { proposal: priceReq.proposal }) },
          priority: true,
          enqueuedAt: new Date().toISOString(),
          enqueuedBy: 'panel:studio',
        })
      }
      await emit({ batchId: null, reqId: req.id, sessionId, genId: req.genId, event: 'studio.queued', jobIds, total: priced.total })
      await log(`STUDIO ${sessionId} try ${req.genId} queued: ${jobIds.join(', ')} (${priced.total} credits)`)
    },

    async 'studio.pick'(req, { dry }) {
      const sessionId = session(req)
      const hfJobId = String(req.hfJobId ?? '')
      const take = String(req.take ?? '')
      if (!HF_RX.test(hfJobId) || !TAKE_RX.test(take)) fail('bad result id')
      const filings = await readJsonl(P.filings)
      if (filings.some((f) => f.requestId === req.id && f.ok)) return // filed before a crash

      const dir = path.join(P.staging, hfJobId)
      const sidecar = JSON.parse(await fs.readFile(path.join(dir, 'job.json'), 'utf8').catch(() => 'null'))
      if (!sidecar || sidecar.studio?.sessionId !== sessionId) fail('that result is not part of this studio session')
      const file = (await fs.readdir(dir).catch(() => [])).find((n) => n.startsWith(`${take}.`))
      if (!file) fail('that result has already been filed or put away')

      const as = req.fileAs ?? {}
      const role = String(req.role || 'HERO')
      const descriptor = String(req.descriptor ?? '').trim()
      if (!ROLES.includes(role)) fail(`unknown role '${role}'`)
      if (!descriptor || !ASCII.test(descriptor)) fail('add a short English description; it becomes the filename')

      const entities = await loadEntities()
      // A second pick from the same try is another take of the look the first became (INDEXING.md:
      // N candidates from one prompt are N takes of one look), not a second look or a second new entity.
      const earlier = filings.find((f) => f.ok && f.studioGenId === sidecar.studio.genId && f.entity)
      let upload
      let takeOf = null
      if (as.mode === 'new') {
        if (!FOLDER_FOR[as.kind]) fail(`unknown kind '${as.kind}'`)
        if (!ASCII.test(String(as.name ?? '')) || !ASCII.test(String(as.description ?? ''))) fail('the name and description go into the registry, so they must be English')
        const slug = entitySlug(as.name)
        if (!slug) fail('name the new entity')
        if (earlier && findEntity(entities, earlier.entity)?.slug === slug) takeOf = { entity: earlier.entity, variant: earlier.variant }
        else if (entities.some((e) => e.slug === slug)) fail(`'${slug}' already exists; file it as a new look of that entity instead`)
        upload = { mode: 'new', kind: as.kind, name: String(as.name).trim(), description: String(as.description ?? '').trim() }
      } else {
        const ent = findEntity(entities, String(as.entity ?? ''))
        if (!ent) fail(`unknown entity '${as.entity}'`)
        if (ent.status === 'RETIRED') fail(`${ent.id} is RETIRED`)
        if (earlier?.entity === ent.id) takeOf = { entity: ent.id, variant: earlier.variant }
        upload = { mode: 'variant', entity: ent.id }
      }
      if (dry) { await log(`DRY-RUN would file studio result ${hfJobId}/${take}`); return }

      const src = path.join(dir, file)
      let filed
      try {
        filed = await transaction(async (tx) => ({
          summary: await fileUploadInto(tx, {
            id: `${hfJobId}/${take}`, file: rel(src), originalName: `${hfJobId}/${file}`, role, descriptor, ...upload,
          }, { id: req.id, reviewer: req.reviewer }, {
            source: 'higgsfield', allowStaging: true, takeOf,
            notes: `Made in the reference studio (${sidecar.model}, ${sessionId}) by ${req.reviewer}`,
          }),
        }))
      } catch (e) {
        if (e instanceof FilingError) fail(e.message)
        throw e
      }
      const variant = filed.token.replace(/^@/, '').split('/')[1]
      await appendJsonl(P.filings, {
        requestId: req.id, sessionId, studioGenId: sidecar.studio.genId, hfJobId, take, ok: true,
        token: filed.token, entity: filed.entity, variant, filename: filed.filename, ts: new Date().toISOString(),
      })
      await emit({ batchId: null, reqId: req.id, sessionId, event: 'studio.picked', hfJobId, take, token: filed.token, entity: filed.entity })
    },

    async 'studio.close'(req, { dry, state }) {
      const sessionId = session(req)
      const queue = await readJsonl(P.queue)
      // The worker's own state, not state.json: a failed or skipped try is only
      // written to disk at the end of a pass, and would read as still generating.
      const done = new Set(state?.processedJobs ?? [])
      const pending = queue.filter((q) => q.studio?.sessionId === sessionId && !done.has(q.jobId))
      if (pending.length) fail(`${pending.length} tr${pending.length === 1 ? 'y is' : 'ies are'} still generating; close once they finish`)
      if (dry) { await log(`DRY-RUN would close studio ${sessionId}`); return }

      let put = 0
      for (const name of await fs.readdir(P.staging).catch(() => [])) {
        const dir = path.join(P.staging, name)
        const sidecar = JSON.parse(await fs.readFile(path.join(dir, 'job.json'), 'utf8').catch(() => 'null'))
        if (sidecar?.studio?.sessionId !== sessionId) continue
        for (const f of await fs.readdir(dir)) {
          if (f === 'job.json') continue
          await reject({
            id: `studio-${sessionId}`, candidate: rel(path.join(dir, f)), hfJobId: name, jobId: sidecar.jobId,
            target: sidecar.target, verdict: 'denied', notes: 'not picked in the reference studio', model: sidecar.model,
            studio: sidecar.studio, reviewer: req.reviewer,
          })
          put++
        }
        // The sidecar goes with its results, so _rejected keeps the prompt that made them.
        await fs.mkdir(path.join(P.rejected, name), { recursive: true })
        await fs.rename(path.join(dir, 'job.json'), path.join(P.rejected, name, 'job.json')).catch(() => {})
        await fs.rmdir(dir).catch(() => {})
      }
      // Pictures dropped into the studio were inputs, never filed: kept beside the rejects, not in the index.
      const inputs = path.join(P.uploads, sessionId)
      if (await fs.stat(inputs).then(() => true, () => false)) {
        const dest = path.join(P.rejected, `studio-${sessionId}-inputs`)
        await fs.rm(dest, { recursive: true, force: true })
        await fs.rename(inputs, dest)
      }
      await emit({ batchId: null, reqId: req.id, sessionId, event: 'studio.closed', putAway: put })
      await log(`STUDIO ${sessionId} closed: ${put} unpicked result(s) to _rejected`)
    },
  }
}

/** An existing entity (a new look of it), or a proposal for a new one (numbered at the pick). */
async function checkTarget(req, fail) {
  const t = req.target ?? {}
  if (t.entity) {
    const ent = findEntity(await loadEntities(), String(t.entity))
    if (!ent) fail(`unknown entity '${t.entity}'; never auto-created`)
    if (ent.status === 'RETIRED') fail(`${ent.id} is RETIRED`)
    return
  }
  const p = req.proposal ?? {}
  if (!FOLDER_FOR[p.kind]) fail('say what kind of thing the new reference is')
  if (!String(p.name ?? '').trim() || !ASCII.test(String(p.name)) || !ASCII.test(String(p.description ?? ''))) {
    fail('name the new thing in English; the name goes into the registry when a result is picked')
  }
}

const inFlight = new Set()
// The CLI problem each waiting try was last told about, so it is said once, not every few seconds.
const cliWarned = new Map()

/**
 * Price every studio try that has been received and not yet priced. Like
 * priceBatches: no lock held across the cost call, only around the planning.
 */
export async function priceStudio(state, { emit, cfg, exclusive = (fn) => fn() }) {
  const processed = new Set(state.processedRequests ?? [])
  const reqs = (await readJsonl(P.jobRequests)).filter((r) => r.type === 'studio.price' && processed.has(r.id))
  if (reqs.length === 0) return 0
  const events = await readJsonl(P.jobRequestResults)
  const settled = new Set(events.filter((e) => e.event === 'studio.priced' || e.event === 'studio.error').map((e) => e.reqId))
  const received = new Set(events.filter((e) => e.event === 'studio.received').map((e) => e.reqId))
  // Only the newest try of each session is worth pricing: an older one was edited away.
  const newest = new Map()
  for (const r of reqs) newest.set(r.sessionId, r.id)
  let n = 0
  for (const req of reqs) {
    if (settled.has(req.id) || !received.has(req.id) || inFlight.has(req.id)) continue
    if (newest.get(req.sessionId) !== req.id) {
      await emit({ batchId: null, reqId: req.id, sessionId: req.sessionId, genId: req.genId, event: 'studio.error', reason: 'replaced by a later edit' })
      continue
    }
    const ready = await cliReady()
    if (!ready.ok) {
      // Not studio.error: that would settle the try, and it must be priced once the CLI works.
      // A plain `error` carrying the session is shown in the studio while it waits (lib/studio.ts).
      if (cliWarned.get(req.id) !== ready.reason) {
        await emit({ batchId: null, reqId: req.id, sessionId: req.sessionId, genId: req.genId, event: 'error', reason: `${ready.reason}; the try is priced once that is fixed` })
        await log(`HOLD studio pricing: ${ready.reason}`)
        cliWarned.set(req.id, ready.reason)
      }
      return n
    }
    cliWarned.delete(req.id)
    inFlight.add(req.id)
    try {
      const job = { jobId: 'studio-price', target: req.target?.entity ?? null, model: req.model, prompt: req.prompt, params: req.params ?? {}, refs: req.refs ?? [], stage: null, studio: { sessionId: req.sessionId, proposal: req.proposal } }
      const plan = await exclusive(async () => {
        const [entities, { rows: assets }] = await Promise.all([loadEntities(), readCsv(P.manifest)])
        return planJob(job, entities, assets, { cfg, priceOnly: true })
      })
      if (plan.skip) {
        await emit({ batchId: null, reqId: req.id, sessionId: req.sessionId, genId: req.genId, event: 'studio.error', reason: plan.skip })
        continue
      }
      const { credits, error } = await estimateCost(plan.model, plan.params)
      await emit({
        batchId: null, reqId: req.id, sessionId: req.sessionId, genId: req.genId, event: 'studio.priced',
        credits, count: req.count, total: credits == null ? null : credits * req.count,
        ...(credits == null && { reason: error }),
      })
      await log(`COST studio ${req.sessionId}/${req.genId} ${req.model} = ${credits ?? `unknown (${error})`} x ${req.count}`)
      n++
    } catch (e) {
      await emit({ batchId: null, reqId: req.id, sessionId: req.sessionId, genId: req.genId, event: 'studio.error', reason: `pricing failed: ${e.message}` })
    } finally {
      inFlight.delete(req.id)
    }
  }
  return n
}

