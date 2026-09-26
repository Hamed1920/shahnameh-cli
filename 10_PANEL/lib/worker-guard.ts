import fs from 'node:fs'
import path from 'node:path'
import { projectsDir } from './projects'

/**
 * Whether this machine may start workers at all. Read by the supervisor before
 * it starts one and by the pages that say why none is running.
 *
 * Off when SHM_WORKER=off (a machine that must not run one: only one machine
 * runs workers, see CLAUDE.md), and off for a sandbox (SHM_PROJECTS pointing at
 * a copy) that has no stub CLI, because a sandbox worker spends real credits.
 */
export function autostartBlockedReason(): string | null {
  if (String(process.env.SHM_WORKER ?? '').toLowerCase() === 'off') return 'SHM_WORKER=off on this machine'
  if (process.env.SHM_PROJECTS && !process.env.SHM_HIGGSFIELD_JS) {
    return 'SHM_PROJECTS points at a copy without the stub CLI, so a worker here would spend real credits'
  }
  // The panel chooses each worker's project itself; a SHM_ROOT left over from the
  // one-project days would send every worker to the same folder.
  if (process.env.SHM_ROOT) return 'SHM_ROOT is set for the panel; unset it (the panel sets it per worker) or use SHM_PROJECTS'
  return null
}

/**
 * "Stop all workers" on the Queue page: a flag beside the projects that keeps the
 * supervisor from starting any worker until "Start workers" removes it. This is
 * how the workers are stopped before a commit (CLAUDE.md, Git) while the panel
 * keeps running. A dot-file, so the validator and the .gitignore allowlist skip it.
 */
export const pauseFlagPath = () => path.join(projectsDir(), '.workers-paused')
export const workersPaused = () => fs.existsSync(pauseFlagPath())

/**
 * What a project's queue/worker.stop means. The supervisor writes one starting
 * with "restart" to move a worker onto new code: that worker is started again at
 * once. Any other (the Stop button, or a person) keeps it down until removed.
 */
export const RESTART_FLAG = 'restart'
export function stopFlagKind(file: string): 'none' | 'restart' | 'stop' {
  let text: string
  try { text = fs.readFileSync(file, 'utf8') } catch { return 'none' }
  return text.trimStart().startsWith(RESTART_FLAG) ? 'restart' : 'stop'
}
