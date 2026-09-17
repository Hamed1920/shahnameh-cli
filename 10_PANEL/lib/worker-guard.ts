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
