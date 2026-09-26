import type { WorkerStatus } from './types'

/**
 * What the worker is doing, in words Hamed uses: a headline, a detail line and
 * a tone for the dot. Shared by the sidebar's dot and the worker line on the
 * Queue and Prompts pages, so they never describe the same worker differently.
 * Client-safe.
 */
export type WorkerTone = 'busy' | 'ready' | 'wait' | 'off' | 'bad'

export interface WorkerSummary {
  tone: WorkerTone
  headline: string
  detail: string
}

export function describeWorker(
  status: WorkerStatus,
  opts: { generating?: string | null; held?: number; slow?: boolean } = {},
): WorkerSummary {
  const { generating = null, held = 0, slow = false } = opts
  const onHold = held > 0 ? `${held} job${held === 1 ? '' : 's'} on hold` : null
  if (status.running) {
    if (status.stopRequested) return { tone: 'wait', headline: 'Worker stopping', detail: 'after the job in hand' }
    if (generating) return { tone: 'busy', headline: 'Generating', detail: generating }
    if (status.outdated) return { tone: 'wait', headline: 'Worker restarting', detail: 'on the new code, once idle' }
    if (onHold) return { tone: 'bad', headline: 'Worker ready', detail: onHold }
    return { tone: 'ready', headline: 'Worker ready', detail: 'waiting for work' }
  }
  if (status.paused) return { tone: 'off', headline: 'Workers stopped', detail: 'start them from the Queue page' }
  if (status.stopRequested) return { tone: 'off', headline: 'Worker stopped', detail: 'start it from the Queue page' }
  if (status.autostartOff) return { tone: 'off', headline: 'Worker off', detail: 'not run on this computer' }
  if (slow) return { tone: 'bad', headline: 'Worker not starting', detail: 'the Queue page says why' }
  return { tone: 'wait', headline: 'Worker starting', detail: 'a few seconds' }
}

/** The dot for a tone. Green only for a worker that is up; red only for trouble. */
export const TONE_DOT: Record<WorkerTone, string> = {
  busy: 'bg-good',
  ready: 'bg-good',
  wait: 'bg-fg/60',
  off: 'bg-transparent ring-1 ring-inset ring-faint',
  bad: 'bg-bad',
}

/** A worker still "starting" this long after the page first saw it is not starting. */
export const NOT_STARTING_MS = 60_000
