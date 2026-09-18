import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  blockNumber, episodeLabel, episodeOf, episodesIn, groupByEpisode, longEpisode, nextEpisodeId,
  parseEpisodeDir, promptHandle, shortEpisode,
} from './episodes.ts'

test('the episode of a target, and nothing from another project', () => {
  assert.equal(episodeOf('SHM-EP001-SC004-SH0010', 'SHM'), 'EP001')
  assert.equal(episodeOf('SHM-EP012-SC004-SH0010', 'SHM'), 'EP012')
  assert.equal(episodeOf('SHM-CHR-001-ZAHHAK', 'SHM'), null)
  assert.equal(episodeOf('', 'SHM'), null)
  assert.equal(episodeOf(null, 'SHM'), null)
  assert.equal(episodeOf('SHM-EP001-SC004-SH0010', 'TST'), null)
})

test('EP001 and EP1 are the same episode, written two ways', () => {
  assert.equal(shortEpisode('EP001'), 'EP1')
  assert.equal(shortEpisode('EP012'), 'EP12')
  assert.equal(longEpisode('ep1'), 'EP001')
  assert.equal(longEpisode('EP 12'), 'EP012')
  assert.equal(longEpisode('2'), 'EP002')
  assert.equal(longEpisode('SC001'), null)
})

test('the block number out of a document heading, in either language', () => {
  assert.equal(blockNumber('P01'), 'P01')
  assert.equal(blockNumber('P1'), 'P01')
  assert.equal(blockNumber('PROMPT 3'), 'P03')
  assert.equal(blockNumber('P02 — the hall'), 'P02')
  assert.equal(blockNumber('پرامپت ۴'), 'P04')
  assert.equal(blockNumber('SHOT 2'), null)
  assert.equal(blockNumber('the wide one'), null)
  assert.equal(blockNumber(null), null)
})

test('EP1 P01 is the handle; without a block number the scene stands in', () => {
  assert.equal(promptHandle('EP001', 'P01'), 'EP1 P01')
  assert.equal(promptHandle('EP002', 'PROMPT 12'), 'EP2 P12')
  assert.equal(promptHandle('EP001', null, 'SC004'), 'EP1 SC004')
  // A heading that is not a block number: the scene says more than the words do.
  assert.equal(promptHandle('EP001', 'the wide one', 'SC004'), 'EP1 SC004')
  assert.equal(promptHandle('EP001', 'the wide one', null), 'EP1 the wide one')
  assert.equal(promptHandle(null, 'P01'), 'P01')
})

test('an episode reads with its folder title when it has one', () => {
  assert.equal(episodeLabel('EP001', { EP001: 'Zahhak Entry' }), 'EP1 · Zahhak Entry')
  assert.equal(episodeLabel('EP002', { EP001: 'Zahhak Entry' }), 'EP2')
  assert.equal(episodeLabel(null), 'Not in an episode')
})

test('the folder name carries the id and the title', () => {
  assert.deepEqual(parseEpisodeDir('SHM-EP001-ZAHHAK-ENTRY', 'SHM'), { id: 'EP001', title: 'Zahhak Entry' })
  assert.deepEqual(parseEpisodeDir('SHM-EP002', 'SHM'), { id: 'EP002', title: '' })
  assert.equal(parseEpisodeDir('_TEMPLATE', 'SHM'), null)
  assert.equal(parseEpisodeDir('SHM-EP001-ZAHHAK-ENTRY', 'TST'), null)
})

test('numbers are never reused, so the next episode is past every one that exists', () => {
  assert.equal(nextEpisodeId([]), 'EP001')
  assert.equal(nextEpisodeId(['EP001']), 'EP002')
  // A gap stays a gap: EP002 was used and is gone, the next one is still EP004.
  assert.equal(nextEpisodeId(['EP001', 'EP003']), 'EP004')
})

test('grouping keeps episode order and puts what is not footage last', () => {
  const takes = [
    { id: 'a', target: 'SHM-EP002-SC001-SH0010' },
    { id: 'b', target: 'SHM-CHR-001-ZAHHAK' },
    { id: 'c', target: 'SHM-EP001-SC004-SH0010' },
    { id: 'd', target: 'SHM-EP001-SC001-SH0010' },
  ]
  assert.deepEqual(
    groupByEpisode(takes, (t) => episodeOf(t.target, 'SHM')).map((g) => [g.episode, g.items.map((i) => i.id)]),
    [['EP001', ['c', 'd']], ['EP002', ['a']], [null, ['b']]],
  )
})

test('every episode in play: the ones on disk and the ones only a take points at', () => {
  assert.deepEqual(episodesIn(['EP001'], ['EP002', null, 'EP001', 'nonsense']), ['EP001', 'EP002'])
})
