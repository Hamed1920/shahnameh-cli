import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * A lock file holding the owner's pid. Two uses: queue/worker.lock (one worker
 * per project) and projects/.generate.lock (one generation at a time across
 * every project, since they all spend from the same Higgsfield account).
 *
 * The file is two lines:
 *   <pid> [note]                         who holds it (the note is for a person)
 *   started=<ms> heartbeat=<seconds>     when it was taken, and how often it is touched
 *
 * The holder touches the file every HEARTBEAT_S while it holds it. A pid alone is
 * not enough on Windows: after a crash and a reboot the old pid can belong to some
 * other process, and the lock would look held forever. A lock that says it has a
 * heartbeat and has not been touched for STALE_MS is stale whatever its pid.
 * A lock without the second line (written by older code) is judged by its pid only.
 */

export const HEARTBEAT_S = 30
export const STALE_MS = 3 * 60_000

export function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** What a lock file says: { pid, startedMs, heartbeat, mtimeMs, text } or null when there is none. */
export async function readLock(file) {
  let text
  let stat
  try {
    [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
  } catch {
    return null
  }
  const pid = parseInt(text.trim().split(/\s+/)[0], 10)
  const started = text.match(/\bstarted=(\d+)/)
  return {
    pid,
    startedMs: started ? Number(started[1]) : stat.mtimeMs,
    heartbeat: /\bheartbeat=\d+/.test(text),
    mtimeMs: stat.mtimeMs,
    text,
  }
}

/** A lock whose owner is gone: dead pid, or a heartbeat lock nobody has touched for STALE_MS. */
export function lockIsStale(lock, now = Date.now()) {
  if (!lock) return true
  if (!pidAlive(lock.pid)) return true
  return lock.heartbeat && now - lock.mtimeMs > STALE_MS
}

const beats = new Map()

function startHeartbeat(file) {
  stopHeartbeat(file)
  const timer = setInterval(() => {
    const t = new Date()
    fs.utimes(file, t, t).catch(() => {})
  }, HEARTBEAT_S * 1000)
  timer.unref()
  beats.set(file, timer)
}

function stopHeartbeat(file) {
  clearInterval(beats.get(file))
  beats.delete(file)
}

/**
 * Take the lock, with stale reclaim: a killed owner leaves its file behind, and
 * without the liveness check that blocks every future run until someone deletes
 * a file by hand. `note` follows the pid on the first line. Returns false while a
 * live process holds it.
 *
 * A stale file is renamed aside before it is removed, and only removed if what was
 * renamed is still the stale file just read. Deleting by name instead lets two
 * reclaimers race: the second deletes the first one's brand-new lock and both
 * believe they hold it.
 */
export async function acquireFileLock(file, { note = '', onReclaim = async () => {} } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fs.open(file, 'wx')
      await fh.write(`${note ? `${process.pid} ${note}` : String(process.pid)}\nstarted=${Date.now()} heartbeat=${HEARTBEAT_S}\n`)
      await fh.close()
      startHeartbeat(file)
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const held = await readLock(file)
      if (held && held.pid === process.pid) { startHeartbeat(file); return true }
      if (!lockIsStale(held)) return false
      const aside = `${file}.stale-${process.pid}-${Date.now().toString(36)}`
      try {
        await fs.rename(file, aside)
      } catch (err) {
        if (err.code === 'ENOENT') continue // someone else cleared it; try to take it
        return false // busy on Windows: try again next pass
      }
      const taken = await fs.readFile(aside, 'utf8').catch(() => '')
      if (held && taken !== held.text) {
        // Another reclaimer got here first and this moved its fresh lock. Put it back.
        await fs.rename(aside, file).catch(() => {})
        return false
      }
      await onReclaim(held?.pid)
      await fs.rm(aside, { force: true })
    }
  }
  return false
}

/** Release only a lock this process holds, never one another process reclaimed since. */
export async function releaseFileLock(file) {
  stopHeartbeat(file)
  const held = await readLock(file)
  if (held && held.pid === process.pid) await fs.rm(file, { force: true })
}
