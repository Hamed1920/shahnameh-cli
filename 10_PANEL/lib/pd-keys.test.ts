import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayOf, projectOf, scopedKey } from './pd/keys.ts'

test('a key keeps projects apart and gives the display id back', () => {
  const a = scopedKey('persimmon-e2e', 'PD-S01-B001')
  const b = scopedKey('persimmon-two', 'PD-S01-B001')
  assert.notEqual(a, b)
  assert.equal(displayOf(a), 'PD-S01-B001')
  assert.equal(projectOf(b), 'persimmon-two')
  assert.equal(displayOf('PD-S01'), 'PD-S01')
  assert.equal(projectOf('PD-S01'), null)
})
