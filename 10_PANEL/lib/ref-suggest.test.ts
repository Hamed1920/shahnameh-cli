import assert from 'node:assert/strict'
import { test } from 'node:test'
import { suggestRefs, targetCandidates } from './ref-suggest.ts'
import type { CatalogEntity } from './types.ts'

const ent = (shortId: string, slug: string, name: string, looks: string[], canonical = ''): CatalogEntity => ({
  id: `SHM-${shortId}-${slug}`, shortId, kind: shortId.slice(0, 3), slug, name, canonical,
  variants: looks.map((variant) => ({ variant, path: '' })),
})

const CATALOG = [
  ent('CHR-001', 'ZAHHAK', 'Zahhak', ['V01', 'V02', 'V06'], 'V06'),
  ent('CHR-002', 'JAMSHID', 'Jamshid', ['V01', 'V03'], 'V01'),
  ent('LOC-010', 'THRONE-TAKHT-E-JAMSHID', 'Takht-e Jamshid - Throne', ['V01']),
  ent('LOC-004', 'MOUNTAIN-PASS', 'Mountain Pass', ['V01']),
  ent('PRP-001', 'STAFF-COBRA-BRONZE', 'Staff - Bronze Cobra', ['V01']),
  ent('PRP-002', 'STAFF-OLDWOOD-PLAIN', 'Staff - Plain Old Wood', ['V01']),
  ent('PRP-015', 'HARNESS-MOUNT', 'Mount Harness', []),
  ent('CRT-001', 'RIDING-BEAST-PALE-BEAKED', 'Riding Beast - Pale Beaked', ['V02']),
  ent('CRT-003', 'RIDING-BEAST-STONE-HIDE', 'Riding Beast - Stone Hide', ['V01']),
  ent('REF-001', 'BOARD-CIVILIZATION-CASTE', 'Civilization Caste Board', ['V02']),
]

const PROMPT = 'Jamshid runs past the throne toward the creature. He grips the harness, lifts his staff, and they pass on damp stone.'

test('names and telling words are found, with the look a recent job used', () => {
  const s = suggestRefs(PROMPT, CATALOG, [], ['@CHR-002/V03', '@REF-001/V02'])
  assert.deepEqual(s.found.map((f) => [f.token, f.matched]), [['@CHR-002/V03', 'Jamshid'], ['@LOC-010/V01', 'throne']])
})

test('prose words never match: "pass" and "stone" are not a location or a creature', () => {
  const s = suggestRefs(PROMPT, CATALOG)
  const all = [...s.found, ...s.groups.flatMap((g) => g.options)].map((f) => f.entity.shortId)
  assert.ok(!all.includes('LOC-004'))
  assert.ok(!s.groups.some((g) => g.word === 'stone'))
})

test('a shared word or a kind word is a pick-one group; an entity with no look is not offered', () => {
  const s = suggestRefs(PROMPT, CATALOG)
  assert.deepEqual(s.groups.map((g) => [g.word, g.options.map((o) => o.entity.shortId)]), [
    ['staff', ['PRP-001', 'PRP-002']],
    ['creature', ['CRT-001', 'CRT-003']],
  ])
  assert.ok(!s.found.some((f) => f.entity.shortId === 'PRP-015'))
})

test('nothing already attached is suggested, and recent fills in what the text never names', () => {
  const s = suggestRefs(PROMPT, CATALOG, ['@CHR-002/V01', '@CRT-001/V02'], ['@REF-001/V02', '@CHR-002/V03'])
  assert.ok(!s.found.some((f) => f.entity.shortId === 'CHR-002'))
  assert.ok(!s.groups.some((g) => g.word === 'creature'))
  assert.deepEqual(s.recent.map((r) => r.token), ['@REF-001/V02'])
})

test('filing candidates for a design image: its references first, else what it names', () => {
  assert.deepEqual(targetCandidates('a new look for Zahhak', ['@PRP-001/V01'], CATALOG).map((e) => e.shortId), ['PRP-001'])
  assert.deepEqual(targetCandidates('a new look for Zahhak', [], CATALOG).map((e) => e.shortId), ['CHR-001'])
  assert.deepEqual(targetCandidates('the mount harness, turnaround', [], CATALOG).map((e) => e.shortId), ['PRP-015'])
})
