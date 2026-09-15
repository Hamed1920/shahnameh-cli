import fs from 'node:fs/promises'
import path from 'node:path'
import { P } from './paths'
import type { JobRequest } from './types'

/**
 * The panel's side of JOB_REQUESTS.jsonl: ids and one serialised append.
 * Server-only and not a 'use server' module: appending must never become a
 * callable endpoint of its own. The worker (worker/lib/job-requests.mjs) is
 * the only thing that acts on a line written here.
 */

export const REVIEWER = process.env.SHM_REVIEWER || 'hamed'

export function newRequestId(): string {
  return `jr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function newBatchId(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `B-${stamp}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
}

// One append at a time within this process: a batch line can run to hundreds
// of kilobytes, and two tabs submitting at once must not interleave.
let tail: Promise<void> = Promise.resolve()

export function appendJobRequest(record: JobRequest): Promise<void> {
  const run = tail.then(async () => {
    await fs.mkdir(path.dirname(P.jobRequests), { recursive: true })
    await fs.appendFile(P.jobRequests, JSON.stringify(record) + '\n', 'utf8')
  })
  tail = run.catch(() => {})
  return run
}
