import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foldStudio, openSessionIds } from './studio.ts'

const S = 'ss_abc123'
const price = (id: string, genId: string, extra = {}) => ({
  id, ts: `2026-09-24T10:0${id.slice(-1)}:00Z`, type: 'studio.price', sessionId: S, genId, model: 'nano_banana_pro',
  prompt: 'Kaveh, full body', refs: ['@CHR-001/V01'], params: { aspect_ratio: '1:1' }, count: 2,
  proposal: { kind: 'CHR', name: 'Kaveh' }, ...extra,
})

test('a try moves from pricing to priced to generating to done, and its results show until picked', () => {
  const requests = [price('r1', 'g1'), price('r2', 'g2'), { id: 'r3', ts: '', type: 'studio.approve', sessionId: S, genId: 'g2' }]
  const events = [
    { event: 'studio.error', reqId: 'r1', sessionId: S, genId: 'g1', reason: 'replaced by a later edit' },
    { event: 'studio.priced', reqId: 'r2', sessionId: S, genId: 'g2', credits: 2, count: 2, total: 4 },
    { event: 'studio.queued', reqId: 'r3', sessionId: S, genId: 'g2', jobIds: ['J1', 'J2'], total: 4 },
  ]
  const queue = [{ jobId: 'J1', studio: { sessionId: S, genId: 'g2' } }, { jobId: 'J2', studio: { sessionId: S, genId: 'g2' } }]
  const base = { requests, events, queue, held: {}, staged: [] as never[], generating: null as string | null }

  let s = foldStudio(S, { ...base, processedJobs: [], generating: 'J1' })
  assert.deepEqual(s.tries.map((t) => t.status), ['replaced', 'generating'])
  assert.deepEqual(s.proposal, { kind: 'CHR', name: 'Kaveh' })
  assert.equal(s.entity, null)

  const staged = [{ sidecar: { jobId: 'J1', hfJobId: 'hf1', studio: { sessionId: S, genId: 'g2' }, candidates: [{ file: 'T01.png', take: 'T01' }] }, present: ['T01.png'] }]
  s = foldStudio(S, { ...base, processedJobs: ['J1', 'J2'], staged })
  assert.equal(s.tries[1].status, 'done')
  assert.deepEqual(s.tries[1].results, [{ hfJobId: 'hf1', take: 'T01', path: '09_OUTPUT/_staging/hf1/T01.png', picked: null }])

  // Picked: the file has left staging, the result stays, marked with the token it was filed as.
  const pickedEvents = [...events, { event: 'studio.picked', reqId: 'r4', sessionId: S, hfJobId: 'hf1', take: 'T01', token: '@CHR-014/V01', entity: 'SHM-CHR-014-KAVEH' }]
  s = foldStudio(S, {
    ...base, events: pickedEvents, processedJobs: ['J1', 'J2'],
    staged: [{ ...staged[0], present: [] }],
  })
  assert.deepEqual(s.tries[1].results.map((r) => [r.path, r.picked]), [[null, '@CHR-014/V01']])
  assert.deepEqual(s.picks.map((p) => p.token), ['@CHR-014/V01'])
})

test('a refused request shows as the reason, and a closed session is not open', () => {
  const requests = [price('r1', 'g1'), { id: 'r2', ts: '', type: 'studio.close', sessionId: S }]
  const events = [
    { event: 'rejected', reqId: 'r1', reason: 'the prompt is empty' },
    { event: 'rejected', reqId: 'r2', reason: '1 try is still generating; close once it finishes' },
  ]
  const s = foldStudio(S, { requests, events, queue: [], processedJobs: [], held: {}, staged: [], generating: null })
  assert.equal(s.tries[0].status, 'error')
  assert.equal(s.tries[0].reason, 'the prompt is empty')
  assert.match(s.refused ?? '', /still generating/)
  assert.deepEqual(openSessionIds(requests, events), [S])
  assert.deepEqual(openSessionIds(requests, [...events, { event: 'studio.closed', sessionId: S }]), [])
})

test('a try the worker cannot price yet says why, and keeps waiting', () => {
  const requests = [price('r1', 'g1')]
  const events = [
    { event: 'studio.received', reqId: 'r1', sessionId: S, genId: 'g1' },
    { event: 'error', reqId: 'r1', sessionId: S, genId: 'g1', reason: 'no Higgsfield workspace is selected' },
  ]
  const s = foldStudio(S, { requests, events, queue: [], processedJobs: [], held: {}, staged: [], generating: null })
  assert.equal(s.tries[0].status, 'pricing')
  assert.match(s.tries[0].reason ?? '', /workspace/)
})

test('a failed try carries the worker\'s reason', () => {
  const requests = [price('r1', 'g1')]
  const events = [{ event: 'studio.queued', reqId: 'r2', sessionId: S, genId: 'g1', jobIds: ['J1'], total: 12 }]
  const s = foldStudio(S, {
    requests, events, queue: [], processedJobs: ['J1'], held: {}, staged: [], generating: null,
    ledgerHf: { J1: { hfJobId: 'hf1', state: 'NO_RESULT' } }, failedJobs: { J1: { reason: 'Higgsfield returned no file' } },
  })
  assert.equal(s.tries[0].status, 'failed')
  assert.equal(s.tries[0].reason, 'Higgsfield returned no file')
})