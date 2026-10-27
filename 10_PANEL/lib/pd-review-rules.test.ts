import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alreadyActive, canAddNote, canSetResolution, categoryFor, checkDecision, checkNote, checkTimecode,
  fileMatches, noteBadge, pickActiveSubmission, shaCacheKey,
} from './pd/review-rules.ts';
import { canFinalize, continuityWarning, nextRound } from './pd/submission.ts';

test('a role writes only its own category; production none; owner must choose', () => {
  assert.equal(categoryFor('director'), 'director');
  assert.equal(categoryFor('director', 'continuity'), null);
  assert.equal(categoryFor('supervisor'), 'continuity');
  assert.equal(categoryFor('supervisor', 'director'), null);
  assert.equal(categoryFor('production', 'director'), null);
  assert.equal(categoryFor('production'), null);
  assert.equal(categoryFor('owner'), null);
  assert.equal(categoryFor('owner', 'continuity'), 'continuity');
  assert.equal(categoryFor('owner', 'bogus'), null);
});

test('notes: not empty, at most 4000, timecode optional and non-negative', () => {
  assert.equal(checkNote('  ').ok, false);
  assert.equal(checkNote('x'.repeat(4001)).ok, false);
  assert.deepEqual(checkNote(' hi '), { ok: true, body: 'hi' });
  assert.deepEqual(checkTimecode(''), { ok: true, seconds: null });
  assert.deepEqual(checkTimecode('4.5'), { ok: true, seconds: 4.5 });
  assert.equal(checkTimecode('-1').ok, false);
  assert.equal(checkTimecode('abc').ok, false);
});

test('decisions: only the active pending round; a revision needs a note', () => {
  const pending = { status: 'pending', isActive: true } as const;
  assert.equal(checkDecision(pending, 'approved', '').ok, true);
  assert.equal(checkDecision(pending, 'revision_requested', '  ').ok, false);
  assert.equal(checkDecision(pending, 'revision_requested', 'Cut the dog').ok, true);
  assert.equal(checkDecision(pending, 'maybe', 'x').ok, false);
  assert.equal(checkDecision({ status: 'approved', isActive: true }, 'revision_requested', 'x').ok, false);
  assert.equal(checkDecision({ status: 'revision_requested', isActive: true }, 'approved', '').ok, false);
  assert.equal(checkDecision({ status: 'pending', isActive: false }, 'approved', '').ok, false);
});

test('reviewers add notes only to the active round; only staff set handling', () => {
  assert.equal(canAddNote({ isActive: true }), true);
  assert.equal(canAddNote({ isActive: false }), false);
  assert.equal(canSetResolution('production'), true);
  assert.equal(canSetResolution('owner'), true);
  assert.equal(canSetResolution('supervisor'), false);
  assert.equal(canSetResolution('director'), false);
});

test('never auto-replace: a newer generation does not change the active submission', () => {
  const subs = [
    { id: 's1', generationId: 'g5', roundNumber: 1, isActive: false },
    { id: 's2', generationId: 'g7', roundNumber: 2, isActive: true },
  ];
  assert.equal(pickActiveSubmission(subs, [{ id: 'g5' }, { id: 'g7' }])?.id, 's2');
  assert.equal(pickActiveSubmission(subs, [{ id: 'g5' }, { id: 'g7' }, { id: 'g8' }])?.id, 's2');
  assert.equal(pickActiveSubmission([], [{ id: 'g1' }]), null);
  assert.equal(pickActiveSubmission([{ id: 'a', generationId: 'g1', roundNumber: 1, isActive: false }]), null);
  assert.equal(alreadyActive(subs[1], 'g7'), true);
  assert.equal(alreadyActive(subs[1], 'g8'), false);
  assert.equal(nextRound(subs.map((s) => s.roundNumber)), 3);
});

test('sha cache key changes with path, mtime or size; a mismatch refuses', () => {
  const k = shaCacheKey('/a/b.mp4', 1000.7, 50);
  assert.equal(k, shaCacheKey('/a/b.mp4', 1000.2, 50));
  assert.notEqual(k, shaCacheKey('/a/b.mp4', 1001, 50));
  assert.notEqual(k, shaCacheKey('/a/b.mp4', 1000, 51));
  assert.notEqual(k, shaCacheKey('/a/c.mp4', 1000, 50));
  assert.equal(fileMatches('abc', 'abc'), true);
  assert.equal(fileMatches('abc', 'abd'), false);
  assert.equal(fileMatches(null, 'abd'), true);
});

test('final: approved only, open continuity warns but does not block', () => {
  assert.equal(canFinalize({ submissionStatus: 'approved' }), true);
  assert.equal(canFinalize({ submissionStatus: 'pending' }), false);
  assert.equal(canFinalize({ submissionStatus: 'revision_requested' }), false);
  assert.equal(continuityWarning(0), null);
  assert.match(continuityWarning(2) ?? '', /2 continuity notes/);
});

test('unread badge labels', () => {
  assert.deepEqual(noteBadge({ unreadDirector: 1, unreadContinuity: 0, revision: true }), ['Director revision']);
  assert.deepEqual(noteBadge({ unreadDirector: 1, unreadContinuity: 2, revision: false }), ['Director note', 'Continuity note']);
  assert.deepEqual(noteBadge({ unreadDirector: 0, unreadContinuity: 0, revision: true }), []);
});
