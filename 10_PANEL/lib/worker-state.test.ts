import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STATE_FILE_RX, mergeStates } from './worker-state.ts'

test('every machine\'s state is read as one: processed anywhere counts as processed', () => {
  const merged = mergeStates([
    { processedJobs: ['J1', 'J2'], processedRequests: ['r1'], held: { J3: { reason: 'a' } }, spentCredits: 10 },
    { processedJobs: ['J2', 'J4'], processedRequests: ['r2'], failedJobs: { J5: { reason: 'b' } }, spentCredits: 5 },
  ])!
  assert.deepEqual(merged.processedJobs, ['J1', 'J2', 'J4'])
  assert.deepEqual(merged.processedRequests, ['r1', 'r2'])
  assert.deepEqual(Object.keys(merged.held as object), ['J3'])
  assert.deepEqual(Object.keys(merged.failedJobs as object), ['J5'])
  assert.equal(merged.spentCredits, 15)
  assert.equal(mergeStates([]), null)
})

test('state files are the legacy one and one per machine, nothing else', () => {
  assert.ok(STATE_FILE_RX.test('state.json'))
  assert.ok(STATE_FILE_RX.test('state.parsa-laptop.json'))
  assert.ok(!STATE_FILE_RX.test('state.json.tmp'))
  assert.ok(!STATE_FILE_RX.test('QUEUE.jsonl'))
})