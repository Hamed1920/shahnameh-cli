import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampDurationOf, durationOptionsOf } from '../worker/lib/model-schema.mjs'

// The rules behind durationOptions / clampDuration in lib/models.ts, on catalogue entries.
const entry = (dur: Record<string, unknown> | null) => ({ job_type: 'm', type: 'video', params: dur ? [{ name: 'duration', type: 'integer', default: 5, required: false, ...dur }] : [] })
const FALLBACK = [5, 10, 15]

test('an enum model offers its own lengths and snaps to the nearest that is not longer', () => {
  const veo = entry({ enum: [4, 6, 8] })
  assert.deepEqual(durationOptionsOf(veo, FALLBACK), { kind: 'enum', values: [4, 6, 8] })
  assert.equal(clampDurationOf(veo, 15, FALLBACK), 8)
  assert.equal(clampDurationOf(veo, 6, FALLBACK), 6)
  assert.equal(clampDurationOf(veo, 5, FALLBACK), 4)
  assert.equal(clampDurationOf(veo, 2, FALLBACK), 4)
})

test('a range model gives bounds and presets inside them, bounds included', () => {
  const seed = entry({ min: 4, max: 30 })
  assert.deepEqual(durationOptionsOf(seed, FALLBACK), { kind: 'range', min: 4, max: 30, presets: [4, 5, 10, 15, 20, 30] })
  const mini = entry({ min: 4, max: 15 })
  assert.deepEqual((durationOptionsOf(mini, FALLBACK) as any).presets, [4, 5, 10, 15])
  const flux = entry({ min: 5, max: 20 })
  assert.deepEqual((durationOptionsOf(flux, FALLBACK) as any).presets, [5, 10, 15, 20])
})

test('clamping into a range keeps 15 where it fits and pulls other lengths to the bound', () => {
  const seed = entry({ min: 4, max: 30 })
  assert.equal(clampDurationOf(seed, 15, FALLBACK), 15)
  assert.equal(clampDurationOf(seed, 7, FALLBACK), 7)
  assert.equal(clampDurationOf(seed, 31, FALLBACK), 30)
  assert.equal(clampDurationOf(seed, 2, FALLBACK), 4)
  assert.equal(clampDurationOf(seed, null, FALLBACK), 15)
  assert.equal(clampDurationOf(entry({ min: 4, max: 10 }), 15, FALLBACK), 10)
})

test('a duration with no list and no limits falls back to the config list', () => {
  const plain = entry({})
  assert.deepEqual(durationOptionsOf(plain, FALLBACK), { kind: 'list', values: FALLBACK })
  assert.equal(clampDurationOf(plain, 15, FALLBACK), 15)
  assert.equal(clampDurationOf(plain, 12, FALLBACK), 10)
  assert.deepEqual(durationOptionsOf(null, FALLBACK), { kind: 'list', values: FALLBACK })
})

test('a model with no duration has none to choose', () => {
  assert.equal(durationOptionsOf(entry(null), FALLBACK), null)
  assert.equal(clampDurationOf(entry(null), 15, FALLBACK), null)
})
