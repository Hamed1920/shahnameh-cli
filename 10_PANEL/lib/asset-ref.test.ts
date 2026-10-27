import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetToRef } from './asset-ref.ts'

test('working-space paths have no ref', () => {
  for (const p of [
    '09_OUTPUT/_drafts/x.mp4', '09_OUTPUT/_rejected/x.mp4', '09_OUTPUT/_staging/hf1/T01.png',
    '09_OUTPUT/_uploads/op/u1.png', '09_OUTPUT/_discarded/x.mp4', '09_OUTPUT/_archive/x.png',
  ]) assert.equal(assetToRef(p), null, p)
})

test('a path that climbs out has no ref', () => {
  assert.equal(assetToRef('../secret.png'), null)
  assert.equal(assetToRef('07_EPISODES/SHM-EP013/shots/../../x.mp4'), null)
  assert.equal(assetToRef('07_EPISODES\\SHM-EP013\\..\\x.mp4'), null)
  assert.equal(assetToRef(''), null)
})

test('a filed shot maps to episode, scene, shot and take', () => {
  assert.deepEqual(assetToRef('07_EPISODES/SHM-EP013/shots/SHM-EP013-SC003-SH0010_V01_T02.mp4'), {
    episode: 'EP013', scene: 'SC003', shot: 'SH0010', take: 'SHM-EP013-SC003-SH0010_V01_T02',
  })
  assert.deepEqual(assetToRef('07_EPISODES\\SHM-EP013\\shots\\SHM-EP013-SC001-SH0010_V01.mp4'), {
    episode: 'EP013', scene: 'SC001', shot: 'SH0010', take: 'SHM-EP013-SC001-SH0010_V01',
  })
})

test('an episode folder file maps to its episode only', () => {
  assert.deepEqual(assetToRef('07_EPISODES/SHM-EP001-ZAHHAK-ENTRY/blocks/ZAHHAK_ENTRY_P01.txt'), { episode: 'EP001', take: 'ZAHHAK_ENTRY_P01' })
})

test('an entity look has no episode or shot', () => {
  assert.deepEqual(assetToRef('01_CHARACTERS/SHM-CHR-001-KAVEH_V01.png'), { take: 'SHM-CHR-001-KAVEH_V01' })
})
