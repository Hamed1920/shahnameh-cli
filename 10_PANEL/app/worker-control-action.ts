'use server'

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { P } from '@/lib/paths'
import { getWorkerStatus } from '@/lib/store'

/**
 * Start and stop the generation worker from the panel, so nothing needs a
 * terminal after `npm run dev`. The worker is spawned detached with its
 * console going to queue/worker.stdout.log, so a crash trace or "already
 * running" is readable from here. A graceful stop writes queue/worker.stop
 * and the worker exits after the job in hand; a force stop kills the process,
 * which leaves any Higgsfield job running server-side (credits spent) and the
 * queue job unprocessed, so the next worker would buy it again.
 */

type Result = { ok: boolean; error?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(pred: () => Promise<boolean>, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await pred()) return true
    await sleep(250)
  }
  return pred()
}

export async function startWorker(): Promise<Result> {
  if ((await getWorkerStatus()).running) return { ok: false, error: 'The worker is already running.' }
  const script = path.join(process.cwd(), 'worker', 'worker.mjs')
  try { await fsp.access(script) } catch { return { ok: false, error: `Not found: ${script}. Start the panel from 10_PANEL.` } }

  await fsp.mkdir(path.dirname(P.workerStdout), { recursive: true })
  const out = fs.openSync(P.workerStdout, 'a')
  try {
    // shell:false and an argv array: nothing here is parsed by a shell.
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, out],
      env: process.env,
    })
    child.on('error', () => {})
    child.unref()
  } finally {
    fs.closeSync(out)
  }
  const up = await waitFor(async () => (await getWorkerStatus()).running, 5000)
  revalidatePath('/queue')
  revalidatePath('/prompts')
  if (!up) return { ok: false, error: 'The worker did not start. See 00_PROJECT/queue/worker.stdout.log.' }
  return { ok: true }
}

export async function stopWorker(mode: 'graceful' | 'force'): Promise<Result> {
  const status = await getWorkerStatus()
  if (!status.running) return { ok: false, error: 'The worker is not running.' }

  if (mode === 'graceful') {
    await fsp.writeFile(P.stopFlag, new Date().toISOString(), 'utf8')
    // Idle workers exit within a poll; a generating one finishes its job first.
    const down = await waitFor(async () => !(await getWorkerStatus()).running, 8000)
    revalidatePath('/queue')
    revalidatePath('/prompts')
    return { ok: true, ...(down ? {} : { error: 'Stopping after the job in progress. This can take minutes.' }) }
  }

  let pid: number
  try { pid = parseInt((await fsp.readFile(P.workerLock, 'utf8')).trim(), 10) } catch { return { ok: false, error: 'No lock file to read the pid from.' } }
  if (!Number.isFinite(pid) || pid <= 0) return { ok: false, error: 'The lock file holds no pid.' }
  try { process.kill(pid, 'SIGTERM') } catch (e) { return { ok: false, error: `Could not stop pid ${pid}: ${(e as Error).message}` } }
  await waitFor(async () => !(await getWorkerStatus()).running, 5000)
  // TerminateProcess runs no cleanup: clear the lock and any stop flag ourselves.
  await fsp.rm(P.workerLock, { force: true }).catch(() => {})
  await fsp.rm(P.stopFlag, { force: true }).catch(() => {})
  revalidatePath('/queue')
  revalidatePath('/prompts')
  return { ok: true }
}

/** Graceful stop, wait for the lock to go, start again with the current code. */
export async function restartWorker(): Promise<Result> {
  if ((await getWorkerStatus()).running) {
    await fsp.writeFile(P.stopFlag, new Date().toISOString(), 'utf8')
    const down = await waitFor(async () => !(await getWorkerStatus()).running, 20000)
    if (!down) return { ok: false, error: 'Still finishing a job. Try again when it is idle, or force-stop it.' }
  }
  return startWorker()
}
