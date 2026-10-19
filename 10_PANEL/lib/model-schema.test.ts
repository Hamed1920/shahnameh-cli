import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  isVideo, mapParams, maxRefs, modelKind, modelProblem, parseDurationProbe, parseDurationRules, summarizeModel, usableModels,
} from '../worker/lib/model-schema.mjs'

// Real `model get` answers, captured 2026-09-24 (the stub CLI serves the same file).
const FIXTURE = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'stub-models.json'), 'utf8')).models
const catalog = { fetchedAt: '2026-09-24T00:00:00Z', models: Object.fromEntries(Object.values(FIXTURE).map((s: any) => [s.job_type, summarizeModel(s)])) }
const e = (m: string) => catalog.models[m]
const cfg = { videoDraftResolution: '480p', videoFinalResolution: '1080p', videoDuration: 15, videoSound: true }

test('summaries: reference form, limits, sound and stages come from the schema', () => {
  assert.deepEqual(e('seedance_2_5').refs, { param: 'image_references', max: 30, min: 0 })
  assert.deepEqual(e('seedance_2_5').sound, { param: 'generate_audio', kind: 'bool' })
  assert.deepEqual(e('seedance_2_5').stages, { draft: '480p', final: '1080p', options: ['480p', '720p', '1080p'] })
  assert.deepEqual(e('kling3_0').refs, { param: 'start_image', max: 2, min: 0 })
  assert.deepEqual(e('kling3_0').sound, { param: 'sound', kind: 'onoff' })
  assert.equal(e('kling3_0').stages, null)
  assert.equal(maxRefs(e('nano_banana_pro')), 14)
  assert.equal(maxRefs(e('seedream_v5_pro')), 10)
})

test('a tool is in the catalogue but not usable from a prompt', () => {
  assert.equal(e('image_background_remover').usable, false)
  assert.match(modelProblem(catalog, 'image_background_remover') ?? '', /cannot be used from a prompt/)
  assert.match(modelProblem(catalog, 'no_such_model') ?? '', /not a Higgsfield model/)
  assert.equal(modelProblem(catalog, 'nano_banana_pro'), null)
  assert.deepEqual(usableModels(catalog, 'image', ['nano_banana_pro']).map((m: any) => m.job_type), ['nano_banana_pro', 'seedream_v5_pro'])
})

test('kind: the catalogue decides, the name rule only when it does not know the model', () => {
  assert.equal(isVideo(catalog, 'kling3_0'), true)
  assert.equal(modelKind(catalog, 'nano_banana_pro'), 'image')
  assert.equal(modelKind(null, 'minimax_h3'), 'video')
  assert.equal(modelKind(null, 'gpt_image_2'), 'image')
})

test('seedance: references as a list switch the mode to omni_reference; none means t2v', () => {
  const withRefs = mapParams(e('seedance_2_5'), { refs: ['a.png', 'b.png'], params: { aspect_ratio: '16:9', generate_audio: 'false' }, stage: 'draft', cfg })
  assert.deepEqual(withRefs.errors, [])
  assert.deepEqual(withRefs.params.image_references, ['a.png', 'b.png'])
  assert.equal(withRefs.params.mode, 'omni_reference')
  assert.equal(withRefs.params.generate_audio, false)
  assert.equal(withRefs.params.resolution, '480p')
  assert.equal(withRefs.params.duration, 15)
  const bare = mapParams(e('seedance_2_5'), { refs: [], params: {}, stage: 'final', cfg })
  assert.equal(bare.params.mode, 't2v')
  assert.equal(bare.params.generate_audio, true)
  assert.equal(bare.params.resolution, '1080p')
})

test('kling: the first reference is the start frame, sound is on|off, a third reference is refused', () => {
  const r = mapParams(e('kling3_0'), { refs: ['start.png'], params: { generate_audio: true, aspect_ratio: '4:3' }, stage: null, cfg })
  assert.equal(r.params.start_image, 'start.png')
  assert.equal(r.params.image_references, undefined)
  assert.equal(r.params.sound, 'on')
  assert.equal(r.params.generate_audio, undefined)
  // 4:3 is not a Kling ratio: its default instead, and a warning saying so.
  assert.equal(r.params.aspect_ratio, '16:9')
  assert.match(r.warnings.join(' '), /aspect_ratio/)
  assert.match(mapParams(e('kling3_0'), { refs: ['a', 'b', 'c'], cfg }).errors.join(' '), /at most 2/)
})

test('image models: no sound, no duration, and the reference cap from their rules', () => {
  const ok = mapParams(e('nano_banana_pro'), { refs: ['x.png'], params: { aspect_ratio: '1:1', resolution: '4k', duration: 5 }, cfg })
  assert.deepEqual(ok.params, { aspect_ratio: '1:1', resolution: '4k', image_references: ['x.png'] })
  assert.match(ok.warnings.join(' '), /no duration/)
  const tooMany = mapParams(e('nano_banana_pro'), { refs: Array.from({ length: 15 }, (_, i) => `${i}.png`), cfg })
  assert.match(tooMany.errors.join(' '), /at most 14/)
})

test('no catalogue entry: params pass through with the references attached, as before', () => {
  const r = mapParams(null, { refs: ['a.png'], params: { aspect_ratio: '16:9' }, cfg: { ...cfg, model: 'seedance_9' } })
  assert.deepEqual(r.params, { aspect_ratio: '16:9', generate_audio: true, image_references: ['a.png'] })
})

test('duration limits: read from rule CEL and messages, and from a price probe\'s error', () => {
  assert.deepEqual(parseDurationRules([{ cel: 'params.duration >= 3', message: '' }, { cel: 'params.duration <= 15', message: '' }]), { min: 3, max: 15 })
  // wan3_0, as Higgsfield words it
  assert.deepEqual(
    parseDurationRules([{ cel: 'params.duration == -1 || params.duration >= 2', message: 'duration must be -1 (smart duration) or between 2 and 30' }]),
    { min: 2, max: 30, smart: true })
  assert.deepEqual(parseDurationRules([{ cel: 'size(params.image_references) <= 50', message: 'at most 50 reference media items are allowed in total' }]), {})
  assert.deepEqual(parseDurationProbe('Error: duration: Input should be greater than or equal to 4'), { min: 4 })
  assert.deepEqual(parseDurationProbe('Error: duration: Input should be less than or equal to 30'), { max: 30 })
  assert.deepEqual(parseDurationProbe('Error: duration: Input should be greater than or equal to 4\nInput should be less than or equal to 30'), { min: 4, max: 30 })
  assert.deepEqual(parseDurationProbe('Error: No workspace selected.'), {})
  assert.deepEqual(parseDurationProbe(undefined), {})
})

const rangeModel = (extra: Record<string, unknown> = {}, rules: unknown[] = []) => summarizeModel({
  job_type: 'range_video', display_name: 'Range video', type: 'video', rules,
  params: [
    { name: 'prompt', type: 'string', required: true },
    { name: 'duration', type: 'integer', default: 5, required: false, ...extra },
  ],
})

test('summaries keep each rule\'s message beside its cel, and a duration\'s bounds from the rules', () => {
  const s = rangeModel({}, [{ cel: 'params.duration == -1 || params.duration >= 2', message: 'duration must be -1 (smart duration) or between 2 and 30' }])
  assert.deepEqual(s.rules, ['params.duration == -1 || params.duration >= 2'])
  assert.match(s.ruleDetails[0].message, /between 2 and 30/)
  const d = s.params.find((p: any) => p.name === 'duration')
  assert.deepEqual([d.min, d.max, d.smart], [2, 30, true])
  assert.equal(e('seedance_2_5').ruleDetails.length, e('seedance_2_5').rules.length)
})

test('mapParams passes lengths inside a range and clamps those outside it, saying so', () => {
  const m = rangeModel({ min: 4, max: 30 })
  assert.equal(mapParams(m, { params: { duration: 7 }, cfg }).params.duration, 7)
  assert.equal(mapParams(m, { params: { duration: 30 }, cfg }).params.duration, 30)
  const over = mapParams(m, { params: { duration: 31 }, cfg })
  assert.equal(over.params.duration, 30)
  assert.match(over.warnings.join(' '), /takes 4-30 s; using 30/)
  assert.equal(mapParams(m, { params: { duration: 2 }, cfg }).params.duration, 4)
  // the configured default is clamped too
  assert.equal(mapParams(rangeModel({ min: 4, max: 10 }), { params: {}, cfg }).params.duration, 10)
  // smart duration stays where the model allows it
  assert.equal(mapParams(rangeModel({ min: 2, max: 30, smart: true }), { params: { duration: -1 }, cfg }).params.duration, -1)
})
