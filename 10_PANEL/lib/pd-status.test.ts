import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockStatus, feedbackCounts, BLOCK_STATUS_LABEL } from './pd/status.ts';

test('not started / in production', () => {
  assert.equal(blockStatus({ generations: 0, activeSubmission: null, final: false }), 'not_started');
  assert.equal(blockStatus({ generations: 5, activeSubmission: null, final: false }), 'in_production');
});

test('G06/G07 generated after round 1 do not change the active submission', () => {
  const sub = { status: 'pending' as const };
  assert.equal(blockStatus({ generations: 5, activeSubmission: sub, final: false }), 'ready_for_review');
  assert.equal(blockStatus({ generations: 7, activeSubmission: sub, final: false }), 'ready_for_review');
});

test('revision requested', () => {
  assert.equal(blockStatus({ generations: 3, activeSubmission: { status: 'revision_requested' }, final: false }), 'revision_required');
});

test('approval stays with its submission; a newer generation does not change it', () => {
  const sub = { status: 'approved' as const };
  assert.equal(blockStatus({ generations: 7, activeSubmission: sub, final: false }), 'director_approved');
  assert.equal(blockStatus({ generations: 8, activeSubmission: sub, final: false }), 'director_approved');
  // submitting G08 opens a new active submission: pending again, approval not carried over
  assert.equal(blockStatus({ generations: 8, activeSubmission: { status: 'pending' }, final: false }), 'ready_for_review');
});

test('final counts only when its submission is approved', () => {
  assert.equal(blockStatus({ generations: 7, activeSubmission: { status: 'approved' }, final: true, finalApproved: true }), 'final_ready');
  assert.equal(blockStatus({ generations: 7, activeSubmission: { status: 'pending' }, final: true, finalApproved: false }), 'ready_for_review');
  assert.equal(blockStatus({ generations: 7, activeSubmission: { status: 'approved' }, final: true }), 'director_approved');
});

test('labels and feedback counts', () => {
  assert.equal(BLOCK_STATUS_LABEL.final_ready, 'Final ready');
  const fb = [
    { id: 'a', resolutionStatus: 'open' as const },
    { id: 'b', resolutionStatus: 'in_progress' as const },
    { id: 'c', resolutionStatus: 'resolved' as const },
  ];
  assert.deepEqual(feedbackCounts(fb, ['a']), { open: 2, unread: 2 });
});
