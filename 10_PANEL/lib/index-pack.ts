import { getAssets, getEntities, getKnownShots, getQueue } from './store'
import { KIND_LABEL, KINDS, type Kind } from './indexing'
import { latestEpisode, previewScenes } from './scenes'
import { thumbnail } from './thumbs'
import { FAINT, MUTED, PdfWriter, type Cell } from './pdf-writer'
import type { AssetRow, Entity } from './types'

/**
 * The reference pack: a PDF to attach to ChatGPT, Gemini or Claude before
 * asking them for prompts, so they reference the index correctly.
 *
 *   full   how to reference and how to write a prompt document for the
 *          Prompts page, the scenes queued so far, then the index
 *   index  the index alone, with a three-line token legend
 *
 * Built from the registries on every download, so it is never stale. The
 * guide describes what the parser (lib/prompt-parser.ts), the targets
 * (lib/batch-rules.ts, lib/scenes.ts) and the worker's reference handling
 * (worker/lib/prompt.mjs) actually do; change it when they change.
 */

export type PackPart = 'full' | 'index'

interface Look {
  variant: string
  row: AssetRow
  takes: number
  note: string
}

function looksOf(entity: Entity, assets: AssetRow[]): Look[] {
  const mine = assets.filter((a) => a.entity_id === entity.id)
  return [...new Set(mine.map((a) => a.variant))].sort().map((variant) => {
    const rows = mine.filter((a) => a.variant === variant).sort((a, b) => b.take.localeCompare(a.take))
    return { variant, row: rows[0], takes: rows.length, note: rows.map((r) => meaningful(r.notes)).find(Boolean) ?? '' }
  })
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s)

/** Registry notes minus filing bookkeeping ("Uploaded by hamed on rev_mu158x3cd98h."), which tells a writer nothing. */
const meaningful = (s: string | undefined) => String(s ?? '').replace(/Uploaded by \S+ on \S+?\.?(?=\s|$)/gi, '').replace(/\s+/g, ' ').trim()

export async function buildIndexPack(part: PackPart): Promise<Uint8Array> {
  const [all, assets, queue, knownShots] = await Promise.all([getEntities(), getAssets(), getQueue(), getKnownShots()])
  const entities = all
    .filter((e) => e.status !== 'RETIRED')
    .sort((a, b) => (KINDS.indexOf(a.kind as Kind) - KINDS.indexOf(b.kind as Kind)) || a.number.localeCompare(b.number))
  const episode = latestEpisode(knownShots)
  const nextScene = previewScenes([{ key: 'next', auto: true, episode, shot: '' }], knownShots).get('next')!.replace(/^SHM-/, '')
  const date = new Date().toISOString().slice(0, 10)
  const looks = entities.reduce((n, e) => n + looksOf(e, assets).length, 0)

  const doc = await PdfWriter.create(part === 'full' ? 'Shahnameh reference pack' : 'Shahnameh index')
  doc.title(
    part === 'full' ? 'Shahnameh - Reference Pack' : 'Shahnameh - Index',
    `Generated ${date} from the project registries. ${entities.length} entities, ${looks} looks. Next free scene: ${nextScene}.`,
  )

  if (part === 'full') guide(doc, nextScene)
  else {
    doc.text('How to reference: write the token shown under each picture.', { face: 'bold', size: 10, after: 3 })
    doc.bullets([
      '@CHR-002/V03 is that exact look. Always prefer naming the look.',
      '@CHR-002 is the entity\'s main look (marked "main").',
      'Entities marked "no look yet" have no picture: describe them in words, never write an @ token for them.',
    ])
  }

  if (part === 'full') scenes(doc, queue, nextScene)

  doc.heading('The index')
  doc.text('Grouped by kind. Each picture is the image the token sends to the model.', { color: MUTED, after: 8 })
  for (const kind of KINDS) {
    const group = entities.filter((e) => e.kind === kind)
    if (group.length === 0) continue
    doc.heading(`${KIND_LABEL[kind]} (${kind})`, 2)
    for (const e of group) await entityBlock(doc, e, looksOf(e, assets))
  }

  return doc.finish(`Shahnameh ${part === 'full' ? 'reference pack' : 'index'} - ${date}`)
}

async function entityBlock(doc: PdfWriter, e: Entity, looks: Look[]) {
  doc.ensure(looks.length ? 190 : 70)
  doc.space(4)
  doc.text(`${e.short_id}   ${e.name}`, { face: 'bold', size: 11, lead: 1.3, after: 1 })
  const facts = [
    e.id,
    e.status && `status ${e.status}`,
    e.family && `family ${e.family}`,
    looks.length ? `main look ${e.canonical_variant || 'none set'}` : 'no look yet',
  ].filter(Boolean).join('   ')
  doc.text(facts, { face: 'mono', size: 7.5, color: MUTED, after: 3 })
  if (meaningful(e.description)) doc.text(meaningful(e.description), { size: 9, after: 3 })
  if (e.related) doc.text(`Related: ${e.related.split(';').map((r) => r.trim().replace(/^SHM-/, '').split('-').slice(0, 2).join('-')).join(', ')}`, { size: 8, color: MUTED, after: 3 })

  if (looks.length === 0) {
    doc.text('No look yet. Describe it in words; do not write an @ token for it.', { size: 8.5, color: FAINT, after: 8 })
    doc.rule(8)
    return
  }
  doc.space(4)
  const cells: Cell[] = await Promise.all(looks.map(async (l) => ({
    jpg: await thumbnail(`${l.row.folder}/${l.row.filename}`, 240),
    caption: [
      `@${e.short_id}/${l.variant}${l.variant === e.canonical_variant ? '  main' : ''}`,
      [l.row.role, l.takes > 1 ? `${l.takes} takes` : ''].filter(Boolean).join(' - '),
      ...(l.note ? [short(l.note, 110)] : []),
    ],
  })))
  await doc.grid(cells, 4)
  doc.rule(8)
}

function guide(doc: PdfWriter, nextScene: string) {
  doc.heading('Read this first')
  doc.text(
    'You are writing prompts for a modern adaptation of the Shahnameh. They are pasted into a production panel that sends ' +
    'each prompt to a video or image model, attaches reference pictures from the index at the end of this document, and ' +
    'files every result under an ID. The index is the only source of truth for what exists and what it looks like.',
  )
  doc.bullets([
    'Refer to every character, place, prop and creature by its index ID, never by a loose description. There are several staffs, several gates and three riding beasts; only the ID says which.',
    'Only reference what is in the index. Never invent an ID, a number or a look.',
    `Do not number scenes. Leave the target out of a new video prompt and the panel gives it the next free scene (today ${nextScene}).`,
    'An entity marked "no look yet" has no picture. Describe it in words and do not write an @ token for it.',
  ])

  doc.heading('Reference tokens', 2)
  doc.code([
    '@CHR-002/V03       that exact look of Jamshid       (preferred)',
    '@CHR-002           Jamshid\'s main look',
    '@CHR-002/V03/T02   one specific take of that look   (rarely needed)',
  ])
  doc.bullets([
    'Every token in a prompt\'s refs: line is attached as a picture, in that order.',
    'Where the same token appears in the prompt text, the panel replaces it with that picture, so the model knows exactly which image is which. Write the identical token in both places: @CHR-002 in the text does not match @CHR-002/V03 in refs.',
    'A picture in refs that the text never mentions is still attached, with one line naming it. Mentioning it where it matters is better.',
    'Pick the look that fits the moment: the pictures in the index show what each look is. The same entity can have looks that differ a lot.',
  ])

  doc.heading('The naming law', 2)
  doc.bullets([
    'IDs are SHM-KIND-NNN-SLUG; the short form KIND-NNN is what you write. Kinds: CHR character, GRP group or caste, LOC location, PRP prop, CRT creature, COS costume, VEH vehicle, FX effect, REF reference board.',
    'A different physical object has a different number. The same object with a different look is the same number with a new look (V01, V02 ...). The same look generated again is a new take (T01, T02 ...).',
    'Footage is filed under shot IDs: SHM-EP001-SC014-SH0010 is episode 1, scene 14, shot 10. One 15-second prompt is one scene.',
  ])

  doc.heading('How to write a prompt document', 2)
  doc.bullets([
    'Start each prompt with a heading line: P01, P02 ... (PROMPT 1 also works). A document without these headings is treated as one single prompt.',
    'SHOT 1, SHOT 2 ... headings inside a prompt are fine; they stay part of that prompt.',
    'The lines directly under the heading, before the first blank line, set up that prompt. Use only these keys: refs, params, target, variant, label, notes.',
    'After one blank line, write the prompt exactly as it should be sent. Nothing is reworded.',
  ])
  doc.code([
    'P14 - Jamshid escapes on the riding beast',
    'refs: @CHR-002/V03; @CRT-001/V02; @LOC-011/V01',
    'params: ar=16:9; duration=15',
    '',
    'Create one 15-second horizontal 16:9 cinematic video block.',
    '@CHR-002/V03 runs into the underground holding chamber of @LOC-011/V01.',
    '@CRT-001/V02 turns its heavy head toward him ...',
    '',
    'P15 - The chamber empties',
    'refs: @LOC-011/V01',
    '',
    '...',
  ])

  doc.heading('Where a result is filed (target)', 2)
  doc.bullets([
    `New footage: leave target out. It becomes the next free scene (today ${nextScene}); the panel numbers it on approval.`,
    'Another take of a scene that already exists: target: SHM-EP001-SC013-SH0010.',
    'A design image, such as a new look or a sheet of something in the index: target: CHR-002 and variant: the next unused look after those listed for it.',
    'Something that is not in the index yet: target: NEW/PRP/IRANIAN-WAR-BANNER (kind, then an English slug). The panel gives it a number on approval. Do not reference it with @ until it has one.',
  ])

  doc.heading('Before you send', 2)
  doc.bullets([
    'Every @ token exists in the index below, with that exact look.',
    'The tokens in refs: and in the text match character for character.',
    'No invented IDs, numbers or scenes.',
    'One heading per prompt; one 15-second block per prompt.',
  ])
}

function scenes(doc: PdfWriter, queue: Awaited<ReturnType<typeof getQueue>>, nextScene: string) {
  type Job = (typeof queue)[number] & { label?: string | null; basePrompt?: string }
  const byScene = new Map<string, Job[]>()
  for (const j of queue as Job[]) {
    if (!/^SHM-EP\d{3}-SC\d{3}/.test(j.target)) continue
    byScene.set(j.target, [...(byScene.get(j.target) ?? []), j])
  }
  if (byScene.size === 0) return

  doc.heading('Scenes so far')
  doc.text(
    `Every scene already queued, with the references its latest version used. Keep looks consistent with these unless the story changes them. The next new scene is ${nextScene}.`,
    { color: MUTED, after: 8 },
  )
  for (const [target, jobs] of [...byScene].sort(([a], [b]) => a.localeCompare(b))) {
    const last = jobs[jobs.length - 1]
    const label = [...jobs].reverse().find((j) => j.label)?.label ?? ''
    const opening = (last.basePrompt ?? last.prompt ?? '').replace(/\s+/g, ' ').trim()
    doc.ensure(60)
    doc.text(`${target.replace(/^SHM-/, '')}${label ? `   ${label}` : ''}`, { face: 'bold', size: 9.5, lead: 1.3, after: 1 })
    doc.text(`refs: ${(last.refs ?? []).join('; ') || 'none'}   (${jobs.length} version${jobs.length === 1 ? '' : 's'})`, { face: 'mono', size: 7.5, color: MUTED, after: 1 })
    if (opening) doc.text(short(opening, 260), { size: 8, color: MUTED, after: 7 })
  }
}
