import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPlaylist, chooseSource, inFilmOrder, playlistCounts, type PlaylistBlock } from './sequence-playlist.ts'

const blk = (n: number, over: Partial<PlaylistBlock> = {}): PlaylistBlock => ({
  id: `PD-S01-B00${n}`, title: `Block ${n}`, number: n, displayOrder: n, active: null, final: null, accepted: null, ...over,
})
const sub = (id: string, round = 1, g = 'G01') => ({ submissionId: id, round, gLabel: g })

test('blocks play in display order, not number or arrival order', () => {
  const out = inFilmOrder([blk(1, { displayOrder: 3 }), blk(2, { displayOrder: 1 }), blk(3, { displayOrder: 2 })])
  assert.deepEqual(out.map((b) => b.number), [2, 3, 1])
})

test('a block that was never sent is a visible gap, in its place', () => {
  const stops = buildPlaylist('pd', [blk(1, { active: sub('a') }), blk(2), blk(3, { active: sub('c', 2, 'G07') })], 'submitted', (id) => `/x/${id}`)
  assert.deepEqual(stops.map((s) => s.id), ['PD-S01-B001', 'PD-S01-B002', 'PD-S01-B003'])
  assert.equal(stops[1].gap, true)
  assert.equal(stops[1].title, 'PD-S01-B002 — not sent yet')
  assert.equal(stops[1].options.length, 0)
  assert.equal(stops[2].title, 'PD-S01-B003 · Round 2 · G07')
  assert.equal(stops[2].options[0].url, '/pd/api/review-media/c')
  assert.deepEqual(playlistCounts(stops), { playable: 2, gaps: 1 })
})

test('submitted mode ignores a Final and an accepted file; only submissions play', () => {
  const b = blk(1, { final: { submissionId: 'f', round: 1, gLabel: 'G02' }, accepted: { file: 'a.mp4', gLabel: 'G03' } })
  assert.deepEqual(chooseSource(b, 'submitted'), { kind: 'none' })
  assert.equal(chooseSource({ ...b, active: sub('s') }, 'submitted').kind, 'submission')
})

test('best available: Final, then the active submission, then the latest accepted file', () => {
  const accepted = { file: '09_OUTPUT/a.mp4', gLabel: 'G03' }
  const final = { submissionId: 'f', round: 1, gLabel: 'G02' }
  const withAll = blk(1, { final, active: sub('s', 2), accepted })
  assert.deepEqual(chooseSource(withAll, 'best'), { kind: 'submission', submissionId: 'f', label: 'Final · Round 1 · G02' })
  assert.equal((chooseSource({ ...withAll, final: null }, 'best') as { submissionId: string }).submissionId, 's')
  assert.deepEqual(chooseSource({ ...withAll, final: null, active: null }, 'best'), { kind: 'file', file: accepted.file, label: 'Accepted · G03' })
  assert.deepEqual(chooseSource(blk(1), 'best'), { kind: 'none' })
  const stops = buildPlaylist('pd', [blk(1, { accepted })], 'best', () => '#')
  assert.equal(stops[0].options[0].url, undefined)
  assert.equal(stops[0].options[0].file, accepted.file)
})
