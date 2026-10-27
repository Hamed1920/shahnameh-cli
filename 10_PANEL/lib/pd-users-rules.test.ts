import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDisable, checkRoleChange, checkSlugs, diffSlugs } from './pd-users-rules.ts'

const owner = { id: 'o1', role: 'owner', disabled: false }
const owner2 = { id: 'o2', role: 'owner', disabled: false }
const prod = { id: 'p1', role: 'production', disabled: false }

test('the last active owner cannot be demoted', () => {
  assert.equal(checkRoleChange([owner, prod], 'o1', 'production').ok, false)
  assert.equal(checkRoleChange([owner, owner2, prod], 'o1', 'production').ok, true)
  // a disabled second owner does not count
  assert.equal(checkRoleChange([owner, { ...owner2, disabled: true }], 'o1', 'director').ok, false)
  assert.equal(checkRoleChange([owner, prod], 'p1', 'owner').ok, true)
  assert.equal(checkRoleChange([owner, prod], 'p1', 'king').ok, false)
  assert.equal(checkRoleChange([owner], 'zz', 'owner').ok, false)
})

test('nobody disables themselves; the last owner stays active', () => {
  assert.equal(checkDisable([owner, owner2], 'o1', 'o1', true).ok, false)
  assert.equal(checkDisable([owner, owner2, prod], 'p1', 'o1', true).ok, true)
  assert.equal(checkDisable([owner, prod], 'o1', 'p1', true).ok, false)
  assert.equal(checkDisable([owner, owner2], 'o2', 'o1', true).ok, true)
  assert.equal(checkDisable([owner, { ...prod, disabled: true }], 'p1', 'p1', false).ok, true)
})

test('slugs must be known projects', () => {
  assert.deepEqual(checkSlugs(['a', 'a', 'b'], ['a', 'b', 'c']), { ok: true, slugs: ['a', 'b'] })
  const bad = checkSlugs(['a', 'x', 'y'], ['a'])
  assert.equal(bad.ok, false)
  assert.match((bad as { error: string }).error, /x, y/)
  assert.deepEqual(checkSlugs([], []), { ok: true, slugs: [] })
})

test('diffSlugs', () => {
  assert.deepEqual(diffSlugs(['a', 'b'], ['b', 'c']), { added: ['c'], removed: ['a'] })
})
