import { idRx } from '../worker/lib/ids.mjs'
import { KINDS, entitySlug, isAscii } from './indexing'
import { targetCandidates } from './ref-suggest'
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
export const isVideoModel = (m: string | null | undefined) => /^(seedance|kling|veo|wan|hailuo|grok_video)/.test(String(m ?? ''))

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
  `${model}|${p?.resolution ?? ''}|${p?.duration ?? ''}|${p?.generate_audio === undefined ? '' : String(p.generate_audio)}`

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
  refs: string[]
  prompt: string
  /** Per-row parameter overrides from the document (aspect ratio, duration, sound). */
  params: Record<string, string>
  /** From the parser: not errors, just worth a look. */
  warnings: string[]
}

export interface RowConfig {
  /** The project's ID prefix, e.g. SHM. */
  code: string
  models: { image: string[]; video: string[] }
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
  const known = [...cfg.models.image, ...cfg.models.video]
  if (known.length && !known.includes(model)) problems.push(`Model ${model} is not in the worker's list.`)

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
    const [id, variant] = ref.replace(/^@/, '').split('/')
    const ent = catalog.find((e) => e.id === id || e.shortId === id)
    if (!ent) { problems.push(`${ref} is not in the index.`); continue }
    const want = (variant || ent.canonical || '').toUpperCase()
    if (!want) problems.push(`${ref}: ${ent.shortId} has no main look yet, so say which look.`)
    else if (!ent.variants.some((v) => v.variant === want)) problems.push(`${ref}: ${ent.shortId} has no look ${want}.`)
  }

  // Two next-free-scene rows are two scenes, so only the prompt can make them the same.
  const sameKey = (r: DraftRow) =>
    `${r.targetMode === 'shot' && r.sceneAuto ? 'NEXT' : rowTarget(r)}|${r.variant.trim().toUpperCase() || ''}|${r.prompt.trim()}`
  const me = sameKey(row)
  const dup = batch.find((r) => r !== row && sameKey(r) === me)
  if (dup && batch.indexOf(dup) < batch.indexOf(row)) problems.push(`Same target and prompt as row ${dup.label || dup.key}.`)

  return problems
}

/** What the worker receives for one row: the defaults folded into params, nothing reworded. */
export function toJobInput(row: DraftRow, defaults: BatchDefaults): BatchJobInput {
  const model = rowModel(row, defaults)
  const video = isVideoModel(model)
  const params: Record<string, string | number | boolean> = { aspect_ratio: defaults.aspect_ratio }
  if (video) {
    params.duration = defaults.duration
    params.generate_audio = defaults.generate_audio
  }
  for (const [k, v] of Object.entries(row.params)) {
    if (k === 'generate_audio') params[k] = String(v) === 'true'
    else if (k === 'duration') params[k] = Number(v) || v
    else params[k] = v
  }
  const stage = video ? (row.stage || defaults.stage) : null
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
