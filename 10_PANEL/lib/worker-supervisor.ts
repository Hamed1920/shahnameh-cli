import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { P } from './paths'
import { getGeneratingJobId, getWorkerState, getWorkerStatus } from './store'

/**
 * Keeps the generation worker running for as long as the panel's server runs,
 * so nobody has to start it. Every few seconds:
 *   - not running  -> start it (backing off if it keeps exiting at once:
 *                     another worker holds the lock, or it crashes on start)
 *   - old code     -> ask it to stop once it is not generating; the next
 *                     tick starts it again on the new code
 * The worker is detached, so a panel restart never kills a generation in hand.
 *
 * Off when SHM_WORKER=off (a machine that must not run one: only one worker
 * across all machines, see CLAUDE.md), and off for a sandbox SHM_ROOT that has
 * no stub CLI, because a sandbox worker spends real credits.
 */

const TICK_MS = 5000
const MAX_BACKOFF_MS = 10 * 60_000

export function autostartBlockedReason(): string | null {
  if (String(process.env.SHM_WORKER ?? '').toLowerCase() === 'off') return 'SHM_WORKER=off on this machine'
  if (process.env.SHM_ROOT && !process.env.SHM_HIGGSFIELD_JS) return 'SHM_ROOT is set without the stub CLI, so a worker here would spend real credits'
  return null
}

const g = globalThis as { __shmWorkerSupervisor?: boolean }

export function superviseWorker() {
  if (g.__shmWorkerSupervisor || autostartBlockedReason()) return
  g.__shmWorkerSupervisor = true

  let backoff = 0
  let nextStart = 0

  const tick = async () => {
    try {
      const status = await getWorkerStatus()
      if (!status.running) {
        if (Date.now() >= nextStart) {
          if (await startWorker()) backoff = 0
          else {
            backoff = Math.min(Math.max(backoff * 2, 30_000), MAX_BACKOFF_MS)
            nextStart = Date.now() + backoff
          }
        }
      } else if (status.outdated) {
        const state = await getWorkerState()
        const generating = await getGeneratingJobId(new Set((state?.processedJobs ?? []) as string[]))
        if (!generating && !fs.existsSync(P.stopFlag)) {
          await fsp.writeFile(P.stopFlag, `restart for new code ${new Date().toISOString()}`, 'utf8')
        }
      }
    } catch {
      // Never let a bad read take the panel down; try again next tick.
    }
    setTimeout(tick, TICK_MS).unref()
  }
  void tick()
}

/** Spawn the worker detached, console to queue/worker.stdout.log. True once its lock is up. */
async function startWorker(): Promise<boolean> {
  const script = path.join(process.cwd(), 'worker', 'worker.mjs')
  if (!fs.existsSync(script)) return false
  await fsp.mkdir(path.dirname(P.workerStdout), { recursive: true })
  const out = fs.openSync(P.workerStdout, 'a')
  try {
    // shell:false and an argv array: nothing here is parsed by a shell.
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(), detached: true, windowsHide: true, stdio: ['ignore', out, out], env: process.env,
    })
    child.on('error', () => {})
    child.unref()
  } finally {
    fs.closeSync(out)
  }
  const until = Date.now() + 8000
  while (Date.now() < until) {
    if ((await getWorkerStatus()).running) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
