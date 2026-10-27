import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRound, canFinalize, continuityWarning } from './pd/submission.ts';

test('nextRound', () => {
  assert.equal(nextRound([]), 1);
  assert.equal(nextRound([1, 2]), 3);
});

test('only approved can be finalized', () => {
  assert.equal(canFinalize({ submissionStatus: 'approved' }), true);
  assert.equal(canFinalize({ submissionStatus: 'pending' }), false);
  assert.equal(canFinalize({ submissionStatus: 'revision_requested' }), false);
});

test('continuity warns, never blocks', () => {
  assert.equal(continuityWarning(0), null);
  assert.match(continuityWarning(1)!, /1 continuity note/);
  assert.match(continuityWarning(3)!, /3 continuity notes/);
});
