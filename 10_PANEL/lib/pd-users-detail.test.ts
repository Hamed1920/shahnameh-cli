import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDetail } from './audit-detail.ts'

test('before/after objects show only what changed', () => {
  assert.equal(formatDetail({ before: { role: 'production', x: 1 }, after: { role: 'director', x: 1 } }), 'role: production -> director')
})

test('plain objects, scalars, nothing', () => {
  assert.equal(formatDetail({ email: 'a@b.c', projects: ['p', 'q'] }), 'email: a@b.c, projects: [p, q]')
  assert.equal(formatDetail(null), '')
  assert.equal(formatDetail('hi'), 'hi')
  assert.equal(formatDetail({ before: 1, after: 2 }), '1 -> 2')
})

test('long detail is capped', () => {
  const s = formatDetail({ note: 'x'.repeat(500), a: 'y'.repeat(100), b: 'z'.repeat(100) })
  assert.ok(s.length <= 140)
  assert.ok(s.endsWith('...'))
})
