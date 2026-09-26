import { thumbUrl } from './asset'
import { parseCsv } from './csv'
import { listProjects, type Project } from './projects'
import { getAssets, getEntities, getQueue, getWorkerConfig, getWorkerState, getWorkerStatus } from './store'
import { spentInWindow } from '../worker/lib/spend.mjs'
import { MACHINE } from '../worker/lib/machine.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Everything the project picker puts on screen, gathered once per request.
 *
 * The picker shows a film rather than a link to one: a strip of its own plates
 * and the numbers that decide whether it can work right now. That means five
 * small reads per project, so the choice of reads matters. Deliberately NOT
 * used here: getDecidedEntries (nine reads, a _staging scan and an fs.access
 * per decision), getCandidates, getBatches, getLibrary, and getPriceTable --
 * which loops every project itself, so calling it per project is O(N^2).
 *
 * Nothing is cached, for the reason the rest of lib/store.ts is not: the worker
 * rewrites these files underneath us and a stale queue count is a lie.
 */

/** Manifest rows the thumbnailer can actually render. api/thumb 404s on video. */
const IMAGE = /\.(png|jpe?g|webp|gif)$/i

/** Four frames show in the strip; the fifth waits off the right edge for the hover advance. */
const STRIP_FRAMES = 5

export interface Frame {
  /** Thumbnail URL through the project's guarded route. */
  src: string
  /** The asset's ID, so the frame is not an anonymous decoration to a screen reader. */
  label: string
}

export interface FilmRow {
  slug: string
  name: string
  code: string
  description: string
  mark: string
  /** Year only: the band prints "SHM · since 2026". */
  since: string
  frames: Frame[]
  entities: number
  looks: number
  /** Lifetime credits this film has spent, across every generation in its ledger. */
  credits: number
  queued: number
  /** Queued but refused for now -- over the ceiling, or not logged in. */
  held: number
  running: boolean
  /** Why the panel is not keeping a worker alive here, when it isn't. */
  workerOff: string | null
  /** This film's share of the rolling window, summed into the account figure. */
  windowSpend: number
}

/** The rolling spend ceiling, which is account-wide: every film draws on one Higgsfield account. */
export interface AccountSpend {
  spent: number
  ceiling: number
  hours: number
  over: boolean
}

async function readLedger(file: string) {
  try {
    return parseCsv(await fs.readFile(file, 'utf8'))
  } catch {
    return []
  }
}

/** Every generation this film has ever paid for. spentInWindow answers the other question. */
function lifetimeCredits(rows: Record<string, string>[]): number {
  let total = 0
  for (const r of rows) {
    if (r.state !== 'GENERATED') continue
    const cost = parseFloat(r.cost)
    if (Number.isFinite(cost)) total += cost
  }
  return total
}

/**
 * The film's most recent plates, newest first. `added` is a date with no clock,
 * so ties fall back to manifest order, which is append order.
 *
 * A manifest row can outlive its file -- a look gets archived, or a sync half
 * lands -- and api/thumb answers 404, which paints an empty frame in the strip.
 * So candidates are checked on disk and only the first STRIP_FRAMES that really
 * exist are hung.
 */
async function recentFrames(pr: Project, assets: Awaited<ReturnType<typeof getAssets>>): Promise<Frame[]> {
  const candidates = assets
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row.status !== 'RETIRED' && row.folder && IMAGE.test(row.filename))
    .sort((a, b) => b.row.added.localeCompare(a.row.added) || b.i - a.i)
    .slice(0, STRIP_FRAMES * 4)

  const frames: Frame[] = []
  for (const { row } of candidates) {
    if (frames.length >= STRIP_FRAMES) break
    const rel = `${row.folder}/${row.filename}`
    try {
      await fs.access(path.join(pr.root, row.folder, row.filename))
    } catch {
      continue
    }
    frames.push({ src: thumbUrl(pr.slug, rel, 480), label: row.entity_id || row.filename })
  }
  return frames
}

async function filmRow(pr: Project, hours: number): Promise<FilmRow> {
  const [assets, entities, queue, state, worker, ledger] = await Promise.all([
    getAssets(pr),
    getEntities(pr),
    getQueue(pr),
    getWorkerState(pr),
    getWorkerStatus(pr),
    readLedger(pr.P.ledger),
  ])

  // getWaitingJobs re-reads both of these; queued and held come off one pair of reads instead.
  const processed = new Set((state?.processedJobs ?? []) as string[])
  const waiting = queue.filter((q) => !processed.has(q.jobId))
  const heldIds = new Set(Object.keys((state?.held ?? {}) as Record<string, unknown>))

  return {
    slug: pr.slug,
    name: pr.name,
    code: pr.code,
    description: pr.description,
    mark: pr.mark,
    since: pr.created.slice(0, 4),
    frames: await recentFrames(pr, assets),
    entities: entities.filter((e) => e.status !== 'RETIRED').length,
    looks: assets.filter((a) => a.status !== 'RETIRED').length,
    credits: lifetimeCredits(ledger),
    queued: waiting.length,
    held: waiting.filter((q) => heldIds.has(q.jobId)).length,
    running: worker.running,
    workerOff: worker.autostartOff ?? null,
    // This machine's account: another machine spends from its own.
    windowSpend: spentInWindow(ledger, hours, Date.now(), MACHINE),
  }
}

/** A project whose folder is half-written or mid-sync still gets a band, just an empty one. */
function degraded(pr: Project): FilmRow {
  return {
    slug: pr.slug,
    name: pr.name,
    code: pr.code,
    description: pr.description,
    mark: pr.mark,
    since: pr.created.slice(0, 4),
    frames: [],
    entities: 0,
    looks: 0,
    credits: 0,
    queued: 0,
    held: 0,
    running: false,
    workerOff: null,
    windowSpend: 0,
  }
}

export interface PickerData {
  films: FilmRow[]
  spend: AccountSpend
  taken: { slugs: string[]; codes: string[] }
}

export async function getPickerData(): Promise<PickerData> {
  const [projects, cfg] = await Promise.all([listProjects(), getWorkerConfig()])
  const hours = Number(cfg.costWindowHours) || 24
  const ceiling = Number(cfg.costCeilingCredits) || 0

  const films = await Promise.all(
    projects.map((pr) => filmRow(pr, hours).catch(() => degraded(pr))),
  )

  const spent = films.reduce((sum, f) => sum + f.windowSpend, 0)

  return {
    films,
    spend: { spent, ceiling, hours, over: ceiling > 0 && spent >= ceiling },
    taken: { slugs: projects.map((p) => p.slug), codes: projects.map((p) => p.code) },
  }
}
