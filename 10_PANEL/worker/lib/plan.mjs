import { P, findEntity, isShotId, log, readJsonl, resolveRef } from './project.mjs'
import { NEW_TARGET_RX, isVideoModel } from './batch.mjs'
import { buildPrompt } from './prompt.mjs'
import { NEXT_SCENE_RX } from './scenes.mjs'

/**
 * What a queued job needs before it can be priced or generated: its target,
 * its references resolved to files, and the final prompt. Kept apart from
 * worker.mjs so the Prompts-page pricer sees exactly the parameters runQueue
 * will send.
 */

/** Approved learnings whose scope matches this target. Nothing else is ever injected. */
export async function applicableLearnings(entity) {
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

/**
 * `{ skip }` when the job cannot run. With `priceOnly`, a NEW/KIND/SLUG or NEXT/EPnnn
 * target (not numbered until the batch is approved) is accepted: the price depends on
 * the model and parameters, not on the target.
 */
export async function planJob(job, entities, assets, { cfg, dry = false, priceOnly = false } = {}) {
  // A shot target is valid but is not an entity; it renders into the episode.
  const shot = isShotId(job.target) ? job.target : null
  const isNew = priceOnly && (NEW_TARGET_RX.test(String(job.target ?? '')) || NEXT_SCENE_RX.test(String(job.target ?? '')))
  const entity = shot || isNew ? null : findEntity(entities, job.target)
  if (!shot && !isNew && !entity) return { skip: `unknown target ${job.target}` }
  const targetId = shot ?? entity?.id ?? job.target

  // Resolve reference tokens to real paths before spending anything.
  const refPaths = []
  const refInfo = []
  for (const token of job.refs ?? []) {
    const r = await resolveRef(token, entities, assets)
    if (!r.ok) return { skip: `unresolved ref ${token}: ${r.reason}` }
    refPaths.push(r.path)
    refInfo.push({ path: r.path, entity: r.entity, variant: r.variant })
  }

  const learnings = await applicableLearnings(entity)
  const { prompt, mentioned } = await buildPrompt(job.prompt, learnings, job.revisionNotes, refInfo, entities, assets)
  if (refInfo.length && !priceOnly) {
    const key = refInfo.map((r, i) => `image_${i + 1}=${r.entity.short_id}/${r.variant}`).join(' ')
    await log(`IMAGES ${job.jobId}: ${key}${mentioned ? ' (called in the text)' : ' (none called in the text; each named once at the end)'}`)
    if (dry) await log(`DRY-RUN prompt for ${job.jobId}:\n${prompt}`)
  }
  const model = job.model || cfg.defaultImageModel
  const params = { prompt, ...(job.params ?? {}) }

  // Sound is on for every video unless the job says otherwise. Older queue
  // lines carry the string "false"; normalise so the flag is a real boolean.
  if (isVideoModel(model)) {
    const v = params.generate_audio
    params.generate_audio = v === undefined || v === null || v === '' ? (cfg.videoSound ?? true) : String(v) === 'true'
  }

  // Array -> repeated --image-references flags (see paramsToArgs).
  if (refPaths.length) params.image_references = refPaths

  // Seedance rejects reference media in the default t2v mode; supplying
  // references without switching mode fails the job after it is priced.
  if (refPaths.length && /^seedance/.test(model) && !params.mode) {
    params.mode = 'omni_reference'
  }
  return { shot, entity, targetId, refPaths, prompt, model, params }
}
