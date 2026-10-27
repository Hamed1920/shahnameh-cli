import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetToRef } from './asset-ref.ts'
import { refCovers, shotRefOf, validRef } from './release-match.ts'

const file = '07_EPISODES/SHM-EP013/shots/SHM-EP013-SC003-SH0010_V01_T02.mp4'
const ref = assetToRef(file)!

test('a take release matches only that take', () => {
  assert.equal(refCovers([{ kind: 'take', ref: 'SHM-EP013-SC003-SH0010_V01_T02' }], ref), true)
  assert.equal(refCovers([{ kind: 'take', ref: 'SHM-EP013-SC003-SH0010_V01_T03' }], ref), false)
})

test('a shot release needs the scene as well: SH0010 exists in every scene', () => {
  assert.equal(shotRefOf(ref), 'EP013-SC003-SH0010')
  assert.equal(refCovers([{ kind: 'shot', ref: 'EP013-SC003-SH0010' }], ref), true)
  assert.equal(refCovers([{ kind: 'shot', ref: 'EP013-SC004-SH0010' }], ref), false)
  assert.equal(refCovers([{ kind: 'shot', ref: 'EP012-SC003-SH0010' }], ref), false)
})

test('an episode release covers its takes and nobody else', () => {
  assert.equal(refCovers([{ kind: 'episode', ref: 'EP013' }], ref), true)
  assert.equal(refCovers([{ kind: 'episode', ref: 'EP001' }], ref), false)
  assert.equal(refCovers([{ kind: 'episode', ref: 'EP013' }], assetToRef('01_CHARACTERS/SHM-CHR-001-KAVEH/hero.png')!), false)
})

test('nothing released covers nothing, and any of several releases will do', () => {
  assert.equal(refCovers([], ref), false)
  assert.equal(refCovers([{ kind: 'episode', ref: 'EP001' }, { kind: 'shot', ref: 'EP013-SC003-SH0010' }], ref), true)
})

test('working-space paths never map to a ref, so nothing can release them', () => {
  assert.equal(assetToRef('09_OUTPUT/_drafts/hf1/T01.mp4'), null)
})

test('refs are checked by kind', () => {
  assert.equal(validRef('take', 'SHM-EP013-SC003-SH0010_V01'), true)
  assert.equal(validRef('take', '../x'), false)
  assert.equal(validRef('take', 'a/b'), false)
  assert.equal(validRef('shot', 'EP013-SC003-SH0010'), true)
  assert.equal(validRef('shot', 'SH0010'), false)
  assert.equal(validRef('episode', 'EP013'), true)
  assert.equal(validRef('episode', 'EP13'), false)
  assert.equal(validRef('other', 'EP013'), false)
})
