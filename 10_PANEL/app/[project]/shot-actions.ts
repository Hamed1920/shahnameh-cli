'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { idRx } from '../../worker/lib/ids.mjs'
import { EPISODE_RX } from '@/lib/episodes'
import { requireProject } from '@/lib/projects'

/**
 * Assigning footage to another episode.
 *
 * The panel only ever asks: this appends one `move-shot` op to INDEX_OPS.jsonl
 * and the worker does the moving, the numbering and the renaming
 * (worker/lib/index-ops.mjs). The worker is the single writer for anything that
 * touches a file -- see CLAUDE.md -- and it checks all of this again itself.
 */

const REVIEWER = process.env.SHM_REVIEWER || 'hamed'
const MAX_AT_ONCE = 200

export interface AssignResult {
  ok: boolean
  error?: string
  /** The op id, so the page can watch for its outcome. */
  id?: string
}

export async function assignToEpisode(project: string, shots: string[], episode: string): Promise<AssignResult> {
  const pr = await requireProject(project)
  const ep = String(episode ?? '').trim().toUpperCase()
  if (!EPISODE_RX.test(ep)) return { ok: false, error: `'${episode}' is not an episode. It looks like EP002.` }

  const wanted = [...new Set((shots ?? []).map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))]
  if (wanted.length === 0) return { ok: false, error: 'Choose some footage first.' }
  if (wanted.length > MAX_AT_ONCE) return { ok: false, error: `Too many at once (${MAX_AT_ONCE} max).` }

  const rx = idRx(pr.code)
  for (const shot of wanted) {
    const parts = shot.match(rx.shotParts)
    if (!parts || !parts[2] || !parts[3]) {
      return { ok: false, error: `${shot} is not footage, so it has no episode to move between.` }
    }
    if (parts[1] === ep) return { ok: false, error: `${shot} is already in ${ep}.` }
  }

  const id = `op_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const record = { id, ts: new Date().toISOString(), reviewer: REVIEWER, type: 'move-shot', episode: ep, shots: wanted }
  try {
    await fs.mkdir(path.dirname(pr.P.indexOps), { recursive: true })
    await fs.appendFile(pr.P.indexOps, JSON.stringify(record) + '\n', 'utf8')
  } catch (e) {
    return { ok: false, error: `Could not save the request: ${(e as Error).message}` }
  }

  for (const p of ['', '/decided', '/queue', '/review']) revalidatePath(`/${pr.slug}${p}`)
  return { ok: true, id }
}
