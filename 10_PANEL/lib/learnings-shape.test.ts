import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shapeLearnings } from './learnings-shape.ts'
import type { CatalogEntity, Learning, ResolvedReference, ReviewDecision } from './types.ts'

/**
 * The Learnings page shows each rule's looks and the takes it came from. A
 * named look that resolves is a picture; anything else is marked as not sent,
 * which is what the worker does with it (worker/lib/plan.mjs).
 */

const FLAG = '04_PROPS/FLG-PRP-016-IRANIAN-FLAG_V01_flag.jpg'
const catalog: CatalogEntity[] = [{
  id: 'FLG-PRP-016-IRANIAN-FLAG', shortId: 'PRP-016', kind: 'PRP', slug: 'IRANIAN-FLAG', name: 'Iranian flag',
  canonical: 'V01', variants: [{ variant: 'V01', path: FLAG }],
}]
const resolver = async (token: string): Promise<ResolvedReference> =>
  token.startsWith('@PRP-016') ? { token, path: FLAG } : { token, path: null, stale: 'not in the index' }

const learning: Learning = {
  id: 'L-0001', scope: { kind: null, entity: 'FLG-PRP-016-IRANIAN-FLAG', family: null },
  rule: 'Any flag must match @PRP-016/V01, never @PRP-099/V01.', evidence: ['rev_1', 'rev_gone'],
  status: 'proposed', created: '2026-09-28',
}
const decision = {
  id: 'rev_1', ts: '2026-09-28T10:00:00Z', candidate: '09_OUTPUT/_staging/job1/T01.mp4', jobId: 'job1', hfJobId: 'hf1',
  target: 'FLG-PRP-016-IRANIAN-FLAG', variant: 'V01', take: 'T01', verdict: 'denied', notes: 'wrong flag, use @PRP-016 @upload:u1',
  notesEn: 'wrong flag', tags: [], model: 'nano_banana_pro', requeue: false,
} as unknown as ReviewDecision

const [view] = await shapeLearnings({
  learnings: [learning, { ...learning, id: 'L-0002', scope: { kind: 'LOC', entity: null, family: null } }],
  catalog,
  resolver,
  decided: new Map([['rev_1', { decision, title: 'Flag', where: 'FLG-PRP-016', file: decision.candidate, missing: null, notes: decision.notes }]]),
})

test('a named look becomes its picture, inside the sentence', () => {
  assert.deepEqual(view.segments[0], { text: 'Any flag must match ' })
  const ref = view.segments[1]
  assert.ok('ref' in ref)
  assert.equal(ref.ref.path, FLAG)
  assert.equal(ref.ref.name, 'Iranian flag')
  assert.deepEqual(view.segments.at(-1), { text: '.' })
})

test('an unknown look is kept, marked as not sent', () => {
  const bad = view.refs.find((r) => r.token === '@PRP-099/V01')
  assert.ok(bad)
  assert.equal(bad.path, null)
  assert.equal(bad.stale, 'not in the index')
  assert.equal(view.refs.length, 2)
})

test('the scope is the entity, with its current look; a kind scope says so in words', async () => {
  assert.equal(view.scope.label, 'Iranian flag')
  assert.equal(view.scope.path, FLAG)
  const [, kind] = await shapeLearnings({
    learnings: [learning, { ...learning, id: 'L-0002', scope: { kind: 'LOC', entity: null, family: null } }],
    catalog, resolver, decided: new Map(),
  })
  assert.equal(kind.scope.label, 'Every location')
})

test('evidence shows the take it was about; a vanished decision says so', () => {
  const [e, gone] = view.evidence
  assert.equal(e.file, '09_OUTPUT/_staging/job1/T01.mp4')
  assert.equal(e.verdict, 'denied')
  assert.equal(e.notesEn, 'wrong flag')
  assert.ok(e.notes.some((s) => 'ref' in s && s.ref.path === FLAG), 'the note\'s @PRP-016 is a picture too')
  assert.ok(e.notes.some((s) => 'text' in s && s.text.includes('@upload:u1')), 'an upload placeholder stays text')
  assert.equal(gone.found, false)
  assert.equal(gone.file, null)
})
