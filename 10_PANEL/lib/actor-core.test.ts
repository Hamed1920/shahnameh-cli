import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Forbidden, authEnabled, localActor, stamp } from './actor-core.ts'

test('login is on only for exactly "on"', () => {
  assert.equal(authEnabled({ SHM_AUTH: 'on' }), true)
  for (const v of [undefined, '', 'ON', 'true', '1', 'off', ' on']) assert.equal(authEnabled({ SHM_AUTH: v }), false, String(v))
})

test('the local actor is the owner and honours SHM_REVIEWER', () => {
  assert.deepEqual(localActor({}), { id: 'local', name: 'hamed', role: 'owner' })
  assert.deepEqual(localActor({ SHM_REVIEWER: 'parsa' }), { id: 'local', name: 'parsa', role: 'owner' })
  assert.equal(localActor({ SHM_REVIEWER: '' }).name, 'hamed')
})

test('stamp adds the actor fields only when login is on', () => {
  const a = { id: 'u1', name: 'Sara', role: 'production' as const }
  assert.deepEqual(Object.keys(stamp(a, false)), ['reviewer'])
  assert.deepEqual(stamp(a, false), { reviewer: 'Sara' })
  assert.deepEqual(stamp(a, true), { reviewer: 'Sara', actorId: 'u1', actorRole: 'production' })
})

test('Forbidden carries the capability', () => {
  const e = new Forbidden('batch.approve')
  assert.ok(e instanceof Error)
  assert.equal(e.capability, 'batch.approve')
})
