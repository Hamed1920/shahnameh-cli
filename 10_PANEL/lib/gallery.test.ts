import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allTags, cleanTag, foldGallery, moveWithin, tagKey, type GalleryEvent } from './gallery.ts'

let n = 0
const ev = (e: Partial<GalleryEvent> & Pick<GalleryEvent, 'type'>) =>
  ({ id: `gl_${n++}`, ts: '2026-09-16T10:00:00.000Z', reviewer: 'hamed', ...e }) as GalleryEvent

test('a like is on until an event turns it off, and the later line wins', () => {
  const state = foldGallery([
    ev({ type: 'like', decisionId: 'rev_a', on: true }),
    ev({ type: 'like', decisionId: 'rev_b', on: true }),
    ev({ type: 'like', decisionId: 'rev_a', on: false }),
    ev({ type: 'like', decisionId: 'rev_a', on: true }),
  ])
  assert.deepEqual(state.liked.sort(), ['rev_a', 'rev_b'])
})

test('unliking leaves nothing behind', () => {
  const state = foldGallery([
    ev({ type: 'like', decisionId: 'rev_a', on: true }),
    ev({ type: 'like', decisionId: 'rev_a', on: false }),
  ])
  assert.deepEqual(state.liked, [])
})

test('tags differing only in case or spacing are one collection, kept as first typed', () => {
  const state = foldGallery([
    ev({ type: 'tag', decisionId: 'rev_a', tag: 'Hero Shots', on: true }),
    ev({ type: 'tag', decisionId: 'rev_a', tag: 'hero   shots', on: true }),
  ])
  assert.deepEqual(state.tags.rev_a, ['hero shots'])
  assert.equal(tagKey('Hero Shots'), tagKey(' hero   shots '))
})

test('removing a tag matches case-insensitively, and an emptied take drops out', () => {
  const state = foldGallery([
    ev({ type: 'tag', decisionId: 'rev_a', tag: 'Trailer', on: true }),
    ev({ type: 'tag', decisionId: 'rev_a', tag: 'trailer', on: false }),
  ])
  assert.equal(state.tags.rev_a, undefined)
})

test('the last order event is the arrangement', () => {
  const state = foldGallery([
    ev({ type: 'order', order: ['a', 'b', 'c'] }),
    ev({ type: 'order', order: ['c', 'a', 'b'] }),
  ])
  assert.deepEqual(state.order, ['c', 'a', 'b'])
})

test('allTags lists each collection once, sorted', () => {
  const state = foldGallery([
    ev({ type: 'tag', decisionId: 'rev_a', tag: 'trailer', on: true }),
    ev({ type: 'tag', decisionId: 'rev_b', tag: 'Trailer', on: true }),
    ev({ type: 'tag', decisionId: 'rev_b', tag: 'hero', on: true }),
  ])
  assert.deepEqual(allTags(state), ['hero', 'trailer'])
})

test('a tag is trimmed, collapsed and capped', () => {
  assert.equal(cleanTag('  needs   sound  '), 'needs sound')
  assert.equal(cleanTag('x'.repeat(80)).length, 40)
})

test('moveWithin puts the dragged take where the target was', () => {
  assert.deepEqual(moveWithin(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c'])
  assert.deepEqual(moveWithin(['a', 'b', 'c'], 'a', 'c'), ['b', 'a', 'c'])
  assert.deepEqual(moveWithin(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c'])
})

test('moveWithin keeps takes a filter is hiding', () => {
  // Only a and d are on screen; b and c are filtered out but must survive.
  assert.deepEqual(moveWithin(['a', 'b', 'c', 'd'], 'd', 'a'), ['d', 'a', 'b', 'c'])
})

test('an unknown target sends the take to the end rather than dropping it', () => {
  assert.deepEqual(moveWithin(['a', 'b'], 'a', 'zz'), ['b', 'a'])
})
