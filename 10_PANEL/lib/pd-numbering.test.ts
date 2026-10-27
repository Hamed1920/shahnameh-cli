import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextNumber, nextGNumbers, gLabel } from './pd/numbering.ts';

test('nextNumber is max+1 and never reuses gaps', () => {
  assert.equal(nextNumber([]), 1);
  assert.equal(nextNumber([1, 2, 5]), 6);
});

test('nextGNumbers numbers new keys in time order, leaves existing alone', () => {
  const out = nextGNumbers(
    [{ key: 'a', g: 1 }, { key: 'b', g: 2 }],
    [{ key: 'c', at: '2026-02-02' }, { key: 'a', at: '2026-01-01' }, { key: 'd', at: '2026-01-05' }, { key: 'c', at: '2026-02-02' }],
  );
  assert.deepEqual(out, [{ key: 'd', g: 3 }, { key: 'c', g: 4 }]);
});

test('gLabel pads and widens', () => {
  assert.equal(gLabel(1), 'G01');
  assert.equal(gLabel(99), 'G99');
  assert.equal(gLabel(100), 'G100');
});
