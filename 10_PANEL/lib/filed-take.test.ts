import assert from 'node:assert/strict'
import { test } from 'node:test'
import { episodeDirFor, rebaseFiledPath, takeNumber } from './filed-take.ts'

const dirs = ['SHM-EP013-X', 'SHM-EP014-JAMSHID-S-DOUGHTERS', 'SHM-EP0140-OTHER', 'SHM-EP015']
const file = 'SHM-EP014-SC001-SH0010_V01.mp4'

test('EP014 maps to its dir and not EP0140', () => {
  assert.equal(episodeDirFor('SHM', 'EP014', dirs), 'SHM-EP014-JAMSHID-S-DOUGHTERS')
  assert.equal(episodeDirFor('SHM', 'SHM-EP014', dirs), 'SHM-EP014-JAMSHID-S-DOUGHTERS')
  assert.equal(episodeDirFor('SHM', 'EP015', dirs), 'SHM-EP015')
  assert.equal(episodeDirFor('SHM', 'EP099', dirs), null)
})

test('a stale path rebases', () => {
  assert.equal(
    rebaseFiledPath(`07_EPISODES/SHM-EP014-JAMSHID-GIRLS/shots/${file}`.replaceAll('/', String.fromCharCode(92)), dirs, 'SHM'),
    `07_EPISODES/SHM-EP014-JAMSHID-S-DOUGHTERS/shots/${file}`,
  )
})

test('a path whose dir exists is untouched', () => {
  assert.equal(rebaseFiledPath(`07_EPISODES/SHM-EP015/shots/x.mp4`, dirs, 'SHM'), null)
})

test('a backslash path works', () => {
  assert.equal(
    rebaseFiledPath(`07_EPISODES/SHM-EP014-JAMSHID-GIRLS/shots/${file}`.replaceAll('/', '\\'), dirs, 'SHM'),
    `07_EPISODES/SHM-EP014-JAMSHID-S-DOUGHTERS/shots/${file}`,
  )
})

test('episode is taken from the file name when the dir has no id', () => {
  assert.equal(
    rebaseFiledPath(`07_EPISODES/old-name/shots/${file}`, dirs, 'SHM'),
    `07_EPISODES/SHM-EP014-JAMSHID-S-DOUGHTERS/shots/${file}`,
  )
})

test('no match gives null', () => {
  assert.equal(rebaseFiledPath('07_EPISODES/SHM-EP099-GONE/shots/SHM-EP099-SC001-SH0010_V01.mp4', dirs, 'SHM'), null)
  assert.equal(rebaseFiledPath('09_OUTPUT/_drafts/a/b.mp4', dirs, 'SHM'), null)
})

test('takeNumber orders takes', () => {
  const stem = 'SHM-EP014-SC001-SH0010_V01'
  assert.equal(takeNumber(`${stem}.mp4`, stem), 1)
  assert.equal(takeNumber(`${stem}_T02.mp4`, stem), 2)
  assert.equal(takeNumber(`${stem}_T10.mp4`, stem), 10)
})
