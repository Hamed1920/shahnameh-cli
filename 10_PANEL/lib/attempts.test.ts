import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gatherAttempts, type AttemptDecision, type AttemptJob, type AttemptResult, type AttemptSubject } from './attempts.ts'

const job = (jobId: string, target: string | undefined, at: string, over: Partial<AttemptJob> = {}): AttemptJob =>
  ({ jobId, target, enqueuedAt: at, attempt: 1, label: 'PLAN 01', ...over })
const decision = (jobId: string, hf: string, target: string, ts = '2026-10-15T12:00:00Z'): AttemptDecision =>
  ({ id: `d-${hf}`, jobId, hfJobId: hf, candidate: `09_OUTPUT/_staging/${hf}/take.mp4`, target, ts })
const subject = (jobId: string, hf: string, target: string, at: string, over: Partial<AttemptSubject> = {}): AttemptSubject =>
  ({ jobId, hfJobId: hf, path: `09_OUTPUT/_staging/${hf}/take.mp4`, at, target, label: 'PLAN 01', parentJobId: null, attempt: 1, ...over })
const waitingOf = (jobId: string, hf: string, at: string): AttemptResult =>
  ({ jobId, hfJobId: hf, path: `09_OUTPUT/_staging/${hf}/take.mp4`, at })

const SC1 = 'SHM-EP015-SC001-SH0010'
const SC13 = 'SHM-EP015-SC013-SH0010'

test('a plan label shared by two shots does not pull the other shot in', () => {
  const queue = [
    job('RIU', SC1, '2026-10-15T09:00:00Z'),
    job('JGT', SC13, '2026-10-15T10:00:00Z'),
    job('LC7', SC13, '2026-10-15T11:00:00Z', { parentJobId: 'JGT', attempt: 2 }),
    job('YDK', SC13, '2026-10-15T12:00:00Z', { parentJobId: 'LC7', attempt: 3 }),
  ]
  const decisions = [decision('RIU', 'hf-riu', SC1), decision('JGT', 'hf-jgt', SC13), decision('LC7', 'hf-lc7', SC13)]
  const r = gatherAttempts({
    current: subject('YDK', 'hf-ydk', SC13, '2026-10-15T12:00:00Z', { parentJobId: 'LC7', attempt: 3 }),
    queue, decisions, waiting: [], code: 'SHM',
  })
  assert.deepEqual(r.attempts.map((a) => a.jobId), ['JGT', 'LC7'])
  assert.equal(r.number, 3)
})

test('a job with no shot of its own joins by label only when the label is one shot in that episode', () => {
  const queue = [job('A', SC1, '2026-10-15T09:00:00Z'), job('LOOSE', undefined, '2026-10-15T09:30:00Z')]
  const decisions = [decision('A', 'hf-a', SC1), decision('LOOSE', 'hf-loose', '')]
  const one = gatherAttempts({ current: subject('B', 'hf-b', SC1, '2026-10-15T10:00:00Z'), queue, decisions, waiting: [], code: 'SHM' })
  assert.deepEqual(one.attempts.map((a) => a.jobId), ['A', 'LOOSE'])
  const two = gatherAttempts({
    current: subject('B', 'hf-b', SC1, '2026-10-15T10:00:00Z'),
    queue: [...queue, job('C', SC13, '2026-10-15T09:40:00Z')], decisions, waiting: [], code: 'SHM',
  })
  assert.deepEqual(two.attempts.map((a) => a.jobId), ['A'])
})

test('a failed job in the middle is listed without a number and does not inflate the later ones', () => {
  const queue = [
    job('A', SC1, '2026-10-15T09:00:00Z'),
    job('F', SC1, '2026-10-15T10:00:00Z', { parentJobId: 'A', attempt: 2 }),
    job('B', SC1, '2026-10-15T11:00:00Z', { parentJobId: 'F', attempt: 3 }),
  ]
  const r = gatherAttempts({
    current: subject('B', 'hf-b', SC1, '2026-10-15T11:00:00Z', { parentJobId: 'F', attempt: 3 }),
    queue, decisions: [decision('A', 'hf-a', SC1)], waiting: [], failed: { F: 'no response' }, code: 'SHM',
  })
  assert.deepEqual(r.attempts.map((a) => [a.jobId, a.number, a.failed]), [['A', 1, false], ['F', 0, true]])
  assert.equal(r.attempts[1].reason, 'no response')
  assert.equal(r.number, 2)
})

test('a job that never made anything and did not fail is left out', () => {
  const queue = [job('A', SC1, '2026-10-15T09:00:00Z'), job('QUEUED', SC1, '2026-10-15T09:30:00Z')]
  const r = gatherAttempts({ current: subject('B', 'hf-b', SC1, '2026-10-15T10:00:00Z'), queue, decisions: [decision('A', 'hf-a', SC1)], waiting: [], code: 'SHM' })
  assert.deepEqual(r.attempts.map((a) => a.jobId), ['A'])
})

test('attempts after the open take are marked later and numbered after it', () => {
  const queue = [job('A', SC1, '2026-10-15T09:00:00Z'), job('B', SC1, '2026-10-15T10:00:00Z'), job('C', SC1, '2026-10-15T11:00:00Z')]
  const r = gatherAttempts({
    current: subject('B', 'hf-b', SC1, '2026-10-15T10:00:00Z'),
    queue, decisions: [decision('A', 'hf-a', SC1)], waiting: [waitingOf('C', 'hf-c', '2026-10-15T11:00:00Z')], code: 'SHM',
  })
  assert.deepEqual(r.attempts.map((a) => [a.jobId, a.number, a.later]), [['A', 1, false], ['C', 3, true]])
  assert.equal(r.number, 2)
  assert.equal(r.attempts[1].waiting, '09_OUTPUT/_staging/hf-c/take.mp4')
})

test('equal timestamps order the same whichever take is open', () => {
  const at = '2026-10-15T10:00:00Z'
  const queue = [job('X1', SC1, at), job('X2', SC1, at)]
  const pending = [waitingOf('X1', 'hf-1', at), waitingOf('X2', 'hf-2', at)]
  const open = (id: string, hf: string) => gatherAttempts({
    current: subject(id, hf, SC1, at), queue, decisions: [],
    waiting: pending.filter((p) => p.jobId !== id), code: 'SHM',
  })
  assert.equal(open('X1', 'hf-1').number, 1)
  assert.equal(open('X2', 'hf-2').number, 2)
  assert.deepEqual(open('X2', 'hf-2').attempts.map((a) => [a.jobId, a.number]), [['X1', 1]])
})

test('one job with several results shows each of them', () => {
  const queue = [job('VV2', SC1, '2026-10-07T10:00:00Z')]
  const decisions = [decision('VV2', 'hf-1', SC1), decision('VV2', 'hf-2', SC1), decision('VV2', 'hf-3', SC1)]
  const r = gatherAttempts({ current: subject('NEXT', 'hf-n', SC1, '2026-10-08T10:00:00Z'), queue, decisions, waiting: [], code: 'SHM' })
  assert.equal(r.attempts.length, 3)
  assert.equal(new Set(r.attempts.map((a) => a.key)).size, 3)
  assert.equal(r.number, 4)
  // The open take is one of that job's results: its siblings are the other attempts, in a stable order.
  const same = gatherAttempts({ current: subject('VV2', 'hf-2', SC1, '2026-10-07T10:00:00Z'), queue, decisions: [decisions[0], decisions[2]], waiting: [], code: 'SHM' })
  assert.deepEqual(same.attempts.map((a) => a.hfJobId), ['hf-1', 'hf-3'])
  assert.equal(same.number, 2)
})

test('a shot that moved episode is found under its new id, and a decision whose job is gone still counts', () => {
  const OLD = 'SHM-EP014-SC024-SH0010'
  const NEW = 'SHM-EP015-SC001-SH0010'
  const queue = [job('OLDJOB', OLD, '2026-10-01T10:00:00Z')]
  const r = gatherAttempts({
    current: subject('B', 'hf-b', NEW, '2026-10-02T10:00:00Z'),
    queue, decisions: [decision('OLDJOB', 'hf-o', OLD), decision('GONE', 'hf-g', OLD, '2026-10-01T09:00:00Z')],
    waiting: [], moves: { shot: { [OLD]: NEW } }, code: 'SHM',
  })
  assert.deepEqual(r.attempts.map((a) => a.jobId), ['GONE', 'OLDJOB'])
  assert.equal(r.number, 3)
})
