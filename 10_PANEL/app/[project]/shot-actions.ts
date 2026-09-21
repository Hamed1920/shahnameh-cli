'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { idRx } from '../../worker/lib/ids.mjs'
import { EPISODE_RX, episodeTitleSlug, shortEpisode } from '@/lib/episodes'
import { requireProject } from '@/lib/projects'
import { getShotMoveRequests } from '@/lib/store'

/**
 * Assigning footage to another episode.
 *
 * The panel only ever asks: this appends one `move-shot` op to INDEX_OPS.jsonl
 * and the worker does the moving, the numbering and the renaming
 * (worker/lib/index-ops.mjs). The worker is the single writer for anything that
 * touches a file -- see CLAUDE.md -- and it checks all of this again itself.
 *
 * Two things are settled here rather than passed on, because the answer is
 * "nothing to do" rather than an error:
 *
 *   - a shot already in the episode asked for is dropped from the request;
 *   - a shot with a move already waiting for the worker is refused, so a second
 *     click on a card that has not visibly moved yet cannot queue the same move
 *     twice and have the second one fail once the first has landed.
 */

const REVIEWER = process.env.SHM_REVIEWER || 'hamed'
const MAX_AT_ONCE = 200
/** Long enough for a folder name, short enough to stay a name. */
const MAX_TITLE = 60

export interface AssignResult {
  ok: boolean
  error?: string
  /** The op id, so the page can watch for its outcome. */
  id?: string
  /** What was actually asked for. */
  moved?: string[]
  /** Already in that episode, so left alone. */
  skipped?: string[]
}

export async function assignToEpisode(
  project: string,
  shots: string[],
  episode: string,
  /** Names the episode's folder, and only when it does not have one yet. */
  title = '',
): Promise<AssignResult> {
  const pr = await requireProject(project)
  const ep = String(episode ?? '').trim().toUpperCase()
  if (!EPISODE_RX.test(ep)) return { ok: false, error: `'${episode}' is not an episode. It looks like EP002.` }

  const name = String(title ?? '').trim().slice(0, MAX_TITLE)

  const wanted = [...new Set((shots ?? []).map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))]
  if (wanted.length === 0) return { ok: false, error: 'Choose some footage first.' }
  if (wanted.length > MAX_AT_ONCE) return { ok: false, error: `Too many at once (${MAX_AT_ONCE} max).` }

  const rx = idRx(pr.code)
  const move: string[] = []
  const skipped: string[] = []
  for (const shot of wanted) {
    const parts = shot.match(rx.shotParts)
    if (!parts || !parts[2] || !parts[3]) {
      return { ok: false, error: `${shot} is not footage, so it has no episode to move between.` }
    }
    if (parts[1] === ep) skipped.push(shot)
    else move.push(shot)
  }
  if (move.length === 0) {
    return {
      ok: false,
      error: skipped.length === 1
        ? `${skipped[0]} is already in ${shortEpisode(ep)}.`
        : `All ${skipped.length} are already in ${shortEpisode(ep)}.`,
    }
  }

  const { pending } = await getShotMoveRequests(pr)
  const queued = move.filter((s) => pending[s])
  if (queued.length) {
    const where = shortEpisode(pending[queued[0]])
    return {
      ok: false,
      error: queued.length === 1
        ? `${queued[0]} is already on its way to ${where}. The worker moves it on its next pass.`
        : `${queued.length} of these are already on their way to another episode. Wait for the worker.`,
    }
  }

  const id = `op_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const record = {
    id,
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    type: 'move-shot',
    episode: ep,
    shots: move,
    // Dropped when it would slug to nothing: the worker would ignore it anyway.
    ...(episodeTitleSlug(name) ? { episodeTitle: name } : {}),
  }
  try {
    await fs.mkdir(path.dirname(pr.P.indexOps), { recursive: true })
    await fs.appendFile(pr.P.indexOps, JSON.stringify(record) + '\n', 'utf8')
  } catch (e) {
    return { ok: false, error: `Could not save the request: ${(e as Error).message}` }
  }

  for (const p of ['', '/decided', '/queue', '/review']) revalidatePath(`/${pr.slug}${p}`)
  return { ok: true, id, moved: move, skipped }
}
