import { idRx } from '../worker/lib/ids.mjs'
import { KINDS, entitySlug, isAscii } from './indexing'
import { checkModelFit, hasDraft, hasSound, isVideoModel, modelInfo, modelProblemOf } from './models'
import { targetCandidates } from './ref-suggest'
import type { RefSlot } from './ref-slots'
import { EPISODE_RX, NEXT_SCENE_RX, latestEpisode, nextSceneTarget, sceneFromDocument } from './scenes'
import type { BatchDefaults, BatchJobInput, CatalogEntity } from './types'

/**
 * The rules a Prompts-page row must pass, checked in the browser as Hamed
 * edits so a mistake shows in its row, and again on the server before the
 * request is appended. The worker (worker/lib/batch.mjs) is the authority
 * and checks everything a third time when it validates the batch.
 */

/** CODE-EP001-SC004-SH0010 for one project. */
export const shotRx = (code: string) => idRx(code).shot
/** From the model catalogue (lib/models.ts); re-exported so existing imports keep working. */
export { isVideoModel }

/**
 * What one job costs, by everything the price depends on: model, resolution,
 * duration and whether audio is generated. Sound is part of the key so a silent
 * take's price is never shown for a job with sound.
 *
 * Here rather than in store.ts because the quality toggle prices both
 * resolutions in the browser as the dialog is edited, and store.ts reads the
 * disk. store.ts re-exports it so there is still one definition.
 */
export const priceKey = (model: unknown, p: Record<string, unknown> | undefined) =>
  `${model}|${p?.resolution ?? ''}|${p?.duration ?? ''}|${p?.generate_audio === undefined ? '' : String(p.generate_audio)}${p?.mode ? `|${p.mode}` : ''}`

export type TargetMode = 'entity' | 'shot' | 'new'

/** A row as the page holds it, before it becomes a BatchJobInput. */
export interface DraftRow {
  key: string
  label: string
  targetMode: TargetMode
  /** Entity: full or short id. Shot: the shot id, unless sceneAuto. New: unused. */
  target: string
  /** Shot mode: let the worker give it the next free scene of `episode` at approval. */
  sceneAuto: boolean
  /** EP001. Only read when sceneAuto. */
  episode: string
  newKind: string
  newName: string
  newDescription: string
  variant: string
  /** Empty = the batch default. */
  model: string
  /** Empty = the batch default (video only). */
  stage: '' | 'draft' | 'final'
  /** What the worker gets, in order. Always refsOf(slots, loose) (lib/ref-slots.ts). */
  refs: string[]
  /** The references by what they are: a slot per thing the prompt names. */
  slots: RefSlot[]
  /** References in no slot (the tray). */
  loose: string[]
  /** Files added to this row on the page, `upload:<id>` in refs. The worker files them when the batch is submitted. */
  uploads: RowUpload[]
  prompt: string
  /** Per-row parameter overrides from the document (aspect ratio, duration, sound). */
  params: Record<string, string>
  /** From the parser: not errors, just worth a look. */
  warnings: string[]
}

/** How a file added on the Prompts page is filed: the same choices as a Review upload. */
export interface RowUpload {
  /** u1, u2 ...: unique across the batch, since the batch carries them all. */
  id: string
  originalName: string
  mode: 'variant' | 'new'
  /** Full entity id, for mode=variant. */
  entity: string
  kind: string
  name: string
  description: string
  role: string
  descriptor: string
}

/** What is wrong with how an upload is to be filed, if anything. The server and the worker check again. */
export function uploadProblem(u: RowUpload, catalog: CatalogEntity[]): string | null {
  const label = u.originalName || u.id
  if (!u.descriptor.trim()) return `${label}: add a short English description.`
  if (!isAscii(u.descriptor) || !isAscii(u.name) || !isAscii(u.description)) return `${label}: names and descriptions go into the index, so they must be English.`
  if (u.mode === 'variant') {
    if (!catalog.some((e) => e.id === u.entity || e.shortId === u.entity)) return `${label}: say which entity it is a picture of.`
  } else {
    if (!(KINDS as readonly string[]).includes(u.kind)) return `${label}: choose a kind for the new entity.`
    const slug = entitySlug(u.name)
    if (!slug) return `${label}: name the new entity.`
    const clash = catalog.find((e) => e.slug === slug)
    if (clash) return `${label}: '${slug}' already exists as ${clash.shortId}; make it a new look of ${clash.shortId}.`
  }
  return null
}

export interface RowConfig {
  /** The project's ID prefix, e.g. SHM. */
  code: string
  /** Shown first in model pickers (worker/config.json pinnedModels). Any usable catalogue model is allowed. */
  pinned: string[]
}

export type RowTarget = Pick<DraftRow, 'targetMode' | 'target' | 'sceneAuto' | 'episode' | 'newKind' | 'newName'>

/** Classify a target as the document wrote it. */
export function targetModeOf(target: string | null, catalog: CatalogEntity[], code: string, episode = 'EP001'): RowTarget {
  const t = String(target ?? '').trim()
  const base = { target: '', sceneAuto: false, episode, newKind: '', newName: '' }
  const m = t.match(/^NEW\/([A-Z]{2,3})\/([A-Z0-9][A-Z0-9-]*)$/i)
  if (m) return { ...base, targetMode: 'new', newKind: m[1].toUpperCase(), newName: m[2].replace(/-/g, ' ') }
  const next = t.toUpperCase().match(NEXT_SCENE_RX)
  if (next) return { ...base, targetMode: 'shot', sceneAuto: true, episode: next[1] }
  if (shotRx(code).test(t)) return { ...base, targetMode: 'shot', target: t }
  const ent = catalog.find((e) => e.id === t || e.shortId === t || e.id === t.replace(/^@/, '') || e.shortId === t.replace(/^@/, ''))
  return { ...base, targetMode: 'entity', target: ent?.id ?? t }
}

/**
 * Where a freshly parsed prompt is filed, before Hamed touches it:
 *   1. a target the document gives (a `target:` line, an SHM-JOB header)
 *      -- SHM-JOB is the block keyword in every project, whatever its code
 *   2. a shot the document names (SC013 in the file name or label, a full shot id)
 *   3. a video: the next free scene of the batch's episode, numbered at approval
 *   4. an image: the one entity its references (or its words) point at, else nothing yet
 */
export function initialTarget(
  parsed: { target: string | null; label: string | null; prompt: string; refs: string[]; model: string | null },
  ctx: {
    file: string | null; catalog: CatalogEntity[]; defaultModel: string; knownShots: string[]; code: string
    /** The episode this batch is for, chosen on the Prompts page. Falls back to the latest one with footage. */
    episode?: string
  },
): RowTarget {
  const episode = ctx.episode ?? latestEpisode(ctx.knownShots, ctx.code)
  if (parsed.target) return targetModeOf(parsed.target, ctx.catalog, ctx.code, episode)
  const shot = sceneFromDocument({ file: ctx.file, label: parsed.label, prompt: parsed.prompt }, episode, ctx.code)
  if (shot) return targetModeOf(shot, ctx.catalog, ctx.code, episode)
  const base = { target: '', sceneAuto: false, episode, newKind: '', newName: '' }
  if (isVideoModel(parsed.model || ctx.defaultModel)) return { ...base, targetMode: 'shot', sceneAuto: true }
  const candidates = targetCandidates(parsed.prompt, parsed.refs, ctx.catalog)
  return { ...base, targetMode: 'entity', target: candidates.length === 1 ? candidates[0].id : '' }
}

/** The target string the worker receives. */
export function rowTarget(row: DraftRow): string {
  if (row.targetMode === 'new') return `NEW/${row.newKind}/${entitySlug(row.newName)}`
  if (row.targetMode === 'shot' && row.sceneAuto) return nextSceneTarget(row.episode.trim().toUpperCase())
  return row.target.trim()
}

export function rowModel(row: DraftRow, defaults: BatchDefaults): string {
  return row.model || defaults.model
}

export function checkRow(row: DraftRow, catalog: CatalogEntity[], batch: DraftRow[], defaults: BatchDefaults, cfg: RowConfig): string[] {
  const problems: string[] = []
  if (!row.prompt.trim()) problems.push('The prompt is empty.')

  const model = rowModel(row, defaults)
  const modelWhy = modelProblemOf(model)
  if (modelWhy) problems.push(modelWhy)

  if (row.targetMode === 'entity') {
    const t = row.target.trim()
    if (!t) problems.push('Choose what this prompt is for.')
    else if (!catalog.some((e) => e.id === t || e.shortId === t)) problems.push(`${t} is not in the index. Pick it from the list, or make it a new entity.`)
  } else if (row.targetMode === 'shot' && row.sceneAuto) {
    if (!EPISODE_RX.test(row.episode.trim().toUpperCase())) problems.push('An episode looks like EP001.')
  } else if (row.targetMode === 'shot') {
    const t = row.target.trim()
    if (!t) problems.push('Type the shot id.')
    else if (!shotRx(cfg.code).test(t)) problems.push(`A shot id looks like ${cfg.code}-EP001-SC004-SH0010.`)
  } else {
    if (!(KINDS as readonly string[]).includes(row.newKind)) problems.push('Choose a kind for the new entity.')
    const slug = entitySlug(row.newName)
    if (!row.newName.trim()) problems.push('Name the new entity.')
    else if (!isAscii(row.newName) || !isAscii(row.newDescription)) problems.push('The name and description go into the registry, so they must be English.')
    else if (!slug) problems.push('The name needs at least one English letter or digit.')
    else {
      const clash = catalog.find((e) => e.slug === slug)
      if (clash) problems.push(`'${slug}' already exists as ${clash.shortId}. Target that entity instead.`)
      const twin = batch.find((r) => r !== row && r.targetMode === 'new' && entitySlug(r.newName) === slug)
      if (twin) problems.push(`Row ${twin.label || twin.key} proposes the same new entity.`)
    }
  }

  if (row.variant && !/^V\d{2}$/i.test(row.variant.trim())) problems.push('A look is V01, V02, ...')

  for (const ref of row.refs) {
    if (ref.startsWith('upload:')) {
      const u = row.uploads.find((x) => `upload:${x.id}` === ref)
      if (!u) problems.push(`${ref} is not a file added to this row.`)
      else { const why = uploadProblem(u, catalog); if (why) problems.push(why) }
      continue
    }
    const [id, variant] = ref.replace(/^@/, '').split('/')
    const ent = catalog.find((e) => e.id === id || e.shortId === id)
    if (!ent) { problems.push(`${ref} is not in the index.`); continue }
    const want = (variant || ent.canonical || '').toUpperCase()
    if (!want) problems.push(`${ref}: ${ent.shortId} has no main look yet, so say which look.`)
    else if (!ent.variants.some((v) => v.variant === want)) problems.push(`${ref}: ${ent.shortId} has no look ${want}.`)
  }

  // How many references, and in what form, is the model's call (Kling takes one start frame).
  if (!modelWhy) {
    const fit = checkModelFit(model, row.refs, row.params, row.stage || null)
    problems.push(...fit.errors)
  }

  // Two next-free-scene rows are two scenes, so only the prompt can make them the same.
  // A blank look is the one the worker will use (batch.mjs checkBatch): the entity's
  // main look, else V01 -- so "blank" and "V01" on the same entity are one look.
  const lookOf = (r: DraftRow) => {
    const set = r.variant.trim().toUpperCase()
    if (set) return set
    const ent = r.targetMode === 'entity' ? catalog.find((e) => e.id === r.target.trim() || e.shortId === r.target.trim()) : null
    return (ent?.canonical || 'V01').toUpperCase()
  }
  const sameKey = (r: DraftRow) =>
    `${r.targetMode === 'shot' && r.sceneAuto ? 'NEXT' : rowTarget(r)}|${lookOf(r)}|${r.prompt.trim()}`
  const me = sameKey(row)
  const dup = batch.find((r) => r !== row && sameKey(r) === me)
  if (dup && batch.indexOf(dup) < batch.indexOf(row)) problems.push(`Same target and prompt as row ${dup.label || dup.key}.`)

  return problems
}

/** What the worker receives for one row: the defaults folded into params, nothing reworded. */
export function toJobInput(row: DraftRow, defaults: BatchDefaults): BatchJobInput {
  const model = rowModel(row, defaults)
  const video = isVideoModel(model)
  const info = modelInfo(model)
  const params: Record<string, string | number | boolean> = { aspect_ratio: defaults.aspect_ratio }
  if (video) {
    if (!info || info.params.some((p) => p.name === 'duration')) params.duration = defaults.duration
    if (hasSound(model)) params.generate_audio = defaults.generate_audio
  }
  // The batch's model settings apply to rows on the batch's model; another model has other settings.
  if (model === defaults.model) {
    const names = new Map((info?.params ?? []).map((p) => [p.name, p]))
    for (const [k, v] of Object.entries(defaults.extra ?? {})) {
      const p = names.get(k)
      if (!p || v === '') continue
      params[k] = /integer|number/.test(String(p.type ?? '')) ? Number(v) : String(p.type ?? '').startsWith('boolean') ? v === 'true' : v
    }
  }
  for (const [k, v] of Object.entries(row.params)) {
    if (k === 'generate_audio') params[k] = String(v) === 'true'
    else if (k === 'duration') params[k] = Number(v) || v
    else params[k] = v
  }
  const stage = video && hasDraft(model) ? (row.stage || defaults.stage) : null
  return {
    key: row.key,
    label: row.label.trim() || null,
    target: rowTarget(row),
    ...(row.targetMode === 'new' && {
      newEntity: { kind: row.newKind, slug: entitySlug(row.newName), name: row.newName.trim(), description: row.newDescription.trim() },
    }),
    variant: row.variant.trim().toUpperCase() || null,
    model,
    stage,
    refs: row.refs,
    params,
    prompt: row.prompt.trim(),
  }
}
