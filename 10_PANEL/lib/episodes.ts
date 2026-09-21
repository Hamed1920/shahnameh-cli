import { episodeFolderName, episodeTitleSlug, idRx } from '../worker/lib/ids.mjs'

/** Folder naming for a new episode, shared with the worker. */
export { episodeFolderName, episodeTitleSlug }

/**
 * The episode a piece of work belongs to, and how it reads on the page.
 *
 * Every shot id already carries its episode -- SHM-EP001-SC004-SH0010 is
 * episode 1, scene 4 -- so nothing here is a new number or a new ID. This only
 * reads the episode back out of a target and names it the way Hamed says it
 * out loud: EP1 P01, the first prompt block of episode one.
 *
 * Pure: no disk, no `@/` imports, so the browser, the server pages and the
 * unit tests all share one copy. The project code (SHM, ...) is always passed
 * in, never assumed.
 */

/** EP001. Scene and shot numbers hang off this; see docs/INDEXING.md section 7. */
export const EPISODE_RX = /^EP\d{3}$/

/** What an episode folder is called on disk, and the title it carries. */
export interface EpisodeInfo {
  /** EP001. */
  id: string
  /** The folder under 07_EPISODES, when the worker has made one. */
  dir: string | null
  /** From the folder name: "Zahhak Entry". Empty when the folder is just the id. */
  title: string
  /**
   * Distinct shots in it NOW: every shot ever targeted, read forward through
   * the episodes footage has been moved between, so one shot counts once.
   */
  shots: number
}

/** Where a take with no episode is grouped: design images, reference art, entity looks. */
export const NO_EPISODE_LABEL = 'Not in an episode'

/** The episode of any id that starts with one -- a shot target, a file name. Null for an entity. */
export function episodeOf(target: string | null | undefined, code: string): string | null {
  return String(target ?? '').match(idRx(code).shotParts)?.[1] ?? null
}

/** EP001 -> EP1, the way it is said and typed. */
export function shortEpisode(episode: string): string {
  const m = /^EP0*(\d+)$/.exec(String(episode ?? ''))
  return m ? `EP${m[1]}` : String(episode ?? '')
}

/** EP1 / ep1 / 1 -> EP001. Null when it is not an episode at all. */
export function longEpisode(input: string): string | null {
  const m = /^(?:EP)?\s*(\d{1,3})$/i.exec(String(input ?? '').trim())
  return m ? `EP${m[1].padStart(3, '0')}` : null
}

/**
 * The block number a document's own heading gave a prompt: P01 from "P01",
 * "PROMPT 1", "P02 - the hall", "پرامپت ۱". Null when the label is something
 * else, which is most labels the reviewer types by hand.
 */
export function blockNumber(label: string | null | undefined): string | null {
  const latin = String(label ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  const m = /^\s*(?:#{1,6}\s*)?(?:P|PROMPT|BLOCK|پرامپت|بلاک)\s*[-–:.]?\s*(\d{1,3})(?!\d)/i.exec(latin)
  return m ? `P${m[1].padStart(2, '0')}` : null
}

/**
 * How one piece of footage is named out loud: "EP1 P01".
 *
 * The block number comes from the document's heading. A prompt whose heading
 * was not a block number falls back to its scene, which is the same count by
 * another name -- one 15-second block is one scene.
 */
export function promptHandle(
  episode: string | null,
  label: string | null,
  scene: string | null = null,
): string {
  const name = blockNumber(label) ?? scene ?? label ?? ''
  return [episode ? shortEpisode(episode) : null, name].filter(Boolean).join(' ')
}

/** "EP1 · Zahhak Entry", or just "EP1" while the episode has no folder title. */
export function episodeLabel(episode: string | null, titles: Record<string, string> = {}): string {
  if (!episode) return NO_EPISODE_LABEL
  const title = titles[episode]
  return title ? `${shortEpisode(episode)} · ${title}` : shortEpisode(episode)
}

/** The next free episode number, past every one that exists. Numbers are never reused. */
export function nextEpisodeId(existing: string[]): string {
  const numbers = existing.map((e) => Number(/^EP(\d{3})$/.exec(String(e ?? ''))?.[1] ?? 0))
  return `EP${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`
}

/**
 * The id and readable title of an episode folder: SHM-EP001-ZAHHAK-ENTRY is
 * EP001, "Zahhak Entry". The worker matches these folders by their CODE-EPnnn
 * prefix (shotFolder in worker/lib/project.mjs), so the suffix is free text and
 * a bare CODE-EP002 folder is just as valid.
 */
export function parseEpisodeDir(dir: string, code: string): { id: string; title: string } | null {
  const m = new RegExp(`^${code}-(EP\\d{3})(?:-(.+))?$`).exec(String(dir ?? ''))
  if (!m) return null
  const title = (m[2] ?? '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
  return { id: m[1], title }
}

export interface EpisodeGroup<T> {
  episode: string | null
  items: T[]
}

/**
 * Items cut into episodes, in episode order, with everything that is not
 * footage in one last group. Order within a group is the order it came in.
 */
export function groupByEpisode<T>(items: T[], episodeOfItem: (item: T) => string | null): EpisodeGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = episodeOfItem(item) ?? ''
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }
  return [...groups]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([episode, list]) => ({ episode: episode || null, items: list }))
}

/**
 * Which episodes exist, and how much footage each holds now.
 *
 * Two different questions, answered from the same list of shot ids:
 *
 *   - **Which episodes.** Every episode any id names, moved-from ones included.
 *     An episode whose footage has all gone elsewhere keeps its number, and the
 *     next free number still counts it: numbers are never handed out twice
 *     (docs/INDEXING.md section 9).
 *   - **How much.** Each id read forward through `movedTo` first, then counted
 *     once. QUEUE.jsonl keeps the id a job was made under for ever -- the right
 *     record of what happened -- so a shot that has changed episode is named in
 *     both, and counting the raw list had EP001 still holding a shot that is in
 *     EP002.
 *
 * @param shots every shot id ever targeted: queued targets and files on disk
 * @param movedTo old shot id -> the id it has now (getShotMoves().shot)
 */
export function foldEpisodeShots(
  shots: string[],
  code: string,
  movedTo: Record<string, string> = {},
): { episodes: string[]; counts: Map<string, number> } {
  const episodes = new Set<string>()
  const counts = new Map<string, number>()
  const now = new Set<string>()
  for (const shot of shots) {
    const was = episodeOf(shot, code)
    if (was) episodes.add(was)
    now.add(movedTo[shot] ?? shot)
  }
  for (const shot of now) {
    const id = episodeOf(shot, code)
    if (!id) continue
    episodes.add(id)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return { episodes: [...episodes].sort(), counts }
}

/** Every episode in play, in order: the ones given, plus any an item points at. */
export function episodesIn(known: string[], seen: (string | null)[]): string[] {
  const all = new Set<string>()
  for (const e of [...known, ...seen]) if (e && EPISODE_RX.test(e)) all.add(e)
  return [...all].sort()
}

// ---------------------------------------------------------------- picking one

/** An episode as the picker offers it. */
export interface EpisodeOption {
  id: string
  title: string
  /** Distinct shots already in it, so the list says which episode is which. */
  shots: number
}

/** The episode the picker is about to hand back: an existing one, or one that starts now. */
export interface EpisodeChoice {
  id: string
  /** Only set when this starts a new episode, and only when the typed name has ASCII in it. */
  title: string
  isNew: boolean
}


/** What a typed query offers: the episodes it matches, and the ones it could start. */
export interface EpisodeSearch {
  matches: EpisodeOption[]
  /**
   * The episodes this query would start, in the order to offer them: what was
   * asked for first, then the next number in sequence when that is a different
   * one. Empty when the query names an episode that already exists.
   */
  create: EpisodeChoice[]
  /** A hint about the numbering, never a refusal. */
  note: string | null
}

const norm = (s: string) => String(s ?? '').trim().toLowerCase()

/**
 * A typed line split into the number it asks for and the name it gives:
 * "EP9 Rostam and Sohrab" -> EP009 + "Rostam and Sohrab", "9" -> EP009 + "",
 * "Rostam" -> null + "Rostam".
 */
export function parseEpisodeQuery(query: string): { id: string | null; title: string } {
  const q = String(query ?? '').trim()
  const m = /^(?:EP\s*)?(\d{1,3})(?:\s*[-–—:.]\s*|\s+|$)(.*)$/i.exec(q)
  if (!m) return { id: null, title: q }
  return { id: `EP${m[1].padStart(3, '0')}`, title: m[2].trim() }
}

/**
 * Search the episodes and start one, from the same typed line.
 *
 * Typing a number finds that episode; typing a name finds it by title. When
 * nothing matches, the last rows start one -- and the number is whatever was
 * asked for. **The next free number is offered, not imposed.** Numbers must
 * never be *reused* (docs/INDEXING.md section 9) and nothing here reuses one --
 * a number that is already an episode is that episode, offered as a match. A
 * gap is a different thing entirely, and Hamed's to leave: jumping to EP010
 * because the tenth part is what is being cut next is a decision, not a
 * mistake, and the note says which number was next in case it was a typo.
 */
export function searchEpisodes(
  query: string,
  episodes: EpisodeOption[],
  next: string,
  exclude: string[] = [],
): EpisodeSearch {
  const skip = new Set(exclude)
  const pool = episodes.filter((e) => !skip.has(e.id))
  const taken = new Set(episodes.map((e) => e.id))
  const q = norm(query)
  const newEpisode = (id: string, title: string): EpisodeChoice => ({ id, title, isNew: true })
  /** The next free number as a second offer, when it is not the one asked for. */
  const alsoNext = (id: string, title: string) => (id === next || taken.has(next) ? [] : [newEpisode(next, title)])

  if (!q) return { matches: pool, create: [newEpisode(next, '')], note: null }

  const { id: asked, title } = parseEpisodeQuery(query)

  if (asked) {
    // The number names an episode that exists: that is the episode, not a new one.
    if (taken.has(asked)) {
      return {
        matches: pool.filter((e) => e.id === asked),
        create: [],
        note: skip.has(asked) ? `${shortEpisode(asked)} is where this already is.` : null,
      }
    }
    return {
      matches: [],
      create: [newEpisode(asked, title), ...alsoNext(asked, title)],
      note: asked === next
        ? null
        : `${shortEpisode(next)} is the next one in order. ${shortEpisode(asked)} leaves a gap, which is fine.`,
    }
  }

  const matches = pool.filter(
    (e) => norm(e.title).includes(q) || norm(shortEpisode(e.id)).includes(q) || norm(e.id).includes(q),
  )
  if (pool.some((e) => norm(e.title) === q)) return { matches, create: [], note: null }
  const name = String(query).trim()
  return {
    matches,
    create: [newEpisode(next, name)],
    note: episodeTitleSlug(name) ? null : 'That name has no Latin letters, so the folder is just the number.',
  }
}
