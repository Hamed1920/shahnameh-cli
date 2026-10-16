import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeWholePrompt } from './lib/note-shape.mjs'

const body = 'Create a 15-second horizontal 16:9 live-action cinematic sequence with the exact timed shots below. '.repeat(8)

test('a whole prompt pasted into the note box is recognised, in either language', () => {
  assert.equal(looksLikeWholePrompt(`PLAN 08 | TWO FEARS IN PARALLEL\r\nDURATION 15 SECONDS\r\n${body}`), true)
  assert.equal(looksLikeWholePrompt(`  P3\n${body}`), true)
  assert.equal(looksLikeWholePrompt(`## PLAN 3.1 | the gap\n${body}`), true)
  assert.equal(looksLikeWholePrompt(`پلان ۸ | هراس\n${body}`), true)
})

test('an ordinary note is left alone, however it begins', () => {
  assert.equal(looksLikeWholePrompt('PLAN 08 should show the knife on the bench'), false)
  assert.equal(looksLikeWholePrompt(`The lighting is wrong. ${body}`), false)
  assert.equal(looksLikeWholePrompt(''), false)
  assert.equal(looksLikeWholePrompt(null), false)
})
