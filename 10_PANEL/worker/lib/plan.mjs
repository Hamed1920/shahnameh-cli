import { P, findEntity, isShotId, log, readJsonl, resolveRef } from './project.mjs'
import { NEW_TARGET_RX } from './batch.mjs'
import { loadCatalog } from './models.mjs'
import { hasHiggsfieldDrafts, mapParams, maxRefs, modelEntry, modelProblem } from './model-schema.mjs'
import { MENTION_RX, buildPrompt } from './prompt.mjs'
import { NEXT_SCENE_RX } from './scenes.mjs'
import { isAudioFile } from './ids.mjs'

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
  // A reference-studio try for something not in the index yet has no target:
  // its number is allocated only when a result is picked (worker/lib/studio.mjs).
  const studio = job.studio ?? null
  const unfiled = Boolean(studio && !job.target)
  const shot = !studio && isShotId(job.target) ? job.target : null
  const isNew = priceOnly && (NEW_TARGET_RX.test(String(job.target ?? '')) || NEXT_SCENE_RX.test(String(job.target ?? '')))
  const entity = shot || isNew || unfiled ? null : findEntity(entities, job.target)
  if (!shot && !isNew && !unfiled && !entity) return { skip: `unknown target ${job.target}` }
  const targetId = shot ?? entity?.id ?? job.target ?? `studio:${studio?.proposal?.kind ?? ''}`

  // Resolve reference tokens to real paths before spending anything.
  const refPaths = []
  const refInfo = []
  for (const token of job.refs ?? []) {
    const r = await resolveRef(token, entities, assets)
    if (!r.ok) return { skip: `unresolved ref ${token}: ${r.reason}` }
    // A voice is a recording: sending it as an image reference would fail or mislead the model.
    if (isAudioFile(r.path)) {
      if (!priceOnly) await log(`SKIP REF ${job.jobId}: ${token} is a recording, not a picture; not sent`)
      continue
    }
    refPaths.push(r.path)
    refInfo.push({ path: r.path, entity: r.entity, variant: r.variant, label: r.label ?? null })
  }

  const model = job.model || cfg.defaultImageModel
  const catalog = loadCatalog()
  const modelWhy = modelProblem(catalog, model)
  if (modelWhy) return { skip: modelWhy }
  const entry = modelEntry(catalog, model)
  const frames = entry?.refs?.param === 'start_image'

  // A new thing has no entity yet; the rules approved for its kind still apply.
  const learnings = await applicableLearnings(entity ?? (studio?.proposal ? { kind: studio.proposal.kind } : null))

  // A reference an approved learning or a revision note names ("masks as in
  // @REF-001/V01") is attached like the job's own, so the model gets the picture
  // the rule points at, not just its name. Only as many as the model takes, and
  // never as a start frame (a frame model's one image is the shot's own). One that
  // does not resolve (archived, say) is left to buildPrompt to name in words.
  // Every reference attached beyond the job's own, as its token, so a final can be sent the same set.
  const extra = []
  // A job that carries `sentPrompt` is a final of an approved draft: that draft's prompt and its images
  // are reused as they were, not rebuilt from today's rules and notes (see enqueueFinal in worker.mjs).
  if (!frames && !job.sentPrompt) {
    const room = maxRefs(entry) - refInfo.length
    for (const text of [...learnings, ...(job.revisionNotes ?? [])]) {
      for (const m of String(text ?? '').matchAll(MENTION_RX)) {
        if (extra.length >= room) break
        const r = await resolveRef(m[1], entities, assets)
        if (!r.ok || isAudioFile(r.path) || refPaths.includes(r.path) || extra.some((x) => x.path === r.path)) continue
        extra.push({ path: r.path, entity: r.entity, variant: r.variant, label: r.label ?? null, token: m[1] })
      }
    }
    for (const x of extra) { refPaths.push(x.path); refInfo.push(x) }
  }
  const { prompt, mentioned } = job.sentPrompt
    ? { prompt: String(job.sentPrompt), mentioned: true }
    : await buildPrompt(job.prompt, learnings, job.revisionNotes, refInfo, entities, assets, { frames })
  if (refInfo.length && !priceOnly) {
    const key = refInfo.map((r, i) => `${frames ? (i ? 'end' : 'start') : `image_${i + 1}`}=${r.entity ? `${r.entity.short_id}/${r.variant}` : 'studio-file'}`).join(' ')
    await log(`IMAGES ${job.jobId}: ${key}${mentioned ? ' (called in the text)' : ' (none called in the text; each named once at the end)'}`)
    if (dry) await log(`DRY-RUN prompt for ${job.jobId}:\n${prompt}`)
  }
  // The job's intent in the form this model takes (model-schema.mjs): sound on
  // for video unless the job says otherwise (generate_audio, or Kling's sound
  // on|off), references as a list or a first frame, Seedance's omni_reference
  // mode when references are attached, and nothing the model does not accept.
  const mapped = mapParams(entry, { refs: refPaths, params: job.params ?? {}, stage: job.stage ?? null, cfg: { ...cfg, model } })
  if (mapped.errors.length) return { skip: mapped.errors.join('; ') }
  if (mapped.warnings.length && !priceOnly) await log(`PARAMS ${job.jobId}: ${mapped.warnings.join('; ')}`)
  // Higgsfield's draft mode, where the model has it. A draft is made as a real draft, so that if it is
  // approved untouched it can be finished at full quality as itself (`draft_job_id`) rather than generated
  // again and coming out different. `draft` has to be said explicitly (false) beside a draft_job_id: the
  // CLI cannot check the pair otherwise.
  let hfDraft = false
  if (hasHiggsfieldDrafts(entry) && cfg?.useHiggsfieldDrafts !== false) {
    if (job.draftJobId && job.stage === 'final') {
      mapped.params.draft = false
      mapped.params.draft_job_id = job.draftJobId
    } else if (job.stage === 'draft') {
      mapped.params.draft = true
      hfDraft = true
    }
  }
  const params = { prompt, ...mapped.params }
  const sentRefs = [...(job.refs ?? []), ...extra.map((x) => x.token).filter(Boolean)]
  return { shot, entity, targetId, refPaths, prompt, model, params, entry, sentRefs, hfDraft }
}
