'use server'

import fsp from 'node:fs/promises'
import { listProjects } from '@/lib/projects'
import { revalidateProject } from '@/lib/revalidate'
import { pauseFlagPath, stopFlagKind } from '@/lib/worker-guard'

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
