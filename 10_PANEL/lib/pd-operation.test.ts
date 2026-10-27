import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationType } from './pd/operation.ts';

test('plain job is generate', () => assert.equal(operationType({ attempt: 1 }), 'generate'));
test('attempt > 1 is revision', () => assert.equal(operationType({ attempt: 2 }), 'revision'));
test('parent makes revision', () => assert.equal(operationType({ parentJobId: 'j1' }), 'revision'));
test('retryOf makes revision', () => assert.equal(operationType({ retryOf: 'j1' }), 'revision'));
test('panel regenerate is edit', () => {
  assert.equal(operationType({ enqueuedBy: 'panel:regenerate', parentJobId: 'j1' }), 'edit');
});
test('final of a draft', () => {
  assert.equal(operationType({ stage: 'final', parentJobId: 'j1', parentStage: 'draft' }), 'final_of_draft');
  assert.equal(operationType({ stage: 'final', parentJobId: 'j1', parentStage: 'final' }), 'revision');
});
