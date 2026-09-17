import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * A lock file holding the owner's pid. Two uses: queue/worker.lock (one worker
 * per project) and projects/.generate.lock (one generation at a time across
 * every project, since they all spend from the same Higgsfield account).
 */

export function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

async function holder(file) {
  return parseInt((await fs.readFile(file, 'utf8').catch(() => '')).trim().split(/\s+/)[0], 10)
}

/**
 * Take the lock, with stale reclaim: a killed owner leaves its file behind, and
 * without the liveness check that blocks every future run until someone deletes
 * a file by hand. `note` follows the pid on the first line (who holds it, for a
 * person reading the file). Returns false while a live process holds it.
 */
export async function acquireFileLock(file, { note = '', onReclaim = async () => {} } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fs.open(file, 'wx')
      await fh.write(note ? `${process.pid} ${note}` : String(process.pid))
      await fh.close()
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const held = await holder(file)
      if (held === process.pid) return true
      if (pidAlive(held)) return false
      await onReclaim(held)
      await fs.rm(file, { force: true })
    }
  }
  return false
}

/** Release only a lock this process holds, never one another process reclaimed since. */
export async function releaseFileLock(file) {
  if ((await holder(file)) === process.pid) await fs.rm(file, { force: true })
}
