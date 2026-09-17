import { idRx, shotId } from './ids.mjs'

/**
 * Scene numbers for NEXT/EPnnn targets, handed out at batch approval.
 *
 * Mirrors lib/scenes.ts on the panel, which only previews. A scene counts as
 * used once any job in QUEUE.jsonl has targeted it (the queue is append-only,
 * so a denied or failed take still holds its number) or a file for it sits
 * under 07_EPISODES (usedShotIds in project.mjs). Numbers are never reused.
 *
 * Pure: the project code is passed in, so tests need no project on disk.
 */

export const NEXT_SCENE_RX = /^NEXT\/(EP\d{3})$/

/**
 * Give each NEXT/EPnnn row the next free scene, in row order.
 * `used` is every shot id already taken, including explicit shots in the same batch.
 * Returns Map(key -> shot id).
 */
export function assignScenes(rows, used, code) {
  const last = new Map()
  for (const s of used) {
    const m = String(s).match(idRx(code).sceneAnywhere)
    if (m) last.set(m[1], Math.max(last.get(m[1]) ?? 0, Number(m[2])))
  }
  const out = new Map()
  for (const r of rows) {
    const m = String(r.targetId ?? '').match(NEXT_SCENE_RX)
    if (!m) continue
    const n = (last.get(m[1]) ?? 0) + 1
    last.set(m[1], n)
    out.set(r.key, shotId(code, m[1], n))
  }
  return out
}
