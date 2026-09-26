import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectFormat, parsePromptDocument, parseParams } from './prompt-parser.ts'
import { docxXmlToText } from './documents-xml.ts'

const PERSIAN = 'زهاک روی سکوی سنگی نشسته‌است، مار‌ها آرام تکان می‌خورند.'

test('batch JSON array', () => {
  const r = parsePromptDocument(JSON.stringify([
    { label: 'P01', target: 'SHM-EP001-SC001-SH0010', model: 'seedance_2_5', refs: ['@CHR-001/V02'], params: { aspect_ratio: '16:9', duration: 15, generate_audio: 'false' }, prompt: 'a prompt' },
    { target: 'PRP-002', prompt: PERSIAN },
  ]))
  assert.equal(r.format, 'batch-json')
  assert.equal(r.rows.length, 2)
  assert.equal(r.rows[0].key, 'r1')
  assert.equal(r.rows[0].params.duration, '15')
  assert.equal(r.rows[0].params.generate_audio, 'false')
  assert.deepEqual(r.rows[0].refs, ['@CHR-001/V02'])
  assert.equal(r.rows[1].prompt, PERSIAN)
})

test('SHM-JOB blocks keep the body byte for byte and skip non-generation types', () => {
  const doc = [
    '=== SHM-JOB ===', 'job_id: J-20260903-001', 'type: generate.video', 'target: NEW/PRP/STAFF-IRON-CAPPED',
    'refs: @CHR-001/V02; @PRP-001', 'params: ar=16:9; duration=15', 'notes: reads at 1/3 frame',
    '--- prompt ---', PERSIAN, '', 'Second line: with colons; and "quotes".', '--- end prompt ---', '=== END SHM-JOB ===',
    '', '=== SHM-JOB ===', 'job_id: J-20260903-002', 'type: register.entity', 'target: NEW/LOC/SOMEWHERE', '=== END SHM-JOB ===',
  ].join('\r\n')
  assert.equal(detectFormat(doc), 'shm-job')
  const r = parsePromptDocument(doc)
  assert.equal(r.rows.length, 1)
  const row = r.rows[0]
  assert.equal(row.label, 'J-20260903-001')
  assert.equal(row.target, 'NEW/PRP/STAFF-IRON-CAPPED')
  assert.equal(row.stage, 'draft')
  assert.deepEqual(row.refs, ['@CHR-001/V02', '@PRP-001'])
  assert.deepEqual(row.params, { aspect_ratio: '16:9', duration: '15' })
  assert.equal(row.prompt, `${PERSIAN}\n\nSecond line: with colons; and "quotes".`)
  assert.match(r.warnings[0], /register\.entity/)
})

test('free text split on P01/P02 headings, SHOT lines stay inside a block', () => {
  const doc = [
    'GLOBAL RULES', 'No masks that look like skulls.', '',
    'P01', 'target: SHM-EP001-SC001-SH0010', 'SHOT 1 — CONVERGENCE — 0:00–0:07:', 'wide plain.', 'SHOT 2 — APPROACH — 0:07–0:15:', 'they arrive.', '',
    '# P02 — the hall', 'Inside the hall, @LOC-009 and @CHR-001/V02 face each other.',
  ].join('\n')
  const r = parsePromptDocument(doc)
  assert.equal(r.format, 'text')
  assert.equal(r.preamble, 'GLOBAL RULES\nNo masks that look like skulls.')
  assert.equal(r.split, 'block')
  assert.equal(r.rows.length, 2)
  assert.equal(r.rows[0].label, 'P01')
  assert.equal(r.rows[0].target, 'SHM-EP001-SC001-SH0010')
  assert.equal(r.rows[0].prompt, 'SHOT 1 — CONVERGENCE — 0:00–0:07:\nwide plain.\nSHOT 2 — APPROACH — 0:07–0:15:\nthey arrive.')
  assert.equal(r.rows[1].label, 'P02 — the hall')
  assert.deepEqual(r.rows[1].refs, ['@LOC-009', '@CHR-001/V02'])
  assert.match(r.rows[1].warnings[0], /mentions/)
})

test('free text without prompt headings stays one prompt; blank lines are only offered', () => {
  const doc = 'first prompt\nsecond line\n\n\nsecond prompt\n\nstill second prompt\n\n\nthird'
  const r = parsePromptDocument(doc)
  assert.equal(r.split, 'none')
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].prompt, doc)
  assert.deepEqual(r.splitOptions, [{ mode: 'none', count: 1 }, { mode: 'blank', count: 3 }])
  const cut = parsePromptDocument(doc, { split: 'blank' })
  assert.equal(cut.split, 'blank')
  assert.equal(cut.rows.length, 3)
  assert.equal(cut.rows[1].prompt, 'second prompt\n\nstill second prompt')
})

test('one 15-second block written as SHOT 1..N is one prompt, with a SHOT split offered', () => {
  const doc = [
    'Create one 15-second horizontal 16:9 video block of exactly three handheld shots.', '', 'No dialogue.', '', '',
    'SHOT 1 — RUNNING — 0:00–0:05:', '', 'He runs.', '', '',
    'SHOT 2 — SEES IT — 0:05–0:10:', '', 'He slows.', '', '',
    'SHOT 3 — DEPARTURE — 0:10–0:15:', '', 'They leave.', '', '',
    'CAMERA LANGUAGE:', '', 'No gimbal.', '', '', 'SOUND:', '', 'No music.',
  ].join('\n')
  const r = parsePromptDocument(doc)
  assert.equal(r.rows.length, 1)
  assert.equal(r.preamble, null)
  assert.equal(r.rows[0].prompt, doc)
  assert.deepEqual(r.splitOptions.map((o) => o.mode), ['none', 'shot', 'blank'])
  assert.equal(r.splitOptions.find((o) => o.mode === 'shot')?.count, 3)
  const shots = parsePromptDocument(doc, { split: 'shot' })
  assert.equal(shots.rows.length, 3)
  assert.match(shots.preamble ?? '', /^Create one 15-second/)
})

test('a split the document does not allow falls back to one prompt', () => {
  const r = parsePromptDocument('just one prompt\nwith two lines', { split: 'shot' })
  assert.equal(r.split, 'none')
  assert.equal(r.rows.length, 1)
})

test('Persian numbered headings and digits', () => {
  const doc = ['پرامپت ۱', PERSIAN, '', 'پرامپت ۲', 'دومین پرامپت'].join('\n')
  const r = parsePromptDocument(doc)
  assert.equal(r.rows.length, 2)
  assert.equal(r.rows[0].label, 'پرامپت 1')
  assert.equal(r.rows[0].prompt, PERSIAN)
  assert.equal(r.rows[1].label, 'پرامپت 2')
  assert.equal(parsePromptDocument(doc, { split: 'none' }).rows.length, 1)
})

test('numbered list items separated by blank lines split only when chosen', () => {
  const doc = '1. first one\n\n2) second one\nmore\n\n۳. سومی'
  assert.equal(parsePromptDocument(doc).rows.length, 1)
  const r = parsePromptDocument(doc, { split: 'numbered' })
  assert.equal(r.rows.length, 3)
  assert.equal(r.rows[1].prompt, 'second one\nmore')
  assert.equal(r.rows[2].label, '#3')
})

test('single block when nothing splits', () => {
  const r = parsePromptDocument('just one prompt\nwith two lines')
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].prompt, 'just one prompt\nwith two lines')
})

test('param aliases', () => {
  assert.deepEqual(parseParams('ar=9:16; res=720p; sound=false; Duration=5'), { aspect_ratio: '9:16', resolution: '720p', generate_audio: 'false', duration: '5' })
})

test('docx XML to text keeps Persian and ZWNJ, turns paragraphs and breaks into newlines', () => {
  const xml = `<?xml version="1.0"?><w:document><w:body>` +
    `<w:p><w:r><w:t>P01</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">${PERSIAN}</w:t></w:r><w:r><w:br/><w:t>line two &amp; &quot;q&quot; &#1587;</w:t></w:r></w:p>` +
    `<w:p/><w:p><w:r><w:tab/><w:t>tabbed</w:t></w:r></w:p></w:body></w:document>`
  const text = docxXmlToText(xml)
  assert.equal(text, `P01\n${PERSIAN}\nline two & "q" س\n\n\ttabbed`)
  assert.ok(text.includes('‌'))
})

test('one P01 prompt pasted alone: its target and refs are metadata, not prompt text', () => {
  const r = parsePromptDocument('P01\ntarget: SHM-EP001-SC001-SH0010\nrefs: @LOC-018/V01\nA slow wide shot of a cold plain.')
  assert.equal(r.split, 'block')
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].label, 'P01')
  assert.equal(r.rows[0].target, 'SHM-EP001-SC001-SH0010')
  assert.deepEqual(r.rows[0].refs, ['@LOC-018/V01'])
  assert.equal(r.rows[0].prompt, 'A slow wide shot of a cold plain.')
})

test('blank lines between a heading and its metadata do not end the metadata', () => {
  const r = parsePromptDocument('P01\n\n\ntarget: PRP-002\n\nThe prompt.')
  assert.equal(r.rows[0].target, 'PRP-002')
  assert.equal(r.rows[0].prompt, 'The prompt.')
})

test('a heading that does not open the document is still prompt text', () => {
  const r = parsePromptDocument('A wide shot.\nP01 is the palace gate.')
  assert.equal(r.split, 'none')
  assert.equal(r.rows[0].prompt, 'A wide shot.\nP01 is the palace gate.')
})

test('a single SHOT heading never cuts a prompt', () => {
  const r = parsePromptDocument('SHOT 1 — CONVERGENCE\nRiders meet on the road.')
  assert.equal(r.split, 'none')
  assert.match(r.rows[0].prompt, /^SHOT 1/)
})