import type { WorkerStatus } from './types'

/**
 * What the worker is doing, in words Hamed uses: one headline and one detail
 * line, and a tone for the dot. Shared by the sidebar and the Queue page so
 * they never describe the same worker differently. Client-safe.
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
    if (status.stopRequested) return { tone: 'wait', headline: 'Stopping', detail: 'after the job in hand' }
    if (generating) return { tone: 'busy', headline: 'Generating', detail: generating }
    if (status.outdated) return { tone: 'wait', headline: 'Restarting', detail: 'on the new code, once idle' }
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

// ---------------------------------------------------------------- every machine's state, as one

/**
 * The worker state the panel shows: every machine's, merged. Each machine's worker
 * writes only its own queue/state.<machine>.json (worker/lib/project.mjs), and the
 * legacy state.json from before that is still there, frozen. A job, decision or
 * request is processed if any of them says so. Pure, so it can be tested.
 */

type State = Record<string, unknown>

const LISTS = ['processedJobs', 'processedDecisions', 'processedOps', 'processedRequests']
const MAPS = ['held', 'failedJobs', 'failedDecisions']

export function mergeStates(states: State[]): State | null {
  if (states.length === 0) return null
  if (states.length === 1) return states[0]
  const out: State = {}
  for (const s of states) {
    for (const [k, v] of Object.entries(s)) {
      if (LISTS.includes(k) && Array.isArray(v)) {
        out[k] = [...new Set([...((out[k] as unknown[]) ?? []), ...v])]
      } else if (MAPS.includes(k) && v && typeof v === 'object') {
        out[k] = { ...((out[k] as object) ?? {}), ...(v as object) }
      } else if (k === 'spentCredits' && typeof v === 'number') {
        out[k] = ((out[k] as number) ?? 0) + v
      } else if (k === 'updatedAt' && typeof v === 'string') {
        if (!out[k] || v > String(out[k])) out[k] = v
      } else if (!(k in out)) {
        out[k] = v
      }
    }
  }
  return out
}

/** A state file in a project's queue folder: state.json (legacy) or state.<machine>.json. */
export const STATE_FILE_RX = /^state(\.[a-z0-9-]+)?\.json$/
