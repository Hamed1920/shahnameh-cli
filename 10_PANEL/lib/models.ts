import catalogJson from '../worker/MODEL_CATALOG.json'
import {
  INTERNAL_PARAMS, isVideo, mapParams, maxRefs, modelEntry, modelKind, modelProblem, usableModels,
} from '../worker/lib/model-schema.mjs'

/**
 * The Higgsfield model catalogue as the panel sees it: the file the worker
 * fetches from `model list` / `model get` (worker/lib/models.mjs), bundled at
 * build time so the browser can draw pickers and settings without a request.
 * A refresh rewrites the file and the dev server picks it up.
 *
 * The rules themselves live in worker/lib/model-schema.mjs, shared with the
 * worker, so what the page allows is what the worker will send.
 */

export interface ModelParam {
  name: string
  type: string
  default: string | number | boolean | null
  required: boolean
  enum?: (string | number)[]
}

export interface ModelInfo {
  job_type: string
  display_name: string
  type: 'image' | 'video' | string
  usable: boolean
  why?: string
  params: ModelParam[]
  rules: string[]
  refs: { param: 'image_references' | 'start_image'; max: number; min: number } | null
  sound: { param: string; kind: 'bool' | 'onoff' } | null
  stages: { draft: string; final: string; options: string[] } | null
}

export interface ModelCatalog {
  fetchedAt: string | null
  models: Record<string, ModelInfo>
}

export const CATALOG = catalogJson as unknown as ModelCatalog

export const modelInfo = (model: string | null | undefined): ModelInfo | null => modelEntry(CATALOG, model) as ModelInfo | null
export const modelKindOf = (model: string | null | undefined): 'image' | 'video' | null => modelKind(CATALOG, model) as 'image' | 'video' | null
export const isVideoModel = (model: string | null | undefined): boolean => isVideo(CATALOG, model)
export const modelProblemOf = (model: string | null | undefined): string | null => modelProblem(CATALOG, model)
export const refLimit = (model: string | null | undefined): number => maxRefs(modelInfo(model))

/** Usable models of one kind (or both), the config's pinned ones first. */
export const modelsFor = (kind: 'image' | 'video' | null, pinned: string[] = []): ModelInfo[] =>
  usableModels(CATALOG, kind, pinned) as ModelInfo[]

/** The display name, or the job type when the catalogue does not know it. */
export const modelLabel = (model: string | null | undefined): string => modelInfo(model)?.display_name ?? String(model ?? '')

/** Params a person sets, in the order the model lists them: not the prompt or the images. */
export function settableParams(model: string | null | undefined): ModelParam[] {
  const info = modelInfo(model)
  if (!info) return []
  return info.params.filter((p) => !INTERNAL_PARAMS.has(p.name) && p.name !== 'generate_audio' && p.name !== 'sound')
}

/** The aspect ratios this model takes, else the config's list. */
export function aspectRatiosFor(model: string | null | undefined, fallback: string[]): string[] {
  const p = modelInfo(model)?.params.find((x) => x.name === 'aspect_ratio')
  return p?.enum ? p.enum.map(String) : fallback
}

/** Durations: the model's list, else the config's; null when the model has no duration. */
export function durationsFor(model: string | null | undefined, fallback: number[]): number[] | null {
  const info = modelInfo(model)
  if (!info) return fallback
  const p = info.params.find((x) => x.name === 'duration')
  if (!p) return null
  return p.enum ? p.enum.map(Number) : fallback
}

export const hasSound = (model: string | null | undefined): boolean => {
  const info = modelInfo(model)
  return info ? Boolean(info.sound) : isVideoModel(model)
}

export const hasDraft = (model: string | null | undefined): boolean => {
  const info = modelInfo(model)
  return info ? Boolean(info.stages) : isVideoModel(model)
}

/**
 * The resolution a draft or final renders at for this model, as the worker
 * picks it (stageResolution in worker/lib/batch.mjs): the config's when the
 * model offers it, else the model's lowest or highest. Null when it has no steps.
 */
export function stageResolutionFor(model: string | null | undefined, stage: 'draft' | 'final', cfg: { videoDraftResolution: string; videoFinalResolution: string }): string | null {
  const info = modelInfo(model)
  const want = stage === 'final' ? cfg.videoFinalResolution : cfg.videoDraftResolution
  if (!info) return want
  if (!info.stages) return null
  return info.stages.options.includes(want) ? want : info.stages[stage]
}

/** Params already covered by their own controls (aspect, duration, draft/final). */
export function extraParams(model: string | null | undefined): ModelParam[] {
  const info = modelInfo(model)
  return settableParams(model).filter((p) =>
    p.name !== 'aspect_ratio' && p.name !== 'duration' && !(p.name === 'resolution' && info?.stages)
    // The worker sets Seedance's mode from whether references are attached; editing or
    // extending a video is not something a prompt row does.
    && !(p.name === 'mode' && p.enum?.some((v) => ['t2v', 'omni_reference', 'text-to-video', 'reference-to-video'].includes(String(v))))
    && p.name !== 'extension_mode'
    && !/array|object/.test(String(p.type ?? '')))
}

/** What the worker would do with these references and params: errors block, warnings inform. */
export function checkModelFit(model: string, refs: string[], params: Record<string, unknown>, stage: string | null) {
  return mapParams(modelInfo(model), { refs, params, stage }) as { params: Record<string, unknown>; warnings: string[]; errors: string[] }
}
