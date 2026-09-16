/**
 * Turn a pasted or dropped document into prompt rows, deterministically.
 *
 * Three formats are recognised:
 *   - batch JSON, the array enqueue-batch.mjs has always taken
 *   - SHM-JOB blocks, as Claude Chat / Cowork write them (SYNC_PROTOCOL.md §4)
 *   - free text: one prompt, unless it has P01 / PROMPT 2 / BLOCK 3 headings.
 *     SHOT headings, numbered items and blank lines are only offered as splits
 *     (`splitOptions`); a 15-second block written as SHOT 1..5 is one prompt.
 *
 * Pure: no Node, no `@/` imports, so it runs in the browser on paste and in
 * unit tests alike. Prompts are never reworded: a block's text is kept as
 * written apart from line endings, a BOM and the outer whitespace. ZWNJ and
 * other Persian typography survive.
 */

export type ParsedFormat = 'batch-json' | 'shm-job' | 'text'

/** How a free-text document was cut. `auto` means `block` when it has prompt headings, else `none`. */
export type SplitMode = 'none' | 'block' | 'shot' | 'numbered' | 'blank'
export interface SplitOption { mode: SplitMode; count: number }

export interface ParsedRow {
  key: string
  label: string | null
  /** As written: a full or short id, a shot id, or NEW/KIND/SLUG. Null when the document gave none. */
  target: string | null
  variant: string | null
  model: string | null
  stage: 'draft' | 'final' | null
  refs: string[]
  params: Record<string, string>
  prompt: string
  notes: string | null
  source: { file: string | null; line: number }
  warnings: string[]
}

export interface ParseResult {
  format: ParsedFormat
  rows: ParsedRow[]
  /** Text before the first heading of a free-text document: usually rules that apply to every prompt. */
  preamble: string | null
  warnings: string[]
  /** The split used for free text; null for SHM-JOB and batch JSON, which are always one row per item. */
  split: SplitMode | null
  /** Every split this document allows, `none` first. Empty for SHM-JOB and batch JSON. */
  splitOptions: SplitOption[]
}

const META_KEYS = ['target', 'variant', 'model', 'refs', 'params', 'label', 'stage', 'notes'] as const
const META_RX = /^(target|variant|model|refs|params|label|stage|notes)\s*:\s*(.*)$/i
const MENTION_RX = /@((?:CHR|GRP|LOC|PRP|CRT|COS|VEH|FX|REF)-\d{3}(?:\/V\d{2}(?:\/T\d{2})?)?)(?![\w/-])/g

/** Block-level markers: P01, PROMPT 3, BLOCK 2, پرامپت ۱, بلاک ۲, with an optional markdown # prefix. */
// `\b` is ASCII-only, so the "not followed by another digit or letter" check is spelled out.
const BLOCK_HEADING_RX = /^\s*(?:#{1,6}\s*)?(?:P|PROMPT|BLOCK|پرامپت|بلاک)\s*[-–:.]?\s*[\d۰-۹]{1,3}(?![\d۰-۹A-Za-z])/i
/** Shot-level markers. Never a split by default: an EP001 block has SHOT 1..3 inside it. */
const SHOT_HEADING_RX = /^\s*(?:#{1,6}\s*)?(?:SHOT|SCENE|شات|صحنه)\s*[-–:.]?\s*[\d۰-۹]{1,3}(?![\d۰-۹A-Za-z])/i
/** Numbered list items: "1." "2)" "۳." at the start of a line. */
const NUMBERED_RX = /^\s*[\d۰-۹]{1,3}[.)]\s+\S/

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const latinDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))

export function normalizeText(text: string): string {
  return String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

export function detectFormat(text: string): ParsedFormat {
  const t = normalizeText(text).trim()
  if (/^===[ \t]*SHM-JOB[ \t]*===/m.test(t)) return 'shm-job'
  if (t.startsWith('[')) {
    try { if (Array.isArray(JSON.parse(t))) return 'batch-json' } catch { /* not JSON */ }
  }
  return 'text'
}

export function parsePromptDocument(
  text: string,
  opts: { file?: string | null; split?: SplitMode | 'auto' } = {},
): ParseResult {
  const format = detectFormat(text)
  const file = opts.file ?? null
  const result =
    format === 'batch-json' ? parseBatchJson(text, file)
    : format === 'shm-job' ? parseShmJobs(text, file)
    : splitTextBlocks(text, file, opts.split ?? 'auto')
  return { ...result, rows: result.rows.map((r, i) => ({ ...r, key: r.key || `r${i + 1}` })) }
}

function emptyRow(file: string | null, line: number): ParsedRow {
  return { key: '', label: null, target: null, variant: null, model: null, stage: null, refs: [], params: {}, prompt: '', notes: null, source: { file, line }, warnings: [] }
}

const splitList = (s: string) => String(s ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean)

/** `ar=16:9; duration=15` -> { aspect_ratio: '16:9', duration: '15' }. */
export function parseParams(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of String(s ?? '').split(';')) {
    const i = pair.indexOf('=')
    if (i < 1) continue
    let k = pair.slice(0, i).trim().toLowerCase().replace(/-/g, '_')
    const v = pair.slice(i + 1).trim()
    if (k === 'ar' || k === 'aspect') k = 'aspect_ratio'
    if (k === 'res') k = 'resolution'
    if (k === 'audio' || k === 'sound') k = 'generate_audio'
    if (k) out[k] = v
  }
  return out
}

/** Reference tokens mentioned in the prompt itself, in order of appearance. */
export function mentionedRefs(prompt: string): string[] {
  const out: string[] = []
  for (const m of String(prompt ?? '').matchAll(MENTION_RX)) {
    const t = `@${m[1]}`
    if (!out.includes(t)) out.push(t)
  }
  return out
}

function stageOf(v: unknown): 'draft' | 'final' | null {
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'draft' || s === 'final' ? s : null
}

// ---------------------------------------------------------------- batch JSON

export function parseBatchJson(text: string, file: string | null = null): ParseResult {
  let arr: unknown
  try { arr = JSON.parse(normalizeText(text)) } catch (e) {
    return { format: 'batch-json', rows: [], preamble: null, warnings: [`Not valid JSON: ${(e as Error).message}`], split: null, splitOptions: [] }
  }
  if (!Array.isArray(arr)) return { format: 'batch-json', rows: [], preamble: null, warnings: ['The JSON is not an array.'], split: null, splitOptions: [] }
  const rows: ParsedRow[] = []
  const warnings: string[] = []
  arr.forEach((item, i) => {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const row = emptyRow(file, i + 1)
    row.label = o.label != null ? String(o.label) : null
    row.target = o.target != null ? String(o.target).trim() : null
    row.variant = o.variant != null ? String(o.variant).trim() : null
    row.model = o.model != null ? String(o.model).trim() : null
    row.stage = stageOf(o.stage)
    row.refs = Array.isArray(o.refs) ? o.refs.map(String).map((s) => s.trim()).filter(Boolean) : []
    row.prompt = String(o.prompt ?? '').trim()
    if (o.params && typeof o.params === 'object') {
      for (const [k, v] of Object.entries(o.params as Record<string, unknown>)) {
        if (v !== undefined && v !== null) row.params[k] = String(v)
      }
    }
    if (!row.prompt) row.warnings.push('no prompt')
    if (item && typeof item !== 'object') warnings.push(`item ${i + 1} is not an object`)
    rows.push(row)
  })
  return { format: 'batch-json', rows, preamble: null, warnings, split: null, splitOptions: [] }
}

// ---------------------------------------------------------------- SHM-JOB blocks

const JOB_RX = /^===[ \t]*SHM-JOB[ \t]*===[ \t]*\n([\s\S]*?)^===[ \t]*END[ \t]+SHM-JOB[ \t]*===[ \t]*$/gm
const PROMPT_RX = /^---[ \t]*prompt[ \t]*---[ \t]*\n([\s\S]*?)^---[ \t]*end[ \t]+prompt[ \t]*---[ \t]*$/m

export function parseShmJobs(text: string, file: string | null = null): ParseResult {
  const src = normalizeText(text)
  const rows: ParsedRow[] = []
  const warnings: string[] = []
  for (const m of src.matchAll(JOB_RX)) {
    const line = src.slice(0, m.index).split('\n').length
    let inner = m[1]
    let prompt = ''
    const pm = inner.match(PROMPT_RX)
    if (pm && pm.index !== undefined) {
      prompt = pm[1].trim()
      inner = inner.slice(0, pm.index) + inner.slice(pm.index + pm[0].length)
    }
    const h: Record<string, string> = {}
    for (const l of inner.split('\n')) {
      const i = l.indexOf(':')
      if (i < 1) continue
      h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim()
    }
    const type = h.type ?? ''
    if (type && !/^generate\./.test(type)) {
      warnings.push(`${h.job_id ?? `block at line ${line}`}: type ${type} is not a generation; run it through /sync-in`)
      continue
    }
    const row = emptyRow(file, line)
    row.label = h.job_id || null
    row.target = h.target || null
    row.variant = h.variant || null
    row.model = h.model || null
    row.stage = stageOf(h.stage) ?? (type === 'generate.video' ? 'draft' : null)
    row.refs = splitList(h.refs ?? '')
    row.params = parseParams(h.params ?? '')
    row.notes = h.notes || null
    row.prompt = prompt
    if (!prompt) row.warnings.push('no --- prompt --- body')
    if (h.engine && h.engine !== 'higgsfield') row.warnings.push(`engine ${h.engine} is not run by the worker`)
    rows.push(row)
  }
  if (rows.length === 0 && warnings.length === 0) warnings.push('No SHM-JOB blocks found.')
  return { format: 'shm-job', rows, preamble: null, warnings, split: null, splitOptions: [] }
}

// ---------------------------------------------------------------- free text

interface Block { label: string | null; body: string; line: number }

function splitByHeading(lines: string[], rx: RegExp): { blocks: Block[]; preamble: string } | null {
  const starts: number[] = []
  lines.forEach((l, i) => { if (rx.test(l)) starts.push(i) })
  if (starts.length < 2) return null
  const preamble = lines.slice(0, starts[0]).join('\n').trim()
  const blocks: Block[] = starts.map((s, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length
    const heading = lines[s].replace(/^\s*#{1,6}\s*/, '').trim()
    // "P02 — the hall" is a fine label; "PROMPT 01 / 15 SECONDS / HORIZONTAL" is not, so a long heading keeps only its marker.
    const full = latinDigits(heading.replace(/[\s:/–—-]+$/, ''))
    const marker = latinDigits((heading.match(rx)?.[0] ?? full).replace(/^\s*#{1,6}\s*/, '').trim())
    const label = full.length <= 24 ? full : marker
    return { label, body: lines.slice(s + 1, end).join('\n'), line: s + 1 }
  })
  return { blocks, preamble }
}

function splitByBlankLines(lines: string[], minBlank: number): Block[] | null {
  const blocks: Block[] = []
  let cur: string[] = []
  let blank = 0
  let start = 1
  const flush = () => {
    const body = cur.join('\n')
    if (body.trim()) blocks.push({ label: null, body, line: start })
    cur = []
  }
  lines.forEach((l, i) => {
    if (l.trim() === '') {
      blank++
      if (blank >= minBlank && cur.length) { flush(); start = i + 2 }
      else if (cur.length) cur.push(l)
      return
    }
    if (cur.length === 0) start = i + 1
    blank = 0
    cur.push(l)
  })
  flush()
  return blocks.length >= 2 ? blocks : null
}

/** Numbered items are blocks too, but a numbered list inside a prompt is not two prompts: require a blank line between items. */
function splitNumbered(lines: string[]): { blocks: Block[]; preamble: string } | null {
  const starts: number[] = []
  lines.forEach((l, i) => {
    if (NUMBERED_RX.test(l) && (i === 0 || lines[i - 1].trim() === '')) starts.push(i)
  })
  if (starts.length < 2) return null
  const preamble = lines.slice(0, starts[0]).join('\n').trim()
  const blocks: Block[] = starts.map((s, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length
    const first = lines[s].replace(/^\s*[\d۰-۹]{1,3}[.)]\s+/, '')
    const num = latinDigits(lines[s].match(/[\d۰-۹]{1,3}/)![0])
    return { label: `#${num}`, body: [first, ...lines.slice(s + 1, end)].join('\n'), line: s + 1 }
  })
  return { blocks, preamble }
}

export function splitTextBlocks(text: string, file: string | null = null, split: SplitMode | 'auto' = 'auto'): ParseResult {
  const src = normalizeText(text)
  const lines = src.split('\n')
  const warnings: string[] = []

  // Only prompt headings cut a document on their own. The rest are offered, never assumed:
  // SHOT 1..5 inside one 15-second block, or blank lines between its sections, are not five prompts.
  const byBlank = splitByBlankLines(lines, 2)
  const cuts: Record<Exclude<SplitMode, 'none'>, { blocks: Block[]; preamble: string } | null> = {
    block: splitByHeading(lines, BLOCK_HEADING_RX),
    shot: splitByHeading(lines, SHOT_HEADING_RX),
    numbered: splitNumbered(lines),
    blank: byBlank && { blocks: byBlank, preamble: '' },
  }
  const whole: Block[] = src.trim() ? [{ label: null, body: src, line: 1 }] : []
  const splitOptions: SplitOption[] = [{ mode: 'none', count: whole.length }]
  for (const [mode, cut] of Object.entries(cuts) as [Exclude<SplitMode, 'none'>, typeof cuts.block][]) {
    if (cut) splitOptions.push({ mode, count: cut.blocks.length })
  }
  const wanted = split === 'auto' ? (cuts.block ? 'block' : 'none') : split
  const cut = wanted === 'none' ? null : cuts[wanted]
  const used: SplitMode = cut ? wanted : 'none'
  const { blocks, preamble } = cut ?? { blocks: whole, preamble: '' }

  const rows: ParsedRow[] = blocks.map((b) => {
    const row = emptyRow(file, b.line)
    row.label = b.label
    // Leading `key: value` lines are metadata, not prompt text.
    const bodyLines = b.body.split('\n')
    let i = 0
    while (i < bodyLines.length) {
      const l = bodyLines[i]
      if (l.trim() === '' && i === 0) { i++; continue }
      const m = l.match(META_RX)
      if (!m) break
      const k = m[1].toLowerCase() as (typeof META_KEYS)[number]
      const v = m[2].trim()
      if (k === 'refs') row.refs = splitList(v)
      else if (k === 'params') row.params = parseParams(v)
      else if (k === 'stage') row.stage = stageOf(v)
      else if (k === 'label') row.label = v
      else row[k] = v || null
      i++
    }
    row.prompt = bodyLines.slice(i).join('\n').trim()
    if (row.refs.length === 0) {
      const mentioned = mentionedRefs(row.prompt)
      if (mentioned.length) {
        row.refs = mentioned
        row.warnings.push('references taken from the @mentions in the text')
      }
    }
    if (!row.prompt) row.warnings.push('empty block')
    return row
  }).filter((r) => r.prompt || r.warnings.length === 0)

  if (rows.length === 0) warnings.push('Nothing to parse.')
  return { format: 'text', rows, preamble: preamble || null, warnings, split: used, splitOptions }
}
