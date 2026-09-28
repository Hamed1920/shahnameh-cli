'use server'

import fsp from 'node:fs/promises'
import { REVIEWER, appendJobRequest, newRequestId } from '@/lib/job-requests'
import { listProjects, requireProject } from '@/lib/projects'
import { revalidateProject } from '@/lib/revalidate'
import { getQueue, getWorkerState } from '@/lib/store'
import { pauseFlagPath, stopFlagKind } from '@/lib/worker-guard'

/**
 * Retry or remove a generation that failed. One append to JOB_REQUESTS.jsonl;
 * the worker queues a retry (worker/lib/job-requests.mjs, job.retry) and a
 * removal only hides the failure here. Checked first so a stale page says so.
 */
export async function actOnFailedJob(
  project: string,
  jobId: string,
  action: 'retry' | 'dismiss',
): Promise<{ ok: boolean; error?: string }> {
  const pr = await requireProject(project)
  const [queue, state] = await Promise.all([getQueue(pr), getWorkerState(pr)])
  if (!queue.some((q) => q.jobId === jobId)) return { ok: false, error: 'That job is not in the queue any more.' }
  if (!((state?.failedJobs ?? {}) as Record<string, unknown>)[jobId]) return { ok: false, error: 'That job did not fail.' }
  if (action === 'retry' && queue.some((q) => (q as { retryOf?: string }).retryOf === jobId)) {
    return { ok: false, error: 'It has already been retried.' }
  }
  try {
    await appendJobRequest(pr, {
      id: newRequestId(), ts: new Date().toISOString(), reviewer: REVIEWER,
      type: action === 'retry' ? 'job.retry' : 'job.dismiss', jobId,
    })
  } catch (e) {
    return { ok: false, error: `Could not send it: ${(e as Error).message}` }
  }
  revalidateProject(pr.slug)
  return { ok: true }
}

/**
 * Stop every project's worker, and keep them stopped: the way to stop them before
 * a commit while the panel keeps running (CLAUDE.md, Git). The pause flag keeps the
 * supervisor from starting any (lib/worker-supervisor.ts); each worker.stop makes a
 * running worker finish the job in hand and exit -- never mid-generation.
 */
export async function stopAllWorkers(project: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await fsp.writeFile(pauseFlagPath(), `stopped from the panel ${new Date().toISOString()}\n`, 'utf8')
    for (const pr of await listProjects()) {
      await fsp.writeFile(pr.P.stopFlag, `stop requested from the panel ${new Date().toISOString()}\n`, 'utf8')
    }
  } catch (e) {
    return { ok: false, error: `Could not stop the workers: ${(e as Error).message}` }
  }
  revalidateProject(project)
  return { ok: true }
}

/** Undo "Stop all workers": the supervisor starts every worker again on its next tick. */
export async function startAllWorkers(project: string): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const pr of await listProjects()) {
      if (stopFlagKind(pr.P.stopFlag) === 'stop') await fsp.rm(pr.P.stopFlag, { force: true })
    }
    await fsp.rm(pauseFlagPath(), { force: true })
  } catch (e) {
    return { ok: false, error: `Could not start the workers: ${(e as Error).message}` }
  }
  revalidateProject(project)
  return { ok: true }
}
