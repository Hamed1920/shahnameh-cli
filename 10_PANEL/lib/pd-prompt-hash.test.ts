import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrompt, promptHash } from './pd/prompt-hash.ts';

test('normalize trims, unifies line endings and whitespace', () => {
  assert.equal(normalizePrompt('  a   b \r\n\r\n\r\n\r\n c\t d  '), 'a b\n\nc d');
});

test('hash ignores formatting noise but not wording', () => {
  assert.equal(promptHash('a  b\r\nc'), promptHash(' a b\nc '));
  assert.notEqual(promptHash('a b'), promptHash('a c'));
  assert.match(promptHash('x'), /^[0-9a-f]{64}$/);
});
