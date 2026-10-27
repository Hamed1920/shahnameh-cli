import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildApprovalOps, canDecide, canPresent, categoryOf, decisionProblem, groupByCategory,
} from './pd-category.ts'

test('categories: CHR, LOC, REF/FX and STATE-', () => {
  assert.equal(categoryOf('CHR', 'HERO'), 'characters')
  assert.equal(categoryOf('LOC', 'TEMPLE'), 'locations')
  assert.equal(categoryOf('REF', 'MOODBOARD'), 'references')
  assert.equal(categoryOf('FX', 'SMOKE'), 'references')
  assert.equal(categoryOf('REF', 'STATE-WOUNDED'), 'states')
  assert.equal(categoryOf('FX', 'state-burning'), 'states')
  assert.equal(categoryOf('REF', 'STATEMENT'), 'references')
  assert.equal(categoryOf('CHR', 'STATE-X'), 'characters')
  assert.equal(categoryOf('PRP', 'SWORD'), 'other')
  assert.equal(categoryOf('COS', 'ROBE'), 'other')
})

test('groupByCategory fills every group', () => {
  const g = groupByCategory([{ kind: 'CHR', slug: 'A' }, { kind: 'REF', slug: 'STATE-B' }, { kind: 'VEH', slug: 'C' }])
  assert.equal(g.characters.length, 1)
  assert.equal(g.states.length, 1)
  assert.equal(g.other.length, 1)
  assert.equal(g.locations.length, 0)
})

test('one open review per version', () => {
  assert.equal(canPresent([]), true)
  assert.equal(canPresent([{ status: 'presented' }]), false)
  assert.equal(canPresent([{ status: 'selected' }]), false)
  assert.equal(canPresent([{ status: 'approved' }]), false)
  assert.equal(canPresent([{ status: 'revision_requested' }]), true)
  assert.equal(canPresent([{ status: 'revision_requested' }, { status: 'presented' }]), false)
})

test('director decisions only from an open review', () => {
  assert.equal(canDecide('presented', 'select'), true)
  assert.equal(canDecide('selected', 'select'), false)
  assert.equal(canDecide('selected', 'approve'), true)
  assert.equal(canDecide('presented', 'revise'), true)
  assert.equal(canDecide('approved', 'revise'), false)
  assert.equal(canDecide('revision_requested', 'approve'), false)
  assert.ok(decisionProblem('revise', '  '))
  assert.equal(decisionProblem('revise', 'darker robe'), null)
  assert.equal(decisionProblem('approve', ''), null)
})

test('approval builds a status op, and a canonical op when chosen as the look', () => {
  let n = 0
  const common = {
    entityId: 'PD-CHR-001-HERO', variant: 'V02', who: { reviewer: 'Dir', actorId: 'u1', actorRole: 'director' },
    ts: '2026-10-27T10:00:00.000Z', machine: 'M1', newId: () => `op_${++n}`,
  }
  const both = buildApprovalOps({ ...common, makeCanonical: true })
  assert.deepEqual(both, [
    { id: 'op_1', ts: common.ts, reviewer: 'Dir', actorId: 'u1', actorRole: 'director', type: 'status', entities: ['PD-CHR-001-HERO'], status: 'APPROVED', machine: 'M1' },
    { id: 'op_2', ts: common.ts, reviewer: 'Dir', actorId: 'u1', actorRole: 'director', type: 'canonical', entity: 'PD-CHR-001-HERO', variant: 'V02', machine: 'M1' },
  ])
  assert.equal(buildApprovalOps({ ...common, makeCanonical: false }).length, 1)
})
