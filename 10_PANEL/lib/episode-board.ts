import fs from 'node:fs/promises'
import path from 'node:path'
import { idRx } from '../worker/lib/ids.mjs'
import { isFiledShot } from './asset'
import { parseCsv } from './csv'
import { getDecidedEntries } from './decided'
import {
  getCandidates, getEpisodes, getGeneratingJobId, getQueue, getShotMoveRequests, getShotMoves, getWorkerState,
  readJsonl,
} from './store'
import type { Project } from './projects'
import type { AcceptedTake, ArchivedShot, EpisodeBoard, EpisodeScene, QueueItem, ShotOutput } from './types'

/**
 * The film, episode by episode: every scene and where it stands.
 *
 * Its own module rather than part of store.ts, because it reads the decided
 * entries, and lib/decided.ts reads store.ts -- putting this there would make
 * the two import each other.
 *
 * Nothing here is a fresh opinion about the state of a shot. It is read from
 * what actually happened: a shot is planned because a job targets it, queued
 * because the worker has not run that job yet, waiting because a take is in
 * _staging undecided, accepted because a take is filed. Every id is read
 * forward through SHOT_MOVES.jsonl first, so a scene appears once, under the
 * episode it is in now.
 */
export async function getEpisodeBoard(pr: Project): Promise<EpisodeBoard[]> {
  const [episodes, decided, queue, candidates, state, moves, requests, ledger, onDisk] = await Promise.all([
    getEpisodes(pr),
    getDecidedEntries(pr),
    getQueue(pr),
    getCandidates(pr),
    getWorkerState(pr),
    getShotMoves(pr),
    getShotMoveRequests(pr),
    readLedgerRows(pr),
    shotFilesOnDisk(pr),
  ])
  const rx = idRx(pr.code)
  const now = (id: string) => moves.shot[id] ?? id
  const processed = new Set((state?.processedJobs ?? []) as string[])
  const generating = await getGeneratingJobId(pr, processed)

  /** One row per shot, filled in by whichever source knows most about it. */
  const rows = new Map<string, EpisodeScene>()
  const row = (id: string): EpisodeScene | null => {
    const shot = now(id)
    const parts = shot.match(rx.shotParts)
    if (!parts || !parts[2]) return null
    let r = rows.get(shot)
    if (!r) {
      r = {
        shot,
        scene: parts[2],
        label: null,
        state: 'planned',
        stage: null,
        file: null,
        takes: 0,
        credits: 0,
        movingTo: requests.pending[shot] ?? null,
        outputs: [],
      }
      rows.set(shot, r)
    }
    return r
  }

  // Weakest claim first, so a stronger one overwrites it: a shot with a queued
  // job AND an accepted take is accepted, and one still generating says so.
  for (const q of queue) {
    const r = row(q.target)
    if (!r) continue
    r.label ??= (q as QueueItem & { label?: string | null }).label ?? null
    if (!processed.has(q.jobId)) r.state = q.jobId === generating ? 'generating' : 'queued'
  }
  for (const c of candidates) {
    if (c.decided) continue
    const r = row(String(c.sidecar.target ?? ''))
    if (!r) continue
    r.label ??= c.sidecar.label ?? null
    r.state = 'review'
  }
  // Newest first, so the first accepted take seen is the one to show.
  for (const e of decided) {
    const r = row(e.target)
    if (!r) continue
    r.label ??= e.title
    if (e.decision.verdict === 'denied') {
      if (r.state === 'planned') r.state = 'denied'
      continue
    }
    r.state = 'accepted'
    r.takes += 1
    if (r.file === null) { r.file = e.file; r.stage = e.stage }
  }

  /**
   * Every output of every shot, from the decisions that made them.
   *
   * A denied take is kept -- nothing is deleted here -- and is part of how the
   * shot got where it is, so it belongs in the history beside the accepted one.
   * Files are deduplicated: an accepted decision and the filed take are the
   * same video, recorded twice.
   */
  for (const e of decided) {
    const r = rows.get(now(e.target))
    if (!r || !e.file) continue
    if (r.outputs.some((o) => o.file === e.file)) continue
    r.outputs.push({
      file: e.file,
      take: takeOf(e.file, now(e.target)),
      verdict: e.decision.verdict === 'accepted' ? 'accepted' : 'denied',
      stage: e.stage,
      attempt: e.attempt,
      ts: e.decision.ts,
      notes: e.notes,
      filed: isFiledShot(e.file),
      isVideo: e.isVideo,
    })
  }
  /**
   * Footage on disk that nothing else knows about.
   *
   * A shot filed by hand ("Add outputs") has no queued job and no decision --
   * it was never generated here -- so every source above misses it and the
   * episode looked empty after putting something in it. The files are the
   * truth about what an episode holds, so they are read last and fill in both
   * the rows nothing else claimed and any row still without a picture.
   */
  for (const [shot, files] of onDisk) {
    const r = row(shot)
    if (!r) continue
    // Filed footage no decision claims: added by hand, or filed on another
    // machine whose worker log is not here.
    for (const file of files) {
      if (r.outputs.some((o) => o.file === file)) continue
      r.outputs.push({
        file,
        take: takeOf(file, shot),
        verdict: null,
        stage: null,
        attempt: 1,
        ts: '',
        notes: '',
        filed: true,
        isVideo: /\.(mp4|mov|webm)$/i.test(file),
      })
    }
    r.takes = Math.max(r.takes, files.length)
    if (!r.file) {
      r.file = files[files.length - 1]
      r.state = 'accepted'
      // It is in the episode's shots folder, which is what filed means.
      r.stage ??= 'final'
    }
  }

  for (const l of ledger) {
    if (l.state !== 'GENERATED') continue
    const r = rows.get(now(String(l.resolved_target || l.target || '')))
    const cost = parseFloat(l.cost)
    if (r && Number.isFinite(cost)) r.credits += cost
  }

  // Oldest first: the history reads forward. A filed take has a take number to
  // order by; anything else falls back to when it was decided.
  for (const r of rows.values()) {
    r.outputs.sort((a, b) => a.take.localeCompare(b.take) || a.ts.localeCompare(b.ts))
  }

  const byEpisode = new Map<string, EpisodeScene[]>()
  for (const r of rows.values()) {
    const ep = r.shot.match(rx.shotParts)?.[1]
    if (ep) byEpisode.set(ep, [...(byEpisode.get(ep) ?? []), r])
  }

  // getEpisodes ends with the next free number, which is not an episode yet.
  return episodes.slice(0, -1).map((ep) => {
    const scenes = (byEpisode.get(ep.id) ?? []).sort((a, b) => a.shot.localeCompare(b.shot))
    const count = (s: EpisodeScene['state']) => scenes.filter((x) => x.state === s).length
    return {
      id: ep.id,
      title: ep.title,
      dir: ep.dir,
      scenes,
      counts: {
        scenes: scenes.length,
        accepted: count('accepted'),
        drafts: scenes.filter((x) => x.state === 'accepted' && x.stage === 'draft').length,
        review: count('review'),
        working: count('queued') + count('generating'),
        denied: count('denied'),
        planned: count('planned'),
      },
      credits: scenes.reduce((n, s) => n + s.credits, 0),
    }
  })
}

/** `...SH0010_V01_T03.mp4` is take 3; no `_T` is take 1 (the grammar's implicit T01). */
function takeOf(file: string, shot: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1)
  return name.startsWith(shot) ? (name.slice(shot.length).match(/_T(\d{2})/)?.[0].slice(1) ?? 'T01') : 'T01'
}

/**
 * Every shot file filed in an episode, keyed by shot id, oldest take first.
 * The one source that does not depend on a job or a decision having existed.
 */
async function shotFilesOnDisk(pr: Project): Promise<Map<string, string[]>> {
  const rx = idRx(pr.code)
  const out = new Map<string, string[]>()
  const root = path.join(pr.P.root, '07_EPISODES')
  for (const dir of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!dir.isDirectory()) continue
    const folder = `07_EPISODES/${dir.name}/shots`
    const names = await fs.readdir(path.join(root, dir.name, 'shots')).catch(() => [] as string[])
    for (const name of names.sort()) {
      const shot = name.match(rx.shotFileStart)?.[0]
      if (shot) out.set(shot, [...(out.get(shot) ?? []), `${folder}/${name}`])
    }
  }
  return out
}

/** JOB_LEDGER.csv as rows. The spend ceiling reads the same file, per project. */
async function readLedgerRows(pr: Project): Promise<Record<string, string>[]> {
  try {
    return parseCsv(await fs.readFile(pr.P.ledger, 'utf8'))
  } catch {
    return []
  }
}

/**
 * Every accepted take, one row per shot, for the "add outputs" picker.
 *
 * Putting accepted work into an episode is not a new asset -- it is the same
 * footage, in a different part of the film -- so this is what the picker lists
 * and a `move-shot` is what it does. A shot moves with all of its takes, so a
 * shot is the row, not a take.
 *
 * Design images filed under an entity are listed too, and marked: they have no
 * shot id, so there is nothing for an episode to hold. Saying so beats leaving
 * them out and looking like work has gone missing.
 */
export async function getAcceptedTakes(pr: Project): Promise<AcceptedTake[]> {
  const [decided, requests] = await Promise.all([getDecidedEntries(pr), getShotMoveRequests(pr)])
  const rx = idRx(pr.code)
  const byShot = new Map<string, AcceptedTake>()

  // Newest first, so the first take seen of a shot is the one shown.
  for (const e of decided) {
    if (e.decision.verdict !== 'accepted') continue
    const parts = e.target.match(rx.shotParts)
    const row = byShot.get(e.target)
    if (row) {
      row.takes += 1
      if (!row.file) { row.file = e.file; row.filed = isFiledShot(e.file) }
      else if (!row.filed && isFiledShot(e.file)) { row.file = e.file; row.filed = true }
      continue
    }
    byShot.set(e.target, {
      shot: e.target,
      episode: parts?.[1] ?? null,
      scene: parts?.[2] ?? null,
      label: e.title,
      file: e.file,
      filed: isFiledShot(e.file),
      isVideo: e.isVideo,
      takes: 1,
      ts: e.decision.ts,
      movingTo: requests.pending[e.target] ?? null,
    })
  }
  return [...byShot.values()].sort((a, b) => b.ts.localeCompare(a.ts))
}

/** Shots taken out of an episode and not put back, newest first. */
export async function getArchivedShots(pr: Project): Promise<ArchivedShot[]> {
  const log = await readJsonl<Record<string, unknown>>(path.join(pr.P.archive, 'index.jsonl'))
  const restored = new Set(log.filter((x) => x.restored).map((x) => String(x.archiveId)))
  const out: ArchivedShot[] = []
  for (const x of log) {
    if (x.kind !== 'shot' || x.restored || restored.has(String(x.archiveId))) continue
    const files = (x.files ?? []) as { from: string; to: string }[]
    // A record can outlive its file if someone moved it by hand.
    try { await fs.access(path.join(pr.P.root, files[0]?.to ?? '')) } catch { continue }
    out.push({
      archiveId: String(x.archiveId),
      shot: String(x.shot),
      episode: String(x.shot).match(idRx(pr.code).shotParts)?.[1] ?? null,
      file: files[0]?.to ?? null,
      takes: files.length,
      by: String(x.by ?? ''),
      ts: String(x.ts ?? ''),
    })
  }
  return out.reverse()
}
