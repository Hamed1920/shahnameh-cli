import assert from 'node:assert/strict'
import { test } from 'node:test'
import { descriptorOf, planCopy } from './copy-assets.ts'
import type { LibraryEntity } from './types.ts'

const look = (variant: string, filename: string, role = 'HERO') => ({
  variant, usedBy: [], takes: 1, role, status: 'CONCEPT', path: `01_CHARACTERS/${filename}`, filename, source: '', added: '',
})
const ent = (shortId: string, name: string, looks: ReturnType<typeof look>[], extra: Partial<LibraryEntity> = {}): LibraryEntity => ({
  id: `SHM-${shortId}-X`, shortId, kind: shortId.slice(0, 3), number: shortId.slice(4), slug: 'X', name, family: 'X', status: 'CONCEPT',
  canonical: looks[0]?.variant ?? '', description: `${name} desc`, flags: [], looks, ...extra,
})

test('descriptorOf reads the wording after the variant and take', () => {
  assert.equal(descriptorOf('SHM-CHR-002-JAMSHID_V04_china-disguise.jpg'), 'china-disguise')
  assert.equal(descriptorOf('SHM-CHR-002-JAMSHID_V04_T02_china-disguise.jpg'), 'china-disguise')
  assert.equal(descriptorOf('plain.png'), '')
})

test('the main look leads and the rest are grouped under it', () => {
  const e = ent('CHR-002', 'Jamshid', [look('V01', 'a_V01_front.png'), look('V04', 'a_V04_china.jpg', 'TURNAROUND')], { canonical: 'V04' })
  const { batches, skipped } = planCopy([e], new Set(), 'SHM')
  assert.equal(skipped.length, 0)
  const [lead, second] = batches[0].uploads
  assert.deepEqual([lead.mode, lead.kind, lead.name, lead.from], ['new', 'CHR', 'Jamshid', '01_CHARACTERS/a_V04_china.jpg'])
  assert.deepEqual([second.mode, second.groupOf, second.kind], ['variant', lead.id, undefined])
  assert.match(lead.description, /copied from SHM CHR-002/)
})

test('an entity the target already has, a retired one and a non-English one are skipped with a reason', () => {
  const have = ent('CHR-001', 'Zahhak', [look('V01', 'z_V01_x.png')])
  const retired = ent('CHR-003', 'Old', [look('V01', 'o_V01_x.png')], { status: 'RETIRED' })
  const farsi = ent('CHR-004', 'ضحاک', [look('V01', 'f_V01_x.png')])
  const { batches, skipped } = planCopy([have, retired, farsi], new Set(['ZAHHAK']), 'SHM')
  assert.equal(batches.length, 0)
  assert.deepEqual(skipped.map((s) => s.shortId), ['CHR-001', 'CHR-003', 'CHR-004'])
})

test('a look role the add does not accept becomes PLATE, and batches stay within 40 uploads', () => {
  const many = Array.from({ length: 30 }, (_, i) => ent(`LOC-${String(i + 1).padStart(3, '0')}`, `Place ${i}`, [look('V01', 'p_V01_a.png', 'RENDER'), look('V02', 'p_V02_b.png')]))
  const { batches } = planCopy(many, new Set(), 'SHM')
  assert.ok(batches.length >= 2)
  assert.ok(batches.every((b) => b.uploads.length <= 40))
  assert.equal(batches[0].uploads[0].role, 'PLATE')
})
