/**
 * How a project is laid out for people. Pure: no fs, no imports, so tests and
 * server code can both load it.
 *
 * 'episodes' is the original Episode / Scene / Shot layout, and the default.
 * 'blocks' shows Sequence / Block: a Block is one generated video, so the Shot
 * level is hidden. Underneath nothing changes -- the worker still files by
 * episode, scene and shot:
 *
 *   Sequence S01       is the internal episode  <CODE>-EP001
 *   Block B003 in S01  is the internal shot     <CODE>-EP001-SC003-SH0010
 *
 * People only ever see PD-S01-B003. Both numbers run 1..999.
 */

export type Structure = 'episodes' | 'blocks'

/** Anything unknown or missing is 'episodes', so an old project.json behaves as before. */
export function structureOf(project: { structure?: unknown } | null | undefined): Structure {
  return project?.structure === 'blocks' ? 'blocks' : 'episodes'
}

export function isBlocks(project: { structure?: unknown } | null | undefined): boolean {
  return structureOf(project) === 'blocks'
}

/** The words to put on screen for this layout. */
export function structureLabels(s: Structure): { group: string; groups: string; unit: string; units: string } {
  return s === 'blocks'
    ? { group: 'Sequence', groups: 'Sequences', unit: 'Block', units: 'Blocks' }
    : { group: 'Episode', groups: 'Episodes', unit: 'Shot', units: 'Shots' }
}

const MAX = 999

function whole(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

/** PD-S01. Two digits, widening past 99 (S100). Null-safe callers check bounds first. */
export function sequenceDisplayId(code: string, n: number): string {
  return `${code}-S${pad(n, 2)}`
}

/** PD-S01-B003. */
export function blockDisplayId(code: string, seqN: number, blockN: number): string {
  return `${sequenceDisplayId(code, seqN)}-B${pad(blockN, 3)}`
}

/** PD-EP001: the folder-level episode behind a sequence. */
export function sequenceInternalId(code: string, n: number): string {
  return `${code}-EP${pad(n, 3)}`
}

/** PD-EP001-SC003-SH0010: the shot behind a block. */
export function blockInternalId(code: string, seqN: number, blockN: number): string {
  return `${sequenceInternalId(code, seqN)}-SC${pad(blockN, 3)}-SH0010`
}

// A project code is letters and digits only (codeProblem), so it is safe inside a pattern.
function parse(re: RegExp, text: string): { seq: number; block: number } | null {
  const m = re.exec(text)
  if (!m) return null
  const seq = Number(m[1])
  const block = Number(m[2])
  return whole(seq) && whole(block) ? { seq, block } : null
}

/** 'PD-S01-B003' -> { seq: 1, block: 3 }, or null. */
export function parseBlockDisplayId(code: string, id: string): { seq: number; block: number } | null {
  return parse(new RegExp(String.raw`^${code}-S(\d{2,3})-B(\d{3})$`), id)
}

/** 'PD-EP001-SC003-SH0010' -> { seq: 1, block: 3 }. The shot must be exactly SH0010. */
export function parseInternalBlockId(code: string, id: string): { seq: number; block: number } | null {
  return parse(new RegExp(String.raw`^${code}-EP(\d{3})-SC(\d{3})-SH0010$`), id)
}

/** The display id for an internal block id, or null when it is not a block id. */
export function displayFromInternal(code: string, internalId: string): string | null {
  const p = parseInternalBlockId(code, internalId)
  return p ? blockDisplayId(code, p.seq, p.block) : null
}
