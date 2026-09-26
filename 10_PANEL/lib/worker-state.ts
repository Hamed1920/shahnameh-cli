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
