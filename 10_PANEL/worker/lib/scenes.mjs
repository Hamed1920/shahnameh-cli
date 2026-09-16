import fs from 'node:fs/promises'
import path from 'node:path'
import { P, ROOT, readJsonl } from './project.mjs'

/**
 * Scene numbers for NEXT/EPnnn targets, handed out at batch approval.
 *
 * Mirrors lib/scenes.ts on the panel, which only previews. A scene counts as
 * used once any job in QUEUE.jsonl has targeted it (the queue is append-only,
 * so a denied or failed take still holds its number) or a file for it sits
 * under 07_EPISODES. Numbers are never reused.
 */

export const NEXT_SCENE_RX = /^NEXT\/(EP\d{3})$/

export const shotId = (episode, scene) => `SHM-${episode}-SC${String(scene).padStart(3, '0')}-SH0010`

const SCENE_RX = /SHM-(EP\d{3})-SC(\d{3})/

/** Every shot id in use: queued targets plus shot files on disk. */
export async function usedShotIds() {
  const ids = (await readJsonl(P.queue)).map((q) => String(q.target ?? ''))
  const root = path.join(ROOT, '07_EPISODES')
  let eps = []
  try { eps = await fs.readdir(root, { withFileTypes: true }) } catch { /* no episodes yet */ }
  for (const ep of eps.filter((e) => e.isDirectory())) {
    try { ids.push(...(await fs.readdir(path.join(root, ep.name, 'shots')))) } catch { /* no shots folder */ }
  }
  return ids
}

/**
 * Give each NEXT/EPnnn row the next free scene, in row order. Pure.
 * `used` is every shot id already taken, including explicit shots in the same batch.
 * Returns Map(key -> shot id).
 */
export function assignScenes(rows, used) {
  const last = new Map()
  for (const s of used) {
    const m = String(s).match(SCENE_RX)
    if (m) last.set(m[1], Math.max(last.get(m[1]) ?? 0, Number(m[2])))
  }
  const out = new Map()
  for (const r of rows) {
    const m = String(r.targetId ?? '').match(NEXT_SCENE_RX)
    if (!m) continue
    const n = (last.get(m[1]) ?? 0) + 1
    last.set(m[1], n)
    out.set(r.key, shotId(m[1], n))
  }
  return out
}
