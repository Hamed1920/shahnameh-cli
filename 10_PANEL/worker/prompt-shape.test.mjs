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

test('a prompt heading without a number, or a sentence that orders a video, is a whole prompt too', () => {
  assert.equal(looksLikeWholePrompt(`PLAN — THE LIFT\n${body}`), true)
  assert.equal(looksLikeWholePrompt(`PROMPT: the lift\n${body}`), true)
  assert.equal(looksLikeWholePrompt(`# The lift\n${body}`), true)
  assert.equal(looksLikeWholePrompt(`Create one 15-second horizontal 16:9 live-action sequence. ${body}`), true)
  assert.equal(looksLikeWholePrompt(`Generate a single continuous shot. ${body}`), true)
  assert.equal(looksLikeWholePrompt(`پلان\n${body}`), true)
})

test('long prose that only starts with a similar word stays a note', () => {
  assert.equal(looksLikeWholePrompt(`Planning the lighting again: ${body}`), false)
  assert.equal(looksLikeWholePrompt(`Pleasing the eye is not the point. ${body}`), false)
  assert.equal(looksLikeWholePrompt(`Please create one clean version. ${body}`), false)
  assert.equal(looksLikeWholePrompt(`Make it darker. ${body}`), false)
  assert.equal(looksLikeWholePrompt('PLAN — THE LIFT\nshort'), false)
})

test('a revision note is written under the prompt the way buildPrompt lays it out', async () => {
  const { withRevisionNotes, revisionHeading } = await import('./lib/note-shape.mjs')
  assert.equal(withRevisionNotes('Base.', []), 'Base.')
  assert.equal(withRevisionNotes('Base.', ['Fix A']), `Base.\n\n${revisionHeading(1)}\n- Fix A`)
  assert.equal(withRevisionNotes(' Base. ', ['A', '', 'B']), `Base.\n\n${revisionHeading(2)}\n- A\n- B`)
})
