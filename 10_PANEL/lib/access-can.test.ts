import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAPABILITIES, SPENDING, indexOpCapability } from './access/capabilities.ts'
import type { Capability } from './access/capabilities.ts'
import { can, isRole, visibleProjects } from './access/can.ts'

const caps = Object.keys(CAPABILITIES) as Capability[]

test('every capability answers for all three roles', () => {
  assert.equal(caps.length, 28)
  for (const c of caps) {
    for (const r of ['owner', 'agent', 'client'] as const) {
      assert.ok(['allow', 'propose', 'deny'].includes(CAPABILITIES[c][r]), `${c} ${r}`)
    }
  }
})

test('the owner may do everything except comment as a client', () => {
  for (const c of caps) assert.equal(can('owner', c), c === 'comment.client' ? 'deny' : 'allow', c)
})

test('a client sees released items and comments, and nothing else', () => {
  for (const c of caps) {
    const want = c === 'view.released' || c === 'comment.client' ? 'allow' : 'deny'
    assert.equal(can('client', c), want, c)
  }
  for (const c of ['view.prompts', 'view.costs', 'view.drafts', 'view.rejects'] as const) assert.equal(can('client', c), 'deny')
})

test('an agent is never allowed to spend, and proposes the destructive ones', () => {
  for (const c of SPENDING) assert.notEqual(can('agent', c), 'allow', c)
  for (const c of ['review.decide.spend', 'batch.approve', 'studio.spend', 'regen.spend', 'job.retry', 'learning.decide', 'index.destructive', 'episode.destructive', 'project.create'] as const) {
    assert.equal(can('agent', c), 'propose', c)
  }
  for (const c of ['workers.control', 'reveal.local', 'approval.decide', 'comment.client'] as const) assert.equal(can('agent', c), 'deny', c)
  assert.equal(can('agent', 'batch.submit'), 'allow')
})

test('an unknown role or capability is denied', () => {
  assert.equal(can('owner', 'nope'), 'deny')
  assert.equal(can('boss', 'batch.submit'), 'deny')
  assert.equal(can('owner', 'toString'), 'deny')
  assert.equal(isRole('agent'), true)
  assert.equal(isRole('admin'), false)
  assert.equal(isRole(undefined), false)
})

test('index ops map to a capability, and an unknown one fails closed', () => {
  for (const t of ['add', 'restore', 'status', 'canonical', 'role', 'unarchive']) assert.equal(indexOpCapability(t), 'index.write', t)
  for (const t of ['retire', 'archive', 'rename', 'move']) assert.equal(indexOpCapability(t), 'index.destructive', t)
  for (const t of ['new-episode', 'add-shot', 'restore-shot']) assert.equal(indexOpCapability(t), 'episode.write', t)
  for (const t of ['rename-episode', 'archive-shot', 'remove-episode', 'move-shot']) assert.equal(indexOpCapability(t), 'episode.destructive', t)
  assert.equal(indexOpCapability('whatever'), 'index.destructive')
  assert.equal(indexOpCapability(''), 'index.destructive')
})

test('the owner sees every project, others only their own', () => {
  const all = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]
  assert.deepEqual(visibleProjects({ role: 'owner' }, [], all), all)
  assert.deepEqual(visibleProjects({ role: 'agent' }, ['b'], all), [{ slug: 'b' }])
  assert.deepEqual(visibleProjects({ role: 'client' }, [], all), [])
})
