import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDuration, checkTitle, orderAfterMove, sameIds } from './pd-order.ts'
import { blockTargetToInternal, workerTarget } from './block-target.ts'

test('orderAfterMove swaps neighbours and clamps at the ends', () => {
  const ids = ['a', 'b', 'c']
  assert.deepEqual(orderAfterMove(ids, 'b', 'up'), ['b', 'a', 'c'])
  assert.deepEqual(orderAfterMove(ids, 'b', 'down'), ['a', 'c', 'b'])
  assert.deepEqual(orderAfterMove(ids, 'a', 'up'), ['a', 'b', 'c'])
  assert.deepEqual(orderAfterMove(ids, 'c', 'down'), ['a', 'b', 'c'])
  assert.deepEqual(orderAfterMove(ids, 'zzz', 'up'), ['a', 'b', 'c'])
  assert.deepEqual(ids, ['a', 'b', 'c'])
})

test('checkTitle trims, collapses spaces and bounds length', () => {
  assert.deepEqual(checkTitle('  Dawn   scene '), { ok: true, title: 'Dawn scene' })
  assert.equal(checkTitle('   ').ok, false)
  assert.equal(checkTitle('x'.repeat(120)).ok, true)
  assert.equal(checkTitle('x'.repeat(121)).ok, false)
})

test('checkDuration is 1..600 whole seconds, empty is null', () => {
  assert.deepEqual(checkDuration(''), { ok: true, seconds: null })
  assert.deepEqual(checkDuration('15'), { ok: true, seconds: 15 })
  assert.equal(checkDuration(0).ok, false)
  assert.equal(checkDuration(601).ok, false)
  assert.equal(checkDuration(1.5).ok, false)
  assert.equal(checkDuration('abc').ok, false)
})

test('sameIds needs the same members, each once', () => {
  assert.equal(sameIds(['a', 'b'], ['b', 'a']), true)
  assert.equal(sameIds(['a', 'b'], ['a', 'a']), false)
  assert.equal(sameIds(['a'], ['a', 'b']), false)
})

test('block display ids become internal shot ids; anything else is untouched', () => {
  assert.equal(blockTargetToInternal('PD', 'PD-S01-B003'), 'PD-EP001-SC003-SH0010')
  assert.equal(blockTargetToInternal('PD', ' PD-S12-B120 '), 'PD-EP012-SC120-SH0010')
  assert.equal(blockTargetToInternal('PD', 'PD-EP001-SC003-SH0010'), null)
  assert.equal(workerTarget('PD', 'PD-S01-B003'), 'PD-EP001-SC003-SH0010')
  assert.equal(workerTarget('PD', 'PD-EP001-SC003-SH0010'), 'PD-EP001-SC003-SH0010')
  assert.equal(workerTarget('PD', 'PD-S00-B003'), 'PD-S00-B003')
})
