// The playlist of a sequence (PRD 9.1): its blocks in display_order, one video after another.
// Pure -- no database, no files -- so a test covers the order, the gaps and the "best available"
// choice. The server fills `PlaylistBlock` in (lib/pd-playlist.ts); the player (components/
// play-through.tsx) plays the stops this builds.
//
// A block with nothing to play is a visible gap stop, never dropped and never reordered. The
// director's playlist uses only submissions; production may also pick "best available".
import type { PlayStop } from './play-through.ts'

export type PlaylistMode = 'submitted' | 'best'

export interface PlaylistBlock {
  id: string
  title: string
  number: number
  displayOrder: number
  /** The active submission, the one the director is asked about. */
  active: { submissionId: string; round: number; gLabel: string } | null
  /** The Final, as the submission it was approved in. */
  final: { submissionId: string; round: number | null; gLabel: string } | null
  /** The newest accepted generation that has a file, for the "best available" fallback. Production only. */
  accepted: { file: string; gLabel: string } | null
}

/** What a block plays, and where from. `none` is a gap. */
export type Source =
  | { kind: 'submission'; submissionId: string; label: string }
  | { kind: 'file'; file: string; label: string }
  | { kind: 'none' }

/** Display order first; the number only breaks a tie, so the order never depends on database order. */
export function inFilmOrder<T extends { displayOrder: number; number: number }>(blocks: T[]): T[] {
  return blocks.slice().sort((a, b) => a.displayOrder - b.displayOrder || a.number - b.number)
}

const roundLabel = (round: number | null, g: string) => (round === null ? g : `Round ${round} · ${g}`)

/**
 * "submitted": the active submission, as the director sees it.
 * "best": the Final if one is set, else the active submission, else the newest accepted generation.
 */
export function chooseSource(b: PlaylistBlock, mode: PlaylistMode): Source {
  if (mode === 'best' && b.final) {
    return { kind: 'submission', submissionId: b.final.submissionId, label: `Final · ${roundLabel(b.final.round, b.final.gLabel)}` }
  }
  if (b.active) return { kind: 'submission', submissionId: b.active.submissionId, label: roundLabel(b.active.round, b.active.gLabel) }
  if (mode === 'best' && b.accepted) return { kind: 'file', file: b.accepted.file, label: `Accepted · ${b.accepted.gLabel}` }
  return { kind: 'none' }
}

export const reviewMediaUrl = (project: string, submissionId: string) => `/${project}/api/review-media/${submissionId}`

/**
 * The stops of a run: one per block, in film order. `hrefFor` is where the block's own page is.
 * Every stop has the block id first, so the viewer always knows which block is on screen.
 */
export function buildPlaylist(
  project: string, blocks: PlaylistBlock[], mode: PlaylistMode, hrefFor: (blockId: string) => string,
): PlayStop[] {
  return inFilmOrder(blocks).map((b): PlayStop => {
    const src = chooseSource(b, mode)
    const href = hrefFor(b.id)
    if (src.kind === 'none') {
      return {
        id: b.id, title: `${b.id} — ${mode === 'best' ? 'nothing to play yet' : 'not sent yet'}`, subtitle: b.title,
        options: [], gap: true, href,
      }
    }
    const url = src.kind === 'submission' ? reviewMediaUrl(project, src.submissionId) : undefined
    const file = src.kind === 'submission' ? url! : src.file
    return {
      id: b.id, title: `${b.id} · ${src.label}`, subtitle: b.title, href,
      options: [{
        id: file, file, url, kind: src.kind === 'submission' ? 'video' : undefined,
        label: src.label, stage: null, attempt: 1, ts: '',
      }],
    }
  })
}

/** How many stops are footage and how many are gaps, for the line above the playlist. */
export function playlistCounts(stops: PlayStop[]): { playable: number; gaps: number } {
  const gaps = stops.filter((s) => s.gap).length
  return { playable: stops.length - gaps, gaps }
}
