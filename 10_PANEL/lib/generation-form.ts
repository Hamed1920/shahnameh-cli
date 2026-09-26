import { Invalid } from './uploads'
import {
  aspectRatiosFor, durationsFor, extraParams, hasDraft, hasSound, isVideoModel, modelInfo, modelProblemOf, refLimit,
} from './models'

/**
 * The model and its settings from a generation dialog's form (Regenerate,
 * Generate from scratch, the reference studio), checked against the model
 * catalogue: a model a prompt can use, an aspect ratio and duration that model
 * takes, and its own settings (`extra`, JSON) only where it has them. Throws
 * Invalid with a sentence for the dialog.
 */
export interface GenerationForm {
  model: string
  video: boolean
  stage: 'draft' | 'final' | null
  sound: boolean | null
  params: Record<string, string | number | boolean>
}

export function readGenerationForm(formData: FormData, cfg: Record<string, unknown>): GenerationForm {
  const model = String(formData.get('model') ?? '').trim()
  if (!model) throw new Invalid('Choose a model.')
  const why = modelProblemOf(model)
  if (why) throw new Invalid(why)
  const video = isVideoModel(model)

  const params: Record<string, string | number | boolean> = {}
  const aspect = String(formData.get('aspect_ratio') ?? '').trim()
  if (aspect) {
    const allowed = aspectRatiosFor(model, (cfg.aspectRatios as string[] | undefined) ?? [])
    if (allowed.length && !allowed.includes(aspect)) throw new Invalid(`${model} takes the aspect ratios ${allowed.join(', ')}, not ${aspect}.`)
    params.aspect_ratio = aspect
  }

  let stage: GenerationForm['stage'] = null
  let sound: boolean | null = null
  if (video) {
    if (hasDraft(model)) {
      const s = String(formData.get('stage') ?? '')
      stage = s === 'final' ? 'final' : s === 'draft' ? 'draft' : null
    }
    const durations = durationsFor(model, (cfg.videoDurations as number[] | undefined) ?? [])
    const duration = Number(formData.get('duration') ?? '')
    if (durations && Number.isFinite(duration) && duration > 0) params.duration = duration
    if (hasSound(model)) sound = formData.get('sound') === 'on'
  }

  const raw = formData.get('extra')
  if (raw) {
    let extra: unknown
    try { extra = JSON.parse(String(raw)) } catch { throw new Invalid('Malformed model settings.') }
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Invalid('Malformed model settings.')
    const known = new Map(extraParams(model).map((p) => [p.name, p]))
    for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
      const p = known.get(k)
      if (!p) throw new Invalid(`${model} has no setting ${k}.`)
      const s = String(v ?? '').trim()
      if (!s) continue
      if (p.enum && !p.enum.map(String).includes(s)) throw new Invalid(`${k} is one of ${p.enum.join(', ')}.`)
      if (/integer|number/.test(String(p.type ?? ''))) {
        const n = Number(s)
        if (!Number.isFinite(n)) throw new Invalid(`${k} is a number.`)
        params[k] = n
      } else if (String(p.type ?? '').startsWith('boolean')) params[k] = s === 'true'
      else params[k] = s.slice(0, 200)
    }
  }
  return { model, video, stage, sound, params }
}

/** The reference count the model takes; 0 when it takes none. */
export function checkRefCount(model: string, count: number) {
  // A model the catalogue does not know (no list fetched yet): the old limit of 12.
  const max = modelInfo(model) ? refLimit(model) : 12
  if (count > 0 && max === 0) throw new Invalid(`${model} takes no reference images.`)
  if (count > max) throw new Invalid(`${model} takes at most ${max} reference image${max === 1 ? '' : 's'}.`)
}
