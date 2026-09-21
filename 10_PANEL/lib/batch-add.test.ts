import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkProposal, cleanStem, inferKind, parseIdInName, proposeBatch, proposeOne } from './batch-add.ts'
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
  ent('CRT-003', 'RIDING-BEAST-STONE-HIDE', 'Riding Beast - Stone Hide', ['V01']),
  ent('REF-001', 'BOARD-CIVILIZATION-CASTE', 'Civilization Caste Board', ['V02']),
]

const CTX = { code: 'SHM', catalog: CATALOG }
const one = (filename: string) => proposeOne(filename, CTX)

// ---------------------------------------------------------------- reading a name

test('a filename that already carries a full ID files against it, ignoring the look', () => {
  const p = one('SHM-CHR-001-ZAHHAK_V02_T03_tighter-head-detail.png')
  assert.equal(p.mode, 'variant')
  assert.equal(p.entity, 'SHM-CHR-001-ZAHHAK')
  assert.equal(p.descriptor, 'tighter-head-detail')
  assert.equal(p.confidence, 'high')
  assert.match(p.why, /V02 in the name is ignored/)
  assert.deepEqual(p.needs, [])
})

test('the short form works too', () => {
  const p = one('CHR-002_night-robe.png')
  assert.equal(p.entity, 'SHM-CHR-002-JAMSHID')
  assert.equal(p.descriptor, 'night-robe')
})

test('an ID that is not in the index is never filed against', () => {
  const p = one('SHM-CHR-042-NOBODY_V01_x.png')
  assert.equal(p.confidence, 'none')
  assert.ok(p.needs.includes('entity'))
  assert.match(p.why, /CHR-042 is not in the index/)
})

test('footage is turned away rather than filed as a reference', () => {
  const p = one('SHM-EP001-SC014-SH0030_V01_T02.mp4')
  assert.equal(p.confidence, 'none')
  assert.match(p.why, /Episodes page/)
})

// ---------------------------------------------------------------- matching the index

test('a name in the filename attaches to that entity', () => {
  const p = one('zahhak-night-robe.jpg')
  assert.equal(p.mode, 'variant')
  assert.equal(p.entity, 'SHM-CHR-001-ZAHHAK')
  assert.equal(p.confidence, 'high')
  // It already has looks, so another one is a PLATE, not a HERO.
  assert.equal(p.role, 'PLATE')
  // The entity's own name is not repeated in the descriptor.
  assert.equal(p.descriptor, 'night-robe')
})

test('the first look of something that has none is its HERO', () => {
  const p = one('mount-harness.png')
  assert.equal(p.entity, 'SHM-PRP-015-HARNESS-MOUNT')
  assert.equal(p.role, 'HERO')
})

test('a word several entities share asks which, and never picks one', () => {
  const p = one('staff.png')
  assert.equal(p.mode, 'new')
  assert.equal(p.confidence, 'none')
  assert.ok(p.needs.includes('entity'))
  assert.deepEqual(p.candidates, ['SHM-PRP-001-STAFF-COBRA-BRONZE', 'SHM-PRP-002-STAFF-OLDWOOD-PLAIN'])
})

test('ordinary prose words do not drag in an entity', () => {
  const p = one('stone-corridor.png')
  assert.equal(p.mode, 'new')
  assert.equal(p.entity, '')
  assert.equal(p.kind, 'LOC')
})

// ---------------------------------------------------------------- new things

test('a kind word names the kind, read from the end of the name', () => {
  assert.equal(inferKind(['palace', 'guard', 'costume'])?.kind, 'COS')
  assert.equal(inferKind(['throne', 'room'])?.kind, 'LOC')
  assert.equal(inferKind(['clay', 'tablet'])?.kind, 'PRP')
})

test('no kind word means the row asks for a kind', () => {
  const p = one('sagging-lantern.png')
  assert.equal(p.kind, '')
  assert.ok(p.needs.includes('kind'))
  assert.equal(p.confidence, 'none')
})

test('roles come from the words', () => {
  assert.equal(one('bronze-lantern-moodboard.png').role, 'BOARD')
  assert.equal(one('clay-tablet-turnaround.png').role, 'TURNAROUND')
  assert.equal(one('zahhak-mask-closeup.png').role, 'DETAIL')
})

// ---------------------------------------------------------------- filename noise

test('camera and export litter leaves nothing to go on, and says so', () => {
  for (const name of ['IMG_1234 (1) copy.jpg', 'Screenshot 2026-09-03 at 12.56.31.png', 'DSC_0042.JPG', '202609031256.png']) {
    const p = one(name)
    assert.equal(p.confidence, 'none', name)
    assert.ok(p.needs.includes('name'), name)
    assert.match(p.why, /says what this is/)
  }
})

test('a real Higgsfield export name still reads', () => {
  const { tokens, counter } = cleanStem('group_of_primitive_fire_priests3.png_202609031257.jpeg')
  assert.deepEqual(tokens, ['group', 'primitive', 'fire', 'priests'])
  assert.equal(counter, 3)
})

test('a descriptor never keeps a digit run', () => {
  assert.ok(!/\d{4}/.test(one('Man_walking_with_black_snakes_202609031256.jpeg').descriptor))
})

// ---------------------------------------------------------------- grouping

test('files of one new thing become one entity with ordered looks', () => {
  const out = proposeBatch(['clay-tablet_02.png', 'clay-tablet_01.png', 'clay-tablet_03.png'], CTX)
  // Ordered by the number in the name, not by drop order.
  const lead = out[1]
  assert.equal(lead.mode, 'new')
  assert.equal(lead.kind, 'PRP')
  assert.equal(lead.name, 'Clay Tablet')
  assert.match(lead.why, /3 files look like one new thing/)
  assert.deepEqual([out[0].mode, out[2].mode], ['variant', 'variant'])
  assert.deepEqual([out[0].groupOf, out[2].groupOf], [1, 1])
  // The leader is V01; the others follow it, and name nothing themselves.
  assert.equal(out[0].name, '')
  assert.equal(out[0].entity, '')
})

test('view words are looks of one thing, not different things', () => {
  const out = proposeBatch(['temple-lantern-front.png', 'temple-lantern-side.png', 'temple-lantern-back.png'], CTX)
  assert.equal(out[0].mode, 'new')
  assert.equal(out[0].name, 'Temple Lantern')
  assert.deepEqual([out[1].groupOf, out[2].groupOf], [0, 0])
  // Each keeps its own descriptor, so the looks stay tellable apart on disk.
  assert.deepEqual(out.map((p) => p.descriptor), ['temple-lantern-front', 'temple-lantern-side', 'temple-lantern-back'])
})

test('two files with nothing to say are never folded into one entity', () => {
  const out = proposeBatch(['IMG_0001.jpg', 'IMG_0002.jpg'], CTX)
  assert.deepEqual(out.map((p) => p.groupOf), [-1, -1])
  assert.deepEqual(out.map((p) => p.confidence), ['none', 'none'])
})

test('two rows proposing the same new name are grouped, not left to collide', () => {
  const out = proposeBatch(['bronze-lantern.png', 'bronze-lantern-2.png'], CTX)
  assert.equal(out[0].mode, 'new')
  assert.equal(out[1].groupOf, 0)
})

test('several files of the same existing entity need no grouping at all', () => {
  const out = proposeBatch(['zahhak-night.png', 'zahhak-dawn.png'], CTX)
  assert.deepEqual(out.map((p) => p.mode), ['variant', 'variant'])
  assert.deepEqual(out.map((p) => p.groupOf), [-1, -1])
  assert.deepEqual(out.map((p) => p.entity), ['SHM-CHR-001-ZAHHAK', 'SHM-CHR-001-ZAHHAK'])
})

test('the same drop always proposes the same thing', () => {
  const names = ['clay-tablet_01.png', 'zahhak-night.png', 'IMG_0001.jpg']
  const copy = [...names]
  assert.deepEqual(proposeBatch(names, CTX), proposeBatch(names, CTX))
  assert.deepEqual(names, copy)
})

// ---------------------------------------------------------------- checking

test('a row that still needs something cannot be submitted', () => {
  const batch = proposeBatch(['sagging-lantern.png'], CTX)
  assert.ok(checkProposal(batch[0], CATALOG, batch, 0).some((p) => /kind/i.test(p)))
})

test('a new name that already exists is refused, pointing at the entity', () => {
  const batch = proposeBatch(['clay-tablet.png'], CTX)
  const named = [{ ...batch[0], kind: 'PRP', name: 'Zahhak', needs: [] }]
  assert.ok(checkProposal(named[0], CATALOG, named, 0).some((p) => /already exists as CHR-001/.test(p)))
})

test('a group may only point backwards, at a new entity, one level deep', () => {
  const [lead, member] = proposeBatch(['clay-tablet_01.png', 'clay-tablet_02.png'], CTX)
  assert.deepEqual(checkProposal(member, CATALOG, [lead, member], 1), [])

  const forward = { ...member, groupOf: 1 }
  assert.ok(checkProposal(forward, CATALOG, [forward, lead], 0).some((p) => /not earlier/.test(p)))

  const atExisting = { ...member, groupOf: 0 }
  const existingLead = { ...lead, mode: 'variant' as const, entity: 'SHM-CHR-001-ZAHHAK' }
  assert.ok(checkProposal(atExisting, CATALOG, [existingLead, atExisting], 1).some((p) => /not a new entity/.test(p)))

  const chained = { ...member, groupOf: 0 }
  const chainedLead = { ...lead, groupOf: 5 }
  assert.ok(checkProposal(chained, CATALOG, [chainedLead, chained], 1).some((p) => /one level deep/.test(p)))
})

test('a non-English name is refused, because the registry is read by PowerShell', () => {
  const batch = proposeBatch(['clay-tablet.png'], CTX)
  const farsi = [{ ...batch[0], kind: 'PRP', name: 'لوح', needs: [] }]
  assert.ok(checkProposal(farsi[0], CATALOG, farsi, 0).some((p) => /English/.test(p)))
})

test('parseIdInName leaves a name with no id alone', () => {
  assert.equal(parseIdInName('zahhak-night-robe.jpg', 'SHM'), null)
  assert.equal(parseIdInName('CHR-001.png', 'SHM')?.shortId, 'CHR-001')
})
