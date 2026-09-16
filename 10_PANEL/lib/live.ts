import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { P } from './paths'

/**
 * A fingerprint of everything the worker (or a PowerShell tool) writes that a
 * page shows. The panel polls it and re-renders only when it moves, so a new
 * video appears within a couple of seconds without re-reading the registries
 * on a timer.
 *
 * Cheap on purpose: stats, one directory listing, and state.json.
 */

const FILES = [
  P.reviewLog, P.queue, P.workerLog, P.filings, P.ledger, P.entities, P.manifest,
  P.learnings, P.indexOps, P.indexOpResults, P.jobRequests, P.jobRequestResults,
  // Likes, tags and the Gallery's order, so a second tab follows along.
  P.gallery,
  // The lock is what "worker running" is read from; Start/Stop must show within a poll.
  P.workerLock,
]

/**
 * Last good reading per file. On Windows a stat or read can fail for a moment
 * while the worker swaps a file in; reusing the previous value stops that from
 * looking like a change and back again.
 */
const lastGood = new Map<string, string>()

async function stamp(file: string): Promise<string> {
  try {
    const s = await fs.stat(file)
    const v = `${s.size}:${s.mtimeMs}`
    lastGood.set(file, v)
    return v
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '-'
    return lastGood.get(file) ?? '-'
  }
}

/** Compared by content, not mtime: `updatedAt` moves on its own and means nothing here. */
async function workerState(): Promise<string> {
  try {
    const { updatedAt: _, ...rest } = JSON.parse(await fs.readFile(P.workerState, 'utf8'))
    const v = JSON.stringify(rest)
    lastGood.set(P.workerState, v)
    return v
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '-'
    return lastGood.get(P.workerState) ?? '-'
  }
}

/**
 * Batch folders come and go, job.json lands last (after the download), and a
 * decided candidate's file leaves its folder -- which moves the folder's mtime.
 */
async function staging(): Promise<string[]> {
  let dirs: string[]
  try {
    dirs = (await fs.readdir(P.staging, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
  return Promise.all(
    dirs.map(async (d) => {
      const dir = path.join(P.staging, d)
      return `${d}|${await stamp(dir)}|${await stamp(path.join(dir, 'job.json'))}`
    }),
  )
}

export async function getProjectVersion(): Promise<string> {
  const parts = await Promise.all([...FILES.map(stamp), workerState(), staging().then((s) => s.join(','))])
  return createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16)
}
