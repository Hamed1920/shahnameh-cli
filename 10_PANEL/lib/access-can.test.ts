import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAPABILITIES, SPENDING, indexOpCapability } from './access/capabilities.ts'
import type { Capability } from './access/capabilities.ts'
import { can, isRole, visibleProjects } from './access/can.ts'

const caps = Object.keys(CAPABILITIES) as Capability[]
const ROLES = ['owner', 'production', 'director', 'supervisor'] as const

test('every capability answers for all four roles', () => {
  assert.equal(caps.length, 36)
  for (const c of caps) {
    for (const r of ROLES) {
      assert.ok(['allow', 'propose', 'deny'].includes(CAPABILITIES[c][r]), `${c} ${r}`)
    }
  }
})

test('the owner may do everything', () => {
  for (const c of caps) assert.equal(can('owner', c), 'allow', c)
})

test('no role proposes today', () => {
  for (const c of caps) for (const r of ROLES) assert.notEqual(can(r, c), 'propose', `${c} ${r}`)
})

test('production does the operational work, and none of the owner\'s', () => {
  for (const c of [
    'review.decide', 'review.decide.spend', 'batch.submit', 'batch.approve', 'batch.discard',
    'studio.price', 'studio.spend', 'studio.close', 'regen.spend', 'job.retry', 'job.dismiss',
    'gallery.curate', 'index.write', 'index.destructive', 'episode.write', 'episode.destructive',
    'view.prompts', 'view.costs', 'view.drafts', 'view.rejects',
    'block.write', 'submission.create', 'final.set', 'asset.present',
  ] as const) assert.equal(can('production', c), 'allow', c)
  for (const c of [
    'learning.decide', 'project.create', 'workers.control', 'reveal.local', 'approval.decide',
    'users.manage', 'audit.view',
  ] as const) assert.equal(can('production', c), 'deny', c)
})

test('the director reviews, and nothing else', () => {
  const allowed = ['review.view', 'feedback.director', 'review.decide.director', 'asset.review']
  for (const c of caps) assert.equal(can('director', c), allowed.includes(c) ? 'allow' : 'deny', c)
})

test('the supervisor writes continuity notes, and nothing else', () => {
  const allowed = ['review.view', 'feedback.continuity']
  for (const c of caps) assert.equal(can('supervisor', c), allowed.includes(c) ? 'allow' : 'deny', c)
  assert.equal(can('supervisor', 'review.decide.director'), 'deny')
})

test('the reviewers never see staff views, never generate and never spend', () => {
  for (const r of ['director', 'supervisor'] as const) {
    for (const c of ['view.prompts', 'view.costs', 'view.drafts', 'view.rejects'] as const) assert.equal(can(r, c), 'deny', `${r} ${c}`)
    for (const c of SPENDING) assert.equal(can(r, c), 'deny', `${r} ${c}`)
    for (const c of ['batch.submit', 'studio.price', 'regen.spend', 'index.write'] as const) assert.equal(can(r, c), 'deny', `${r} ${c}`)
  }
})

test('only the owner manages users and reads the audit log', () => {
  for (const r of ROLES) {
    for (const c of ['users.manage', 'audit.view'] as const) assert.equal(can(r, c), r === 'owner' ? 'allow' : 'deny', `${r} ${c}`)
  }
})

test('an unknown role or capability is denied', () => {
  assert.equal(can('owner', 'nope'), 'deny')
  assert.equal(can('boss', 'batch.submit'), 'deny')
  assert.equal(can('agent', 'batch.submit'), 'deny')
  assert.equal(can('client', 'review.view'), 'deny')
  assert.equal(can('owner', 'toString'), 'deny')
  for (const r of ROLES) assert.equal(isRole(r), true)
  assert.equal(isRole('agent'), false)
  assert.equal(isRole('client'), false)
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
  assert.deepEqual(visibleProjects({ role: 'production' }, ['b'], all), [{ slug: 'b' }])
  assert.deepEqual(visibleProjects({ role: 'director' }, [], all), [])
})
