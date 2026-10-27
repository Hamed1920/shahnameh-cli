import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  blockDisplayId, blockInternalId, displayFromInternal, isBlocks, parseBlockDisplayId,
  parseInternalBlockId, sequenceDisplayId, sequenceInternalId, structureLabels, structureOf,
} from './structure.ts'

test('structure defaults to episodes; anything unknown is episodes', () => {
  assert.equal(structureOf({}), 'episodes')
  assert.equal(structureOf(null), 'episodes')
  assert.equal(structureOf({ structure: 'blocks' }), 'blocks')
  assert.equal(structureOf({ structure: 'Blocks' }), 'episodes')
  assert.equal(structureOf({ structure: 7 }), 'episodes')
  assert.equal(isBlocks({ structure: 'blocks' }), true)
  assert.equal(isBlocks({}), false)
})

test('display and internal ids', () => {
  assert.equal(sequenceDisplayId('PD', 1), 'PD-S01')
  assert.equal(sequenceDisplayId('PD', 99), 'PD-S99')
  assert.equal(sequenceDisplayId('PD', 100), 'PD-S100')
  assert.equal(blockDisplayId('PD', 1, 3), 'PD-S01-B003')
  assert.equal(sequenceInternalId('PD', 1), 'PD-EP001')
  assert.equal(blockInternalId('PD', 1, 3), 'PD-EP001-SC003-SH0010')
})

test('round trips, including the bounds', () => {
  for (const [s, b] of [[1, 1], [1, 3], [12, 40], [99, 999], [100, 1], [999, 999]]) {
    assert.deepEqual(parseBlockDisplayId('PD', blockDisplayId('PD', s, b)), { seq: s, block: b })
    assert.deepEqual(parseInternalBlockId('PD', blockInternalId('PD', s, b)), { seq: s, block: b })
    assert.equal(displayFromInternal('PD', blockInternalId('PD', s, b)), blockDisplayId('PD', s, b))
  }
})

test('out of range and malformed ids are rejected', () => {
  assert.equal(parseBlockDisplayId('PD', 'PD-S00-B001'), null)
  assert.equal(parseBlockDisplayId('PD', 'PD-S01-B000'), null)
  assert.equal(parseBlockDisplayId('PD', 'PD-S1000-B001'), null)
  assert.equal(parseBlockDisplayId('PD', 'PD-S01-B1000'), null)
  assert.equal(parseBlockDisplayId('PD', 'XX-S01-B001'), null)
  assert.equal(parseBlockDisplayId('PD', 'PD-S01-B001x'), null)
  assert.equal(parseInternalBlockId('PD', 'PD-EP001-SC003-SH0020'), null)
  assert.equal(parseInternalBlockId('PD', 'PD-EP001-SC003-SH0010-T1'), null)
  assert.equal(parseInternalBlockId('PD', 'PD-EP000-SC003-SH0010'), null)
  assert.equal(parseInternalBlockId('PD', 'PD-EP001-SC000-SH0010'), null)
  assert.equal(displayFromInternal('PD', 'PD-EP001-SC003-SH0020'), null)
  assert.equal(displayFromInternal('PD', 'PD-EP001'), null)
  assert.equal(displayFromInternal('SHM', 'PD-EP001-SC003-SH0010'), null)
})

test('labels follow the structure', () => {
  assert.deepEqual(structureLabels('episodes'), { group: 'Episode', groups: 'Episodes', unit: 'Shot', units: 'Shots' })
  assert.deepEqual(structureLabels('blocks'), { group: 'Sequence', groups: 'Sequences', unit: 'Block', units: 'Blocks' })
})
