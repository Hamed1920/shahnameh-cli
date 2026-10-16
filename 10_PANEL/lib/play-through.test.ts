import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bestOption, chosenOption, compareReviewOrder, inPromptOrder, moveInOrder, orderBy, orderStops, reviewStops, shotStops,
  type PlayOption, type ReviewKey,
} from './play-through.ts'

const opt = (id: string, over: Partial<PlayOption> = {}): PlayOption => ({
  id, file: id, label: id, stage: 'final', attempt: 1, ts: '2026-10-15T10:00:00Z', ...over,
})

test('a final beats a draft, whatever the order or the age', () => {
  const draft = opt('draft.mp4', { stage: 'draft', attempt: 3, ts: '2026-10-16T10:00:00Z' })
  const final = opt('final.mp4', { stage: 'final', attempt: 1 })
  assert.equal(bestOption([draft, final])?.id, 'final.mp4')
  assert.equal(bestOption([final, draft])?.id, 'final.mp4')
})

test('among finals the filed one wins, then the later attempt, then the newer take', () => {
  assert.equal(bestOption([opt('a', { attempt: 3 }), opt('b', { filed: true })])?.id, 'b')
  assert.equal(bestOption([opt('a', { attempt: 1 }), opt('b', { attempt: 2 })])?.id, 'b')
  assert.equal(bestOption([opt('a', { ts: '2026-10-15T10:00:00Z' }), opt('b', { ts: '2026-10-15T11:00:00Z' })])?.id, 'b')
})

test('equal takes keep their order, so the first of a batch plays', () => {
  assert.equal(bestOption([opt('T01'), opt('T02'), opt('T03')])?.id, 'T01')
  assert.equal(bestOption([]), null)
})

test('a tick is honoured while it is still one of the stop\'s takes', () => {
  const stop = { id: 's', title: 'Shot 1', options: [opt('draft', { stage: 'draft' }), opt('final')] }
  assert.equal(chosenOption(stop, {})?.id, 'final')
  assert.equal(chosenOption(stop, { s: 'draft' })?.id, 'draft')
  // A tick left over from a take that has since gone is ignored, not played blank.
  assert.equal(chosenOption(stop, { s: 'gone' })?.id, 'final')
})

test('Review plays one stop per shot, however many takes are waiting', () => {
  const take = (path: string, target: string, over = {}) => ({
    path, target, title: target, take: 'T01', stage: 'final' as const, attempt: 1, createdAt: '2026-10-15T10:00:00Z', ...over,
  })
  const stops = reviewStops([
    take('a-draft.mp4', 'SC1', { stage: 'draft' }),
    take('b.mp4', 'SC2'),
    take('a-final.mp4', 'SC1'),
  ])
  assert.deepEqual(stops.map((s) => s.id), ['SC1', 'SC2'])
  assert.equal(stops[0].options.length, 2)
  assert.equal(chosenOption(stops[0], {})?.id, 'a-final.mp4')
  assert.equal(stops[0].options[0].label, 'T01 · draft')
})

test('an episode leaves out denied and discarded takes, and shots with nothing left', () => {
  const out = (file: string, verdict: 'accepted' | 'denied' | 'discarded' | null, over = {}) => ({
    file, take: 'T01', verdict, stage: 'final' as const, attempt: 1, ts: '2026-10-15T10:00:00Z', filed: false, ...over,
  })
  const stops = shotStops([
    { shot: 'SC1', title: 'Shot 1', outputs: [out('denied.mp4', 'denied'), out('ok.mp4', 'accepted', { filed: true })] },
    { shot: 'SC2', title: 'Shot 2', outputs: [out('nope.mp4', 'denied'), out('nah.mp4', 'discarded')] },
    { shot: 'SC3', title: 'Shot 3', outputs: [] },
  ])
  assert.deepEqual(stops.map((s) => s.id), ['SC1'])
  assert.deepEqual(stops[0].options.map((o) => o.id), ['ok.mp4'])
  assert.equal(stops[0].options[0].label, 'T01 · final · filed')
})

const key = (label: string | null, target: string, over: Partial<ReviewKey> = {}): ReviewKey => ({
  episode: 'EP015', label, target, createdAt: '2026-10-15T10:00:00Z', ...over,
})

test('a retried prompt keeps its number: PLAN 01 comes before PLAN 02 although it was made last', () => {
  const made = [
    key('PLAN 02', 'SHM-EP015-SC002-SH0010'),
    key('PLAN 03', 'SHM-EP015-SC003-SH0010'),
    key('PLAN 01', 'SHM-EP015-SC013-SH0010', { createdAt: '2026-10-15T18:00:00Z' }),
  ]
  assert.deepEqual(made.sort(compareReviewOrder).map((k) => k.label), ['PLAN 01', 'PLAN 02', 'PLAN 03'])
})

test('numbers compare as numbers, in either language, and hand-typed labels come after', () => {
  const made = [key('my own name', 'T3'), key('PLAN 10', 'T2'), key('پلان ۲', 'T1'), key('P9', 'T0')]
  assert.deepEqual(made.sort(compareReviewOrder).map((k) => k.label), ['پلان ۲', 'P9', 'PLAN 10', 'my own name'])
})

test('episodes stay apart, and what is in no episode goes last', () => {
  const made = [key('PLAN 01', 'A', { episode: null }), key('PLAN 05', 'B', { episode: 'EP002' }), key('PLAN 09', 'C', { episode: 'EP001' })]
  assert.deepEqual(made.sort(compareReviewOrder).map((k) => k.target), ['C', 'B', 'A'])
})

test('two takes of one prompt keep their oldest-first order', () => {
  const made = [key('PLAN 01', 'T', { createdAt: '2026-10-15T12:00:00Z' }), key('PLAN 01', 'T', { createdAt: '2026-10-15T10:00:00Z' })]
  assert.deepEqual(made.sort(compareReviewOrder).map((k) => k.createdAt), ['2026-10-15T10:00:00Z', '2026-10-15T12:00:00Z'])
})

test('a custom order puts its shots first, and a newcomer lands at the end', () => {
  const ids = ['a', 'b', 'c', 'd']
  assert.deepEqual(orderBy(ids, ['c', 'a'], (x) => x), ['c', 'a', 'b', 'd'])
  // An id in the saved order that no longer exists is ignored.
  assert.deepEqual(orderBy(ids, ['zzz', 'b'], (x) => x), ['b', 'a', 'c', 'd'])
  assert.deepEqual(orderBy(ids, [], (x) => x), ids)
  const stops = ['a', 'b'].map((id) => ({ id, title: id, options: [] }))
  assert.deepEqual(orderStops(stops, ['b']).map((s) => s.id), ['b', 'a'])
})

test('moving one shot shifts the others around it', () => {
  assert.deepEqual(moveInOrder(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(moveInOrder(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveInOrder(['a', 'b'], 0, 9), ['b', 'a'])
  assert.deepEqual(moveInOrder(['a', 'b'], 5, 0), ['a', 'b'])
})

test('a prompt numbered 3.1 plays between PLAN 3 and PLAN 4, not at the end', () => {
  const made = [
    key('PLAN 04', 'SC4'), key('PLAN 3.2', 'SC31'), key('PLAN 03', 'SC3'), key('PLAN 3.1', 'SC30'), key('PLAN 05', 'SC5'),
    key('PLAN 3.1.1', 'SC32'), key('PLAN 3.10', 'SC33'),
  ]
  assert.deepEqual(
    made.sort(compareReviewOrder).map((k) => k.label),
    ['PLAN 03', 'PLAN 3.1', 'PLAN 3.1.1', 'PLAN 3.2', 'PLAN 3.10', 'PLAN 04', 'PLAN 05'],
  )
})

test('an episode plays its shots by prompt number, unnumbered ones after in scene order', () => {
  const shots = [
    { shot: 'SC2', label: 'PLAN 02' },
    { shot: 'SC5', label: null },
    { shot: 'SC9', label: 'PLAN 1.5' },
    { shot: 'SC3', label: 'PLAN 01' },
    { shot: 'SC4', label: null },
  ]
  assert.deepEqual(inPromptOrder('EP015', shots).map((s) => s.shot), ['SC3', 'SC9', 'SC2', 'SC4', 'SC5'])
})

test('a prompt called 8A, 8-B, 8 v2 or 8 version 3 plays right after 8 and before 9', () => {
  const made = [
    key('PLAN 09', 'S9'), key('PLAN 8B', 'S82'), key('PLAN 08', 'S8'), key('PLAN 8 version 3', 'S84'),
    key('PLAN 8-A', 'S81'), key('PLAN 8 v2', 'S83'), key('PLAN 8 | the hall', 'S80'),
  ]
  const order = made.sort(compareReviewOrder).map((k) => k.label)
  assert.equal(order[order.length - 1], 'PLAN 09')
  // 8 and "8 | the hall" first (the same place), then A, then B / v2 (tied, by shot id), then version 3.
  assert.deepEqual(order.slice(0, 2).sort(), ['PLAN 08', 'PLAN 8 | the hall'])
  assert.equal(order[2], 'PLAN 8-A')
  assert.deepEqual(order.slice(3, 5).sort(), ['PLAN 8 v2', 'PLAN 8B'])
  assert.equal(order[5], 'PLAN 8 version 3')
})
