import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { listProjects, projectsDir, type Project } from './projects'
import { autostartBlockedReason } from './worker-guard'
import { getGeneratingJobId, getWorkerState, getWorkerStatus } from './store'

/**
 * Keeps one generation worker running per project, for as long as the panel's
 * server runs, so nobody has to start one. Every few seconds, for each project
 * under projects/:
 *   - not running  -> start it (backing off if it keeps exiting at once:
 *                     another worker holds the lock, or it crashes on start)
 *   - old code     -> ask it to stop once it is not generating; the next
 *                     tick starts it again on the new code
 * Workers are detached, so a panel restart never kills a generation in hand.
 *
 * A project nobody has open still gets a worker: a batch approved this morning
 * must keep generating while the reviewer works on another film. They do not
 * race for credits -- only one generation runs at a time across the whole
 * machine (GENERATE_LOCK in worker/lib/project.mjs).
 *
 * See lib/worker-guard.ts for the machines where none of this runs at all.
 */

const TICK_MS = 5000
const MAX_BACKOFF_MS = 10 * 60_000

export { autostartBlockedReason }

const g = globalThis as { __shmWorkerSupervisor?: boolean }

export function superviseWorker() {
  if (g.__shmWorkerSupervisor || autostartBlockedReason()) return
  g.__shmWorkerSupervisor = true

  /** Per project: how long to wait before trying again after a failed start. */
  const backoff = new Map<string, { ms: number; nextStart: number }>()

  const tick = async () => {
    try {
      for (const pr of await listProjects()) {
        try {
          await superviseOne(pr, backoff)
        } catch {
          // One project's trouble must not stop the others being supervised.
        }
      }
    } catch {
      // Never let a bad read take the panel down; try again next tick.
    }
    setTimeout(tick, TICK_MS).unref()
  }
  void tick()
}

async function superviseOne(pr: Project, backoff: Map<string, { ms: number; nextStart: number }>) {
  const status = await getWorkerStatus(pr)
  if (!status.running) {
    const b = backoff.get(pr.slug) ?? { ms: 0, nextStart: 0 }
    if (Date.now() < b.nextStart) return
    if (await startWorker(pr)) backoff.delete(pr.slug)
    else {
      const ms = Math.min(Math.max(b.ms * 2, 30_000), MAX_BACKOFF_MS)
      backoff.set(pr.slug, { ms, nextStart: Date.now() + ms })
    }
    return
  }
  if (!status.outdated) return
  const state = await getWorkerState(pr)
  const generating = await getGeneratingJobId(pr, new Set((state?.processedJobs ?? []) as string[]))
  if (!generating && !fs.existsSync(pr.P.stopFlag)) {
    await fsp.writeFile(pr.P.stopFlag, `restart for new code ${new Date().toISOString()}`, 'utf8')
  }
}

/** Spawn one project's worker detached, console to its queue/worker.stdout.log. True once its lock is up. */
async function startWorker(pr: Project): Promise<boolean> {
  const script = path.join(process.cwd(), 'worker', 'worker.mjs')
  if (!fs.existsSync(script)) return false
  await fsp.mkdir(path.dirname(pr.P.workerStdout), { recursive: true })
  const out = fs.openSync(pr.P.workerStdout, 'a')
  try {
    // shell:false and an argv array: nothing here is parsed by a shell.
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, out],
      // Each worker is told its own project. SHM_PROJECTS is what it adds spend
      // up across, and where the machine-wide generation lock lives.
      env: { ...process.env, SHM_ROOT: pr.root, SHM_PROJECTS: projectsDir() },
    })
    child.on('error', () => {})
    child.unref()
  } finally {
    fs.closeSync(out)
  }
  const until = Date.now() + 8000
  while (Date.now() < until) {
    if ((await getWorkerStatus(pr)).running) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
