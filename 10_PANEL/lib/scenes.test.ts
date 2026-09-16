import assert from 'node:assert/strict'
import { test } from 'node:test'
import { latestEpisode, previewScenes, sceneFromDocument } from './scenes.ts'
import { assignScenes } from '../worker/lib/scenes.mjs'

const SHOTS = ['SHM-EP001-SC001-SH0010', 'SHM-EP001-SC013-SH0010', 'SHM-EP001-SC012-SH0010_V01_T02.mp4']

test('the document names a scene: full id anywhere, short forms only in the file name or label', () => {
  assert.equal(sceneFromDocument({ file: 'batch-ep001-sc013.json' }, 'EP001'), 'SHM-EP001-SC013-SH0010')
  assert.equal(sceneFromDocument({ label: 'SC7 hall' }, 'EP001'), null)
  assert.equal(sceneFromDocument({ label: 'sc007 hall' }, 'EP002'), 'SHM-EP002-SC007-SH0010')
  assert.equal(sceneFromDocument({ prompt: 'continues from SHM-EP001-SC004-SH0010.' }, 'EP001'), 'SHM-EP001-SC004-SH0010')
  assert.equal(sceneFromDocument({ prompt: 'as in EP001 SC004' }, 'EP001'), null)
  assert.equal(sceneFromDocument({ file: '20260916-1622-prompts.txt', label: 'P14' }, 'EP001'), null)
})

test('latest episode, EP001 when nothing exists yet', () => {
  assert.equal(latestEpisode(SHOTS), 'EP001')
  assert.equal(latestEpisode([...SHOTS, 'SHM-EP002-SC001-SH0010']), 'EP002')
  assert.equal(latestEpisode([]), 'EP001')
})

test('previews count earlier rows and explicit shots in the batch, like the worker', () => {
  const rows = [
    { key: 'a', auto: true, episode: 'EP001', shot: '' },
    { key: 'b', auto: false, episode: 'EP001', shot: 'SHM-EP001-SC015-SH0010' },
    { key: 'c', auto: true, episode: 'EP001', shot: '' },
    { key: 'd', auto: true, episode: 'EP002', shot: '' },
  ]
  const preview = previewScenes(rows, SHOTS)
  assert.deepEqual([...preview], [['a', 'SHM-EP001-SC016-SH0010'], ['c', 'SHM-EP001-SC017-SH0010'], ['d', 'SHM-EP002-SC001-SH0010']])

  const worker = assignScenes(
    rows.filter((r) => r.auto).map((r) => ({ key: r.key, targetId: `NEXT/${r.episode}` })),
    [...SHOTS, 'SHM-EP001-SC015-SH0010'],
  )
  assert.deepEqual([...worker], [...preview])
})
