import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectAssets, detectByKeywords, registerDetector } from './asset-detect.ts'
import {
  manualSlot, mergeDetected, orderedSlots, placeDocRefs, placeToken, refsOf, removeToken, type RefSlot,
} from './ref-slots.ts'
import type { CatalogEntity } from './types.ts'

const ent = (shortId: string, slug: string, name: string, looks: string[], canonical = ''): CatalogEntity => ({
  id: `SHM-${shortId}-${slug}`, shortId, kind: shortId.slice(0, 3), slug, name, canonical,
  variants: looks.map((variant) => ({ variant, path: '' })),
})

const CATALOG = [
  ent('CHR-001', 'ZAHHAK', 'Zahhak', ['V01', 'V06'], 'V06'),
  ent('CHR-002', 'JAMSHID', 'Jamshid', ['V01', 'V03'], 'V01'),
  ent('CHR-009', 'ARMAYEEL', 'Armayeel', []),
  ent('LOC-010', 'THRONE-TAKHT-E-JAMSHID', 'Takht-e Jamshid - Throne', ['V01']),
  ent('PRP-001', 'STAFF-COBRA-BRONZE', 'Staff - Bronze Cobra', ['V01']),
  ent('PRP-002', 'STAFF-OLDWOOD-PLAIN', 'Staff - Plain Old Wood', ['V01']),
]
const ctx = { catalog: CATALOG, recent: ['@CHR-002/V03'] }
const PROMPT = 'Jamshid and Armayeel stand before the throne. Jamshid lifts his staff.'

test('keywords: one asset per named thing, an entity with no look is an empty slot to fill, a shared word is pick-one', () => {
  const found = detectByKeywords(PROMPT, ctx)
  assert.deepEqual(found.map((a) => [a.kind, a.entity, a.token, a.candidates]), [
    ['CHR', 'CHR-002', '@CHR-002/V03', []],
    ['CHR', 'CHR-009', null, []],
    ['LOC', 'LOC-010', '@LOC-010/V01', []],
    ['PRP', null, null, ['@PRP-001/V01', '@PRP-002/V01']],
  ])
})

test('slots group by kind and the worker gets one list: slots in group order, then the tray', () => {
  const { slots } = mergeDetected([], ['@REF-001/V02'], detectByKeywords(PROMPT, ctx), CATALOG)
  assert.deepEqual(orderedSlots(slots).map((s) => s.label), ['Jamshid', 'Armayeel', 'Takht-e Jamshid - Throne', '“staff” · pick one'])
  assert.deepEqual(refsOf(slots, ['@REF-001/V02']), ['@CHR-002/V03', '@LOC-010/V01', '@REF-001/V02'])
})

test('a re-read keeps what Hamed filled, drops untouched slots the prompt stopped naming, adds new ones', () => {
  let s = mergeDetected([], [], detectByKeywords(PROMPT, ctx), CATALOG)
  const staff = s.slots.find((x) => x.matched === 'staff')!
  s = placeToken(s.slots, s.loose, '@PRP-002/V01', { slot: staff.key })
  s = mergeDetected(s.slots, s.loose, detectByKeywords('Zahhak waits alone.', ctx), CATALOG)
  assert.deepEqual(s.slots.map((x) => x.label), ['“staff” · pick one', 'Zahhak'])
  assert.deepEqual(refsOf(s.slots, s.loose), ['@CHR-001/V06', '@PRP-002/V01'])
})

test('dragging: slot to slot swaps, onto a filled slot from outside sends the old one to the tray', () => {
  let s = mergeDetected([], [], detectByKeywords(PROMPT, ctx), CATALOG)
  const [jam, arm] = s.slots
  s = placeToken(s.slots, s.loose, '@CHR-002/V03', { slot: arm.key })
  assert.equal(s.slots.find((x) => x.key === arm.key)!.token, '@CHR-002/V03')
  assert.equal(s.slots.find((x) => x.key === jam.key)!.token, null)
  s = placeToken(s.slots, s.loose, '@CHR-001/V06', { slot: arm.key })
  assert.deepEqual(s.loose, ['@CHR-002/V03'])
  s = placeToken(s.slots, s.loose, '@CHR-002/V03', { slot: jam.key })
  assert.deepEqual(s.loose, [])
  s = placeToken(s.slots, s.loose, '@CHR-002/V03', { tray: 0 })
  assert.equal(s.slots.find((x) => x.key === jam.key)!.token, null)
  assert.deepEqual(removeToken(s.slots, s.loose, '@CHR-002/V03').loose, [])
})

test('document refs land in the slot of their entity; unknown tokens go to the tray', () => {
  const s = placeDocRefs(['@CHR-001/V01', '@LOC-010', '@XYZ-001'], CATALOG)
  assert.deepEqual(s.slots.map((x) => [x.kind, x.token]), [['CHR', '@CHR-001/V01'], ['LOC', '@LOC-010']])
  assert.deepEqual(s.loose, ['@XYZ-001'])
  // And a later reading of the prompt does not add a second Zahhak slot.
  const merged = mergeDetected(s.slots, s.loose, detectByKeywords('Zahhak at the throne', ctx), CATALOG)
  assert.equal(merged.slots.filter((x) => x.entity === 'CHR-001').length, 1)
})

test('hand-added slots are numbered per group', () => {
  const a = manualSlot([], 'CHR')
  const b = manualSlot([a], 'CHR')
  const c = manualSlot([a, b], 'VEH')
  assert.deepEqual([a.label, b.label, c.label], ['Character 1', 'Character 2', 'Prop 1'])
})

test('a registered detector can name new things; a failing one falls back to keywords', async () => {
  registerDetector({ id: 'fake', detect: async () => [{ kind: 'CHR', entity: null, token: null, proposal: { name: 'Kaveh' }, candidates: [], matched: 'Kaveh' }] })
  registerDetector({ id: 'broken', detect: async () => { throw new Error('no key') } })
  const fake = await detectAssets('Kaveh raises the banner', ctx, 'fake')
  const merged = mergeDetected([] as RefSlot[], [], fake, CATALOG, 'ai')
  assert.deepEqual(merged.slots.map((s) => [s.label, s.proposal?.name, s.source]), [['Kaveh', 'Kaveh', 'ai']])
  assert.equal((await detectAssets(PROMPT, ctx, 'broken')).length, 4)
})
