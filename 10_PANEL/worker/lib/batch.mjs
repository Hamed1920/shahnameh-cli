import { findEntity, isShotId, resolveRef } from './project.mjs'
import { FOLDER_FOR, entitySlug } from './promote.mjs'
import { NEXT_SCENE_RX } from './scenes.mjs'
import { loadCatalog } from './models.mjs'
import { isVideo, mapParams, modelEntry, modelProblem } from './model-schema.mjs'

/**
 * Turning rows of { target, prompt, ... } into queue jobs. Shared by the
 * enqueue-batch CLI script and the worker's Prompts-page handler, so both
 * apply exactly the same rules: every target must exist (or, for the worker,
 * be a NEW/KIND/SLUG proposal), every reference must resolve to a file, and
 * nothing is reworded.
 */

/** From the model catalogue (MODEL_CATALOG.json); the old name rule only for a model it does not list. */
export const isVideoModel = (m) => isVideo(loadCatalog(), m)

/**
 * The resolution a video stage renders at for this model: the config's draft or
 * final resolution when the model offers it, else its lowest or highest. Null
 * for a model with no resolution steps (Kling 3.0, Veo), which has no draft stage.
 */
export function stageResolution(model, stage, cfg) {
  const e = modelEntry(loadCatalog(), model)
  if (!e) return stage === 'final' ? cfg.videoFinalResolution : cfg.videoDraftResolution
  if (!e.stages || !stage) return null
  const want = stage === 'final' ? cfg.videoFinalResolution : cfg.videoDraftResolution
  return e.stages.options.includes(want) ? want : e.stages[stage]
}

/** Does this video model have a cheap draft to render first? Without a catalogue, assume so, as before. */
export function hasDraftStage(model) {
  const e = modelEntry(loadCatalog(), model)
  return e ? Boolean(e.stages) : isVideoModel(model)
}

/** Mirrors the NEW/ target grammar in Ingest-Jobs.ps1 (line 179). */
export const NEW_TARGET_RX = /^NEW\/([A-Z]{2,3})\/([A-Z0-9][A-Z0-9-]*)$/

export function newJobId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `J-${stamp}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
}

/**
 * Video defaults: a cheap draft resolution, the standard duration, and sound.
 * Sound is ON unless the row says otherwise. Every EP001 block was queued with
 * generate_audio "false" by hand, and revisions and finals copied it forward,
 * which is why nothing had audio. The value is normalised to a real boolean so
 * a legacy "false" string still reads as off.
 */
export function applyVideoDefaults(params, { model, stage, cfg }) {
  if (!isVideoModel(model)) return params
  if (stage === 'draft' && !params.resolution) {
    const r = stageResolution(model, 'draft', cfg)
    if (r) params.resolution = r
  }
  if (!params.duration) params.duration = cfg.videoDuration
  const v = params.generate_audio
  params.generate_audio = v === undefined || v === null || v === ''
    ? (cfg.videoSound ?? true)
    : String(v) === 'true'
  return params
}

/** Fill defaults the way enqueue-batch always has. Pure; does not touch the registries. */
export function normalizeRow(raw, cfg) {
  const model = raw.model || cfg.defaultImageModel
  const isVideo = isVideoModel(model)
  // A model with no resolution steps has no draft: it renders once, as the final.
  const staged = isVideo && hasDraftStage(model)
  const stage = staged ? (raw.stage ?? 'draft') : null
  const params = applyVideoDefaults({ ...(raw.params ?? {}) }, { model, stage, cfg })
  return {
    key: raw.key ?? null,
    label: raw.label ?? null,
    target: String(raw.target ?? '').trim(),
    newEntity: raw.newEntity ?? null,
    variant: raw.variant || null,
    model,
    stage,
    params,
    refs: Array.isArray(raw.refs) ? raw.refs.map((r) => String(r).trim()).filter(Boolean) : [],
    prompt: String(raw.prompt ?? '').trim(),
  }
}

/**
 * Validate every row against the registries. Never writes.
 *
 * Returns { ok, bad: [at, reason, key][], newEntities }. `ok` rows carry `targetId` (the resolved
 * entity id, the shot id, or the NEW/ proposal itself) and `variant`. With
 * allowNew=false (the CLI script) a NEW/ target is rejected, as before: only
 * the worker may reserve a number, at batch approval.
 */
export async function checkBatch(rows, { entities, assets, cfg, allowNew = false }) {
  const ok = []
  const bad = []
  const newEntities = []
  const seen = new Set()
  const claimedSlugs = new Set()

  for (const [i, raw] of rows.entries()) {
    const at = raw?.label ? `"${raw.label}"` : raw?.key ? raw.key : `#${i + 1}`
    if (!raw || typeof raw !== 'object') { bad.push([at, 'not an object', raw?.key ?? null]); continue }
    const row = normalizeRow(raw, cfg)
    if (!row.target) { bad.push([at, 'missing target', raw?.key ?? null]); continue }
    if (!row.prompt) { bad.push([at, 'missing prompt', raw?.key ?? null]); continue }
    const modelWhy = modelProblem(loadCatalog(), row.model)
    if (modelWhy) { bad.push([at, modelWhy, raw?.key ?? null]); continue }

    let targetId
    let entity = null
    const m = row.target.match(NEW_TARGET_RX)
    if (m) {
      if (!allowNew) { bad.push([at, 'NEW/ targets are reserved by the worker at approval - use the Prompts page', raw?.key ?? null]); continue }
      const kind = m[1]
      const slug = entitySlug(m[2])
      if (!FOLDER_FOR[kind]) { bad.push([at, `unknown kind '${kind}' in ${row.target}`, raw?.key ?? null]); continue }
      if (!slug) { bad.push([at, `${row.target} has no usable letters`, raw?.key ?? null]); continue }
      const clash = entities.find((e) => e.slug === slug)
      if (clash) { bad.push([at, `slug '${slug}' already exists as ${clash.id}`, raw?.key ?? null]); continue }
      if (claimedSlugs.has(slug)) { bad.push([at, `slug '${slug}' is proposed twice in this batch`, raw?.key ?? null]); continue }
      claimedSlugs.add(slug)
      targetId = `NEW/${kind}/${slug}`
      newEntities.push({ key: row.key ?? at, kind, slug, name: row.newEntity?.name, description: row.newEntity?.description })
    } else if (NEXT_SCENE_RX.test(row.target)) {
      // The next free scene of an episode, numbered at approval (scenes.mjs).
      if (!allowNew) { bad.push([at, 'NEXT/ scenes are numbered by the worker at approval - use the Prompts page', raw?.key ?? null]); continue }
      targetId = row.target
    } else if (isShotId(row.target)) {
      targetId = row.target
    } else {
      entity = findEntity(entities, row.target)
      if (!entity) { bad.push([at, `unknown target '${row.target}' - register it first, never auto-created`, raw?.key ?? null]); continue }
      if (entity.status === 'RETIRED') { bad.push([at, `${entity.id} is RETIRED`, raw?.key ?? null]); continue }
      targetId = entity.id
    }

    const variant = row.variant || entity?.canonical_variant || 'V01'

    // Resolve refs now so a broken reference is caught before any credits are spent.
    let refErr = null
    for (const token of row.refs) {
      const r = await resolveRef(token, entities, assets)
      if (!r.ok) { refErr = `unresolved ref ${token}: ${r.reason}`; break }
    }
    if (refErr) { bad.push([at, refErr, raw?.key ?? null]); continue }

    // What the model itself takes: how many references, and in what form.
    const fit = mapParams(modelEntry(loadCatalog(), row.model), { refs: row.refs, params: row.params, stage: row.stage, cfg })
    if (fit.errors.length) { bad.push([at, fit.errors.join('; '), raw?.key ?? null]); continue }

    // Deduplicate within the batch: the same target+variant+prompt twice is
    // almost always a copy-paste artefact in a long document, not an intentional pair.
    // Two NEXT/ rows are two scenes, so only the prompt can make them duplicates.
    const dupKey = `${NEXT_SCENE_RX.test(targetId) ? 'NEXT' : targetId}|${variant}|${row.prompt}`
    if (seen.has(dupKey)) { bad.push([at, 'duplicate of an earlier row in this batch', raw?.key ?? null]); continue }
    seen.add(dupKey)

    ok.push({ ...row, at, targetId, variant })
  }
  return { ok, bad, newEntities }
}

/** The QUEUE.jsonl record for an accepted row. `targetId` overrides the row's (a NEW/ proposal once reserved). */
export function makeJob(row, { jobId, enqueuedBy, batchId = null, targetId = row.targetId }) {
  return {
    jobId,
    parentJobId: null,
    attempt: 1,
    stage: row.stage,
    target: targetId,
    variant: row.variant,
    model: row.model,
    prompt: row.prompt,
    basePrompt: row.prompt,
    params: row.params,
    refs: row.refs,
    revisionNotes: [],
    label: row.label ?? null,
    ...(batchId && { batchId }),
    enqueuedAt: new Date().toISOString(),
    enqueuedBy,
  }
}
