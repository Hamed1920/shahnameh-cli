/**
 * Play through: the shots of a page, one after another, each showing the best
 * take it has unless the viewer ticks another.
 *
 * Pure on purpose -- no React, no `node:` -- so Review, an episode and the
 * whole film build their stops the same way and one test covers all three.
 */

import { blockSequence, compareSequences } from './episodes.ts'

export interface PlayOption {
  /** Unique within its stop; the file path does it. */
  id: string
  /** Project-relative. */
  file: string
  /** "T02 · final · attempt 2". */
  label: string
  /** final > a still (null) > draft: the 480p draft is a preview of the final. */
  stage: 'draft' | 'final' | null
  attempt: number
  ts: string
  /** This is the footage the episode holds now. */
  filed?: boolean
}

/** One shot in the run, with every take that could stand for it. */
export interface PlayStop {
  id: string
  title: string
  subtitle?: string
  options: PlayOption[]
}

const STAGE_RANK = { final: 2, null: 1, draft: 0 } as const

/**
 * True when `a` is the better take: a final beats a draft, then the one filed
 * in the episode, then the later attempt, then the newer take. Equal takes
 * keep their order, so a batch of N candidates from one prompt plays the first.
 */
export function betterThan(a: PlayOption, b: PlayOption): boolean {
  const stage = STAGE_RANK[String(a.stage) as keyof typeof STAGE_RANK] - STAGE_RANK[String(b.stage) as keyof typeof STAGE_RANK]
  if (stage) return stage > 0
  if (!!a.filed !== !!b.filed) return !!a.filed
  if (a.attempt !== b.attempt) return a.attempt > b.attempt
  return a.ts > b.ts
}

export function bestOption(options: PlayOption[]): PlayOption | null {
  let best: PlayOption | null = null
  for (const o of options) if (!best || betterThan(o, best)) best = o
  return best
}

/** What a stop plays: the viewer's tick if it is still one of its takes, else the best. */
export function chosenOption(stop: PlayStop, picks: Record<string, string>): PlayOption | null {
  const picked = stop.options.find((o) => o.id === picks[stop.id])
  return picked ?? bestOption(stop.options)
}

/** A stop with nothing to play is left out of the run rather than shown empty. */
export const playable = (stops: PlayStop[]) => stops.filter((s) => s.options.length > 0)

// ---------------------------------------------------------------- builders

/** A pending Review candidate, reduced to what a run needs. */
export interface ReviewTake {
  path: string
  /** The shot it belongs to: SHM-EP001-SC004-SH0010. */
  target: string
  title: string
  subtitle?: string
  take: string
  stage: 'draft' | 'final' | null
  attempt: number
  createdAt: string
}

/**
 * Review's takes grouped by shot, in the order given. Two takes of one shot --
 * a draft waiting beside its final, or a regenerated attempt -- become one stop
 * with two options, so the run plays the shot once, in its best quality.
 */
export function reviewStops(takes: ReviewTake[]): PlayStop[] {
  const stops = new Map<string, PlayStop>()
  for (const t of takes) {
    let stop = stops.get(t.target)
    if (!stop) {
      stop = { id: t.target, title: t.title, subtitle: t.subtitle, options: [] }
      stops.set(t.target, stop)
    }
    stop.options.push({
      id: t.path,
      file: t.path,
      label: [t.take, t.stage, t.attempt > 1 ? `attempt ${t.attempt}` : null].filter(Boolean).join(' · '),
      stage: t.stage,
      attempt: t.attempt,
      ts: t.createdAt,
    })
  }
  return playable([...stops.values()])
}

/** One output of an episode shot, reduced to what a run needs. */
export interface ShotTake {
  file: string
  take: string
  verdict: 'accepted' | 'denied' | 'discarded' | null
  stage: 'draft' | 'final' | null
  attempt: number
  ts: string
  filed: boolean
}

export interface ShotInput {
  shot: string
  title: string
  subtitle?: string
  outputs: ShotTake[]
}

/**
 * An episode's shots, each with the takes that were not turned down. A denied
 * or discarded take is a record of how the shot got here, not something to
 * watch in the cut, so it is not offered.
 */
export function shotStops(shots: ShotInput[]): PlayStop[] {
  return playable(
    shots.map((s) => ({
      id: s.shot,
      title: s.title,
      subtitle: s.subtitle,
      options: s.outputs
        .filter((o) => o.verdict !== 'denied' && o.verdict !== 'discarded')
        .map((o) => ({
          id: o.file,
          file: o.file,
          label: [o.take, o.stage, o.filed ? 'filed' : null, o.attempt > 1 ? `attempt ${o.attempt}` : null].filter(Boolean).join(' · '),
          stage: o.stage,
          attempt: o.attempt,
          ts: o.ts,
          filed: o.filed,
        })),
    })),
  )
}

// ---------------------------------------------------------------- order

/** What decides where a Review candidate stands in the film. */
export interface ReviewKey {
  episode: string | null
  /** The prompt's label from its document: "PLAN 01", "P3", or whatever was typed. */
  label: string | null
  target: string
  createdAt: string
}

/**
 * Film order: episode, then the prompt's own number, then the shot id.
 *
 * Not generation time. A prompt that failed and was retried is generated late and
 * gets a later scene number, so ordering by either put PLAN 01 after PLAN 12. The
 * number the author gave it is what says where it belongs. A label that is not a
 * number (typed by hand) sorts after the numbered ones, by shot id as before.
 * Takes of one prompt stay oldest first.
 */
export function compareReviewOrder(a: ReviewKey, b: ReviewKey): number {
  const ea = a.episode ?? '￿', eb = b.episode ?? '￿'
  if (ea !== eb) return ea < eb ? -1 : 1
  const na = blockSequence(a.label), nb = blockSequence(b.label)
  if (na && nb) {
    const c = compareSequences(na, nb)
    if (c) return c
  } else if (na || nb) {
    return na ? -1 : 1
  }
  return a.target.localeCompare(b.target) || a.createdAt.localeCompare(b.createdAt)
}

/**
 * An episode's shots in the order their prompts were numbered (3 before 3.1 before 4),
 * not the order they were generated in. A shot with no numbered prompt follows the
 * numbered ones, in scene order.
 */
export function inPromptOrder<T extends { shot: string; label: string | null }>(episode: string | null, shots: T[]): T[] {
  return shots
    .slice()
    .sort((a, b) =>
      compareReviewOrder(
        { episode, label: a.label, target: a.shot, createdAt: '' },
        { episode, label: b.label, target: b.shot, createdAt: '' },
      ),
    )
}

/**
 * `items` with the ones named in `order` first, in that order, and the rest after
 * in the order they came. A shot that arrives after someone arranged the run
 * therefore lands at the end instead of vanishing or shuffling the rest.
 */
export function orderBy<T>(items: T[], order: string[], idOf: (item: T) => string): T[] {
  if (order.length === 0) return items
  const rank = new Map(order.map((id, i) => [id, i]))
  const known = items.filter((x) => rank.has(idOf(x)))
  const rest = items.filter((x) => !rank.has(idOf(x)))
  // Array.sort is stable, so the several takes of one shot keep their order.
  known.sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!)
  return [...known, ...rest]
}

export const orderStops = (stops: PlayStop[], order: string[]) => orderBy(stops, order, (s) => s.id)

/** `ids` with the one at `from` moved to stand at `to`. */
export function moveInOrder(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= ids.length) return ids
  const out = ids.slice()
  const [item] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item)
  return out
}
