import assert from 'node:assert/strict'
import { test } from 'node:test'
import { batchSummary, regenerateSummary, studioApproveSummary, studioPickSummary } from './approval-summary.ts'

test('summaries read as one line', () => {
  assert.equal(batchSummary({ batchId: 'B-1', name: 'Zahhak', jobs: 12, total: 340 }), 'Approve batch B-1 (Zahhak): 12 jobs, 340 credits')
  assert.equal(batchSummary({ batchId: 'B-1', name: 'B-1', jobs: 1, total: 1 }), 'Approve batch B-1: 1 job, 1 credit')
  assert.equal(batchSummary({ batchId: 'B-1', jobs: 2, total: null }), 'Approve batch B-1: 2 jobs, unpriced')
  assert.equal(studioApproveSummary({ sessionId: 'ss_a', genId: 'g1', expectedTotal: 4 }), 'Generate studio try g1 (session ss_a): 4 credits')
  assert.equal(studioPickSummary({ hfJobId: 'hf1', take: 'T01', entity: 'SHM-CHR-001-KAVEH' }), 'File studio result hf1/T01 as a look of SHM-CHR-001-KAVEH')
  assert.equal(studioPickSummary({ hfJobId: 'hf1', take: 'T01', name: 'Kaveh' }), 'File studio result hf1/T01 as new Kaveh')
  assert.equal(regenerateSummary({ jobId: 'J1', decisionId: 'd1' }), 'Regenerate job J1 (decision d1)')
})
