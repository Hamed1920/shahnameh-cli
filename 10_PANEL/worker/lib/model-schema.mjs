/**
 * What each Higgsfield model accepts, and how a job's intent (prompt, reference
 * images, sound, draft/final, aspect ratio) becomes the params that model takes.
 *
 * Pure. The catalogue itself (worker/MODEL_CATALOG.json) is fetched by
 * models.mjs from `higgsfield model list` / `model get`; everything here takes
 * it as an argument, so the panel (lib/models.ts) and the worker share one set
 * of rules instead of a regex copied into five files.
 *
 * Models differ more than the names suggest (captured 2026-09-24):
 *   seedance_2_5   image_references[] + generate_audio + mode t2v|omni_reference
 *   kling3_0       start_image only, sound on|off, mode std|pro|4k (quality, not refs)
 *   kling2_6       start_image only, sound boolean
 *   veo3           start_image REQUIRED
 *   nano_banana_pro image_references[] up to 14
 */

/** Only when no catalogue exists yet: the old name rule, kept as a fallback. */
export const VIDEO_NAME_RX = /^(seedance|kling|veo|wan|hailuo|minimax|grok_video|gemini_omni|flux_3_video|happy_horse)/

/** Params the job fills itself; never shown as a setting. */
export const INTERNAL_PARAMS = new Set([
  'prompt', 'image_references', 'start_image', 'end_image', 'video_references', 'audio_references',
  'folder_id', 'mask', 'is_inpaint', 'input_video', 'urls', 'custom_reference_id', 'style_id', 'seed',
])

/** A required param in this list can be filled from a job; any other makes the model unusable here. */
const FILLABLE_REQUIRED = new Set(['prompt', 'aspect_ratio', 'image_references', 'start_image', 'mode'])

const REF_MODES = ['omni_reference', 'reference-to-video']
const T2V_MODES = ['t2v', 'text-to-video']

const resNumber = (v) => {
  const m = String(v).match(/^(\d+(?:\.\d+)?)\s*([pk])?$/i)
  if (!m) return NaN
  return m[2]?.toLowerCase() === 'k' ? Number(m[1]) * 1000 : Number(m[1])
}

/**
 * Condense a `model get --json` answer into a catalogue entry. Keeps the raw
 * params (name, type, default, required, enum) so the panel can draw a form.
 */
export function summarizeModel(schema) {
  const params = (schema.params ?? []).map((p) => ({
    name: p.name,
    type: p.type,
    default: p.default ?? null,
    required: Boolean(p.required),
    ...(Array.isArray(p.enum) && { enum: p.enum.map((e) => (typeof e === 'number' ? e : String(e))) }),
  }))
  const rules = (schema.rules ?? []).map((r) => String(r.cel ?? ''))
  const has = (n) => params.some((p) => p.name === n)
  const param = (n) => params.find((p) => p.name === n)

  // Reference images: a list if the model has one, else a first frame.
  let refs = null
  if (has('image_references')) {
    let max = null
    let min = 0
    for (const raw of rules) {
      // A job sends image references only: no video or audio, no frames. So
      // `size(video_references) > 0 || X` binds X, `size(video_references) == 0 || X`
      // never binds, and in a sum of reference counts every other term is 0.
      let cel = raw.trim()
      const cond = cel.match(/^size\(params\.video_references\)\s*(>\s*0|==\s*0)\s*\|\|\s*(.+)$/)
      if (cond) {
        if (/==/.test(cond[1])) continue
        cel = cond[2].trim()
      }
      const sum = cel.match(/^(.+?)\s*<=\s*(\d+)$/)
      if (sum && /size\(params\.image_references\)/.test(sum[1])) {
        const terms = sum[1].split('+').map((t) => t.trim())
        const known = terms.every((t) => /^\(*size\(params\.(image|video|audio)_references\)\)*$/.test(t) || /^\(*params\.(start|end)_image\b/.test(t) || /^[?:0-1\s)]+$/.test(t))
        if (known) { const n = Number(sum[2]); max = max == null ? n : Math.min(max, n) }
      }
      const eq = cel.match(/^size\(params\.image_references\)\s*==\s*(\d+)$/)
      if (eq) { max = Number(eq[1]); min = Number(eq[1]) }
      const ge = raw.match(/^size\(params\.image_references\)\s*>=\s*(\d+)$/)
      if (ge) min = Math.max(min, Number(ge[1]))
    }
    if (param('image_references')?.required) min = Math.max(min, 1)
    refs = { param: 'image_references', max: max ?? 12, min }
  } else if (has('start_image')) {
    refs = { param: 'start_image', max: has('end_image') ? 2 : 1, min: param('start_image')?.required ? 1 : 0 }
  }

  let sound = null
  const ga = param('generate_audio')
  const sd = param('sound')
  if (ga) sound = { param: 'generate_audio', kind: 'bool' }
  else if (sd?.enum?.includes('on')) sound = { param: 'sound', kind: 'onoff' }
  else if (sd) sound = { param: 'sound', kind: 'bool' }

  // Draft/final only where there is a resolution to step between, and only for video.
  let stages = null
  const res = param('resolution')
  if (schema.type === 'video' && res?.enum && res.enum.length >= 2) {
    const sorted = [...res.enum].map(String).filter((v) => Number.isFinite(resNumber(v))).sort((a, b) => resNumber(a) - resNumber(b))
    if (sorted.length >= 2) stages = { draft: sorted[0], final: sorted[sorted.length - 1], options: sorted }
  }

  // Usable from a prompt: it takes a prompt, and nothing it requires is
  // something a job cannot give (a video to edit, output sizes, a preset id).
  let usable = true
  let why = null
  if (schema.type !== 'image' && schema.type !== 'video') { usable = false; why = `a ${schema.type} model` }
  else if (!has('prompt')) { usable = false; why = 'takes no prompt (a tool, not a generator)' }
  else {
    const blocker = params.find((p) => p.required && !FILLABLE_REQUIRED.has(p.name))
    if (blocker) { usable = false; why = `requires ${blocker.name}` }
    else if (rules.some((c) => /^size\(params\.video_references\)\s*(==|>=)\s*[1-9]/.test(c))) { usable = false; why = 'edits a video' }
  }

  return {
    job_type: schema.job_type,
    display_name: schema.display_name ?? schema.job_type,
    type: schema.type,
    usable,
    ...(why && { why }),
    params,
    rules,
    refs,
    sound,
    stages,
  }
}

/** The catalogue entry for a model, or null. */
export function modelEntry(catalog, model) {
  return catalog?.models?.[String(model ?? '')] ?? null
}

/** 'image' | 'video' | null. The name rule only when the catalogue does not know the model. */
export function modelKind(catalog, model) {
  const e = modelEntry(catalog, model)
  if (e) return e.type === 'video' || e.type === 'image' ? e.type : null
  if (!model) return null
  return VIDEO_NAME_RX.test(String(model)) ? 'video' : 'image'
}

export const isVideo = (catalog, model) => modelKind(catalog, model) === 'video'

/** Models a prompt can use, pinned first, then by display name. */
export function usableModels(catalog, kind, pinned = []) {
  const all = Object.values(catalog?.models ?? {}).filter((m) => m.usable && (!kind || m.type === kind))
  const rank = (m) => { const i = pinned.indexOf(m.job_type); return i < 0 ? Infinity : i }
  return all.sort((a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name) || a.job_type.localeCompare(b.job_type))
}

/** Most reference images this model takes, or 0. */
export function maxRefs(entry) {
  return entry?.refs?.max ?? 0
}

/** Is `model` allowed for a job at all? Returns a reason when it is not. */
export function modelProblem(catalog, model) {
  if (!model) return 'no model'
  if (!catalog?.models) return null // no catalogue yet: the CLI's own price check is the gate
  const e = modelEntry(catalog, model)
  if (!e) return `${model} is not a Higgsfield model (refresh the model list if it is new)`
  if (!e.usable) return `${e.display_name} (${model}) cannot be used from a prompt: ${e.why}`
  return null
}

const truthy = (v) => v === true || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'on'

/** The sound a job asks for: true, false, or undefined when it says nothing. */
export function soundIntent(params) {
  const v = params?.generate_audio ?? params?.sound
  if (v === undefined || v === null || v === '') return undefined
  return truthy(v)
}

/**
 * Turn a job's params and references into what this model takes.
 *
 *   refs    reference file paths (or tokens) in the order the model should see them
 *   params  the job's params: aspect_ratio, duration, resolution, sound intent
 *           (generate_audio or sound), mode, and any model-specific extras
 *   stage   'draft' | 'final' | null; picks the resolution for video
 *
 * Returns { params, warnings, errors }. `params` never contains `prompt`. With
 * no catalogue entry the params pass through with only the reference list
 * attached, which is how every job worked before the catalogue existed.
 *
 * @param {any} entry
 * @param {{ refs?: string[], params?: Record<string, any>, stage?: string | null, cfg?: Record<string, any> }} [opts]
 * @returns {{ params: Record<string, any>, warnings: string[], errors: string[] }}
 */
export function mapParams(entry, { refs = [], params = {}, stage = null, cfg = {} } = {}) {
  const warnings = []
  const errors = []
  const inParams = { ...params }
  const wantSound = soundIntent(inParams)
  delete inParams.generate_audio
  delete inParams.sound

  if (!entry) {
    const out = { ...inParams }
    if (wantSound !== undefined || VIDEO_NAME_RX.test(String(cfg.model ?? ''))) out.generate_audio = wantSound ?? (cfg.videoSound ?? true)
    if (refs.length) out.image_references = [...refs]
    return { params: out, warnings, errors }
  }

  const byName = new Map(entry.params.map((p) => [p.name, p]))
  const out = {}

  for (const [k, v] of Object.entries(inParams)) {
    if (v === undefined || v === null || v === '') continue
    const p = byName.get(k)
    if (!p || INTERNAL_PARAMS.has(k)) { warnings.push(`${entry.job_type} has no ${k}; dropped`); continue }
    if (p.enum && !p.enum.map(String).includes(String(v))) {
      const fallback = p.default ?? p.enum[0]
      warnings.push(`${entry.job_type} takes ${k} ${p.enum.join(' / ')}, not ${v}; using ${fallback}`)
      out[k] = fallback
      continue
    }
    out[k] = p.type === 'integer' || p.type === 'number' ? (Number(v) || v) : p.type === 'boolean' ? truthy(v) : v
  }

  // Duration: an enumerated list snaps to the closest length that is not longer.
  const dur = byName.get('duration')
  if (dur && out.duration === undefined && entry.type === 'video' && cfg.videoDuration) out.duration = cfg.videoDuration
  if (dur?.enum && out.duration !== undefined && !dur.enum.map(String).includes(String(out.duration))) {
    const nums = dur.enum.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    const pick = [...nums].reverse().find((n) => n <= Number(out.duration)) ?? nums[0]
    warnings.push(`${entry.job_type} takes ${nums.join('/')} s; using ${pick}`)
    out.duration = pick
  }
  if (dur && !dur.enum && out.duration !== undefined) out.duration = Number(out.duration)

  // Resolution follows the stage for video, unless the job pinned one.
  if (entry.stages && stage && out.resolution === undefined) {
    out.resolution = stage === 'final'
      ? (entry.stages.options.includes(cfg.videoFinalResolution) ? cfg.videoFinalResolution : entry.stages.final)
      : (entry.stages.options.includes(cfg.videoDraftResolution) ? cfg.videoDraftResolution : entry.stages.draft)
  }

  // Sound: on for every video unless the job says otherwise, in whatever form the model takes.
  if (entry.sound) {
    const on = wantSound ?? (entry.type === 'video' ? (cfg.videoSound ?? true) : undefined)
    if (on !== undefined) out[entry.sound.param] = entry.sound.kind === 'onoff' ? (on ? 'on' : 'off') : on
  } else if (wantSound === true && entry.type === 'video') {
    warnings.push(`${entry.job_type} has no sound setting`)
  }

  // References.
  if (refs.length) {
    if (!entry.refs) errors.push(`${entry.display_name} takes no reference images; remove the ${refs.length} attached`)
    else if (refs.length > entry.refs.max) errors.push(`${entry.display_name} takes at most ${entry.refs.max} reference image${entry.refs.max === 1 ? '' : 's'}; ${refs.length} attached`)
    else if (entry.refs.param === 'image_references') out.image_references = [...refs]
    else {
      out.start_image = refs[0]
      if (refs[1]) out.end_image = refs[1]
    }
  }
  if (entry.refs && refs.length < entry.refs.min) {
    errors.push(`${entry.display_name} needs at least ${entry.refs.min} reference image${entry.refs.min === 1 ? '' : 's'}`)
  }

  // Mode: some models refuse references in text-to-video mode and demand them in reference mode.
  const mode = byName.get('mode')
  if (mode?.enum) {
    const refMode = REF_MODES.find((m) => mode.enum.includes(m))
    const t2vMode = T2V_MODES.find((m) => mode.enum.includes(m))
    const isRefOrT2v = out.mode === undefined || REF_MODES.includes(out.mode) || T2V_MODES.includes(out.mode)
    if (isRefOrT2v && refMode && t2vMode && entry.refs?.param === 'image_references') {
      out.mode = refs.length ? refMode : t2vMode
    } else if (out.mode === undefined && mode.required) {
      out.mode = mode.default ?? mode.enum[0]
    }
  }

  return { params: out, warnings, errors }
}

/** The sound a sent params object carries, whatever the model calls it. */
export function soundOf(entry, params) {
  if (!params) return undefined
  const key = entry?.sound?.param ?? 'generate_audio'
  const v = params[key]
  if (v === undefined || v === null || v === '') return undefined
  return truthy(v)
}
