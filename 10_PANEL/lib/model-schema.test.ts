import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  isVideo, mapParams, maxRefs, modelKind, modelProblem, summarizeModel, usableModels,
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
