'use server'

import fs from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { idRx } from '../../../worker/lib/ids.mjs'
import { EPISODE_RX, episodeTitleSlug, shortEpisode } from '@/lib/episodes'
import { requireProject } from '@/lib/projects'
import { getEpisodes } from '@/lib/store'
import { getAcceptedTakes } from '@/lib/episode-board'
import { Invalid, readFootage } from '@/lib/uploads'
import type { Project } from '@/lib/projects'

/**
 * Write side of the Episodes pages.
 *
 * Every one of these is a request appended to INDEX_OPS.jsonl; the worker is
 * the only thing that touches a folder or a file (CLAUDE.md). The checks here
 * are so a mistake shows immediately -- the worker checks all of it again, and
 * is the one that allocates any number.
 */

const REVIEWER = process.env.SHM_REVIEWER || 'hamed'
/** Long enough for a name, short enough to stay one. */
const MAX_TITLE = 60

export interface EpisodeResult {
  ok: boolean
  error?: string
  /** The op id, so the page can watch for its outcome. */
  id?: string
  /** The episode acted on, e.g. so the page can go to it. */
  episode?: string
}

const newOpId = () => `op_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

async function append(pr: Project, record: Record<string, unknown>): Promise<EpisodeResult> {
  try {
    await fs.mkdir(path.dirname(pr.P.indexOps), { recursive: true })
    await fs.appendFile(pr.P.indexOps, JSON.stringify(record) + '\n', 'utf8')
  } catch (e) {
    return { ok: false, error: `Could not save the request: ${(e as Error).message}` }
  }
  revalidatePath(`/${pr.slug}/episodes`)
  revalidatePath(`/${pr.slug}/episodes/${record.episode}`)
  revalidatePath(`/${pr.slug}`)
  return { ok: true, id: String(record.id), episode: String(record.episode) }
}

/**
 * Start an episode, so it exists before it holds anything.
 *
 * The number is whatever was asked for. Gaps are allowed and are the author's
 * to leave; what is refused is a number already in use, which would be reusing
 * one (docs/INDEXING.md section 9).
 */
export async function startEpisode(project: string, episode: string, title = ''): Promise<EpisodeResult> {
  const pr = await requireProject(project)
  const ep = String(episode ?? '').trim().toUpperCase()
  if (!EPISODE_RX.test(ep)) return { ok: false, error: `'${episode}' is not an episode. It looks like EP002.` }

  const existing = await getEpisodes(pr)
  if (existing.slice(0, -1).some((e) => e.id === ep)) {
    return { ok: false, error: `${shortEpisode(ep)} already exists. Open it instead.` }
  }

  return append(pr, {
    id: newOpId(),
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    type: 'new-episode',
    episode: ep,
    title: String(title ?? '').trim().slice(0, MAX_TITLE),
  })
}

/** Rename an episode. Its wording changes; its number never does. */
export async function renameEpisode(project: string, episode: string, title: string): Promise<EpisodeResult> {
  const pr = await requireProject(project)
  const ep = String(episode ?? '').trim().toUpperCase()
  if (!EPISODE_RX.test(ep)) return { ok: false, error: `'${episode}' is not an episode.` }

  const found = (await getEpisodes(pr)).find((e) => e.id === ep)
  if (!found?.dir) {
    return { ok: false, error: `${shortEpisode(ep)} has no folder yet, so there is nothing to rename.` }
  }
  const name = String(title ?? '').trim().slice(0, MAX_TITLE)
  if (name && !episodeTitleSlug(name)) {
    return { ok: false, error: 'The folder name is read by the PowerShell tools, so it needs Latin letters or digits. Leave it empty for just the number.' }
  }

  return append(pr, {
    id: newOpId(),
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    type: 'rename-episode',
    episode: ep,
    title: name,
  })
}

/**
 * Take shots out of an episode.
 *
 * Deliberately not a delete: the worker moves the files to 09_OUTPUT/_archive
 * with a record beside them, so they can be put back. Nothing here is ever
 * deleted from the index (CLAUDE.md), and the shot's number stays spent -- a
 * gap where a shot used to be is the correct record of one having been there.
 */
export async function archiveShots(project: string, shots: string[]): Promise<EpisodeResult> {
  const pr = await requireProject(project)
  const rx = idRx(pr.code)
  const wanted = [...new Set((shots ?? []).map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))]
  if (wanted.length === 0) return { ok: false, error: 'Choose some footage first.' }
  if (wanted.length > 50) return { ok: false, error: 'Too many at once (50 max).' }
  for (const shot of wanted) {
    if (!rx.shotFileStart.test(shot)) return { ok: false, error: `${shot} is not a shot id.` }
  }
  return append(pr, {
    id: newOpId(),
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    type: 'archive-shot',
    episode: wanted[0].match(rx.shotParts)?.[1] ?? '',
    shots: wanted,
  })
}

/** Put archived shots back in the episodes they came from. */
export async function restoreShots(project: string, archiveIds: string[]): Promise<EpisodeResult> {
  const pr = await requireProject(project)
  const ids = [...new Set((archiveIds ?? []).map(String).filter(Boolean))]
  if (ids.length === 0) return { ok: false, error: 'Choose something to put back.' }
  return append(pr, {
    id: newOpId(),
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    type: 'restore-shot',
    episode: '',
    archiveIds: ids,
  })
}

/**
 * Drop an empty episode's folder.
 *
 * The number is not given back. It stays spent for good, like every other
 * number here, so starting an episode with it again is refused.
 */
export async function removeEpisode(project: string, episode: string): Promise<EpisodeResult> {
  const pr = await requireProject(project)
  const ep = String(episode ?? '').trim().toUpperCase()
  if (!EPISODE_RX.test(ep)) return { ok: false, error: `'${episode}' is not an episode.` }
  const found = (await getEpisodes(pr)).slice(0, -1).find((e) => e.id === ep)
  if (!found) return { ok: false, error: `${shortEpisode(ep)} does not exist.` }
  if (found.shots > 0) {
    return { ok: false, error: `${shortEpisode(ep)} still holds ${found.shots} shot${found.shots === 1 ? '' : 's'}. Take those out first.` }
  }
  return append(pr, {
    id: newOpId(),
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    type: 'remove-episode',
    episode: ep,
  })
}

/**
 * File takes that are accepted but not filed as footage.
 *
 * An approved 480p draft lives in 09_OUTPUT/_drafts and was never filed into an
 * episode, so there is nothing for a move to carry -- but it is accepted work
 * and belongs in the film all the same. The worker COPIES it into the episode
 * as a new shot: the draft stays where it is, because that is what the Decided
 * page resolves, and the episode gets footage it did not have.
 */
export async function fileTakes(project: string, episode: string, shots: string[]): Promise<EpisodeResult> {
  const pr = await requireProject(project)
  const ep = String(episode ?? '').trim().toUpperCase()
  if (!EPISODE_RX.test(ep)) return { ok: false, error: `'${episode}' is not an episode.` }

  const wanted = new Set((shots ?? []).map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))
  if (wanted.size === 0) return { ok: false, error: 'Choose some footage first.' }
  if (wanted.size > 50) return { ok: false, error: 'Too many at once (50 max).' }

  const episodes = await getEpisodes(pr)
  const found = episodes.slice(0, -1).find((e) => e.id === ep)
  if (!found) return { ok: false, error: `${shortEpisode(ep)} does not exist yet. Start it first.` }

  const accepted = await getAcceptedTakes(pr)
  const takes: { file: string; originalName: string; scene: string }[] = []
  for (const shot of wanted) {
    const take = accepted.find((t) => t.shot === shot)
    if (!take) return { ok: false, error: `${shot} is not an accepted take.` }
    if (take.filed) return { ok: false, error: `${shot} is filed footage — move it instead of filing it again.` }
    if (!take.file) return { ok: false, error: `${shot} has no file on disk.` }
    takes.push({ file: take.file, originalName: shot, scene: 'next' })
  }

  return append(pr, {
    id: newOpId(),
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    type: 'add-shot',
    episode: ep,
    episodeTitle: found.title,
    takes,
  })
}

/**
 * Put footage into an episode by hand.
 *
 * The files are written under 09_OUTPUT/_uploads first and the request second,
 * so the worker can never see a request whose file is missing. It files each
 * one as the next free scene of the episode, or as another take of a scene the
 * episode already has -- it allocates the number, not this.
 */
export async function addFootage(formData: FormData): Promise<EpisodeResult> {
  const pr = await requireProject(formData.get('project'))
  const ep = String(formData.get('episode') ?? '').trim().toUpperCase()
  if (!EPISODE_RX.test(ep)) return { ok: false, error: `'${ep}' is not an episode.` }

  const episodes = await getEpisodes(pr)
  const found = episodes.find((e) => e.id === ep)
  if (!found || episodes[episodes.length - 1].id === ep) {
    return { ok: false, error: `${shortEpisode(ep)} does not exist yet. Start it first.` }
  }

  const scenes = new Set(String(formData.get('scenes') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
  const id = newOpId()
  let uploads
  try {
    uploads = await readFootage(formData, pr, id, scenes)
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }
  if (uploads.length === 0) return { ok: false, error: 'Choose at least one file.' }

  const dir = path.join(pr.P.uploads, id)
  try {
    await fs.mkdir(dir, { recursive: true })
    for (const u of uploads) await fs.writeFile(path.join(pr.root, u.meta.file), u.bytes)
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true })
    return { ok: false, error: `Could not save the files: ${(e as Error).message}` }
  }

  const r = await append(pr, {
    id,
    ts: new Date().toISOString(),
    reviewer: REVIEWER,
    type: 'add-shot',
    episode: ep,
    episodeTitle: found.title,
    uploads: uploads.map((u) => u.meta),
  })
  if (!r.ok) await fs.rm(dir, { recursive: true, force: true })
  return r
}
