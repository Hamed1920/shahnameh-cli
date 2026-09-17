import { idRx, shotId } from '../worker/lib/ids.mjs'

/**
 * Scenes for the Prompts page. A video prompt is footage, and every EP001
 * block so far has been one scene with one shot (SCnnn-SH0010), so the only
 * real question is which scene. When the document does not say, the row asks
 * for the next free one and the worker numbers it at approval
 * (worker/lib/scenes.mjs), the same way it numbers a new entity: a discarded
 * batch burns nothing and two batches cannot take the same scene.
 *
 * Pure: runs in the browser and in unit tests. The project code (SHM, ...) is
 * passed in, never assumed.
 */

/** The target a row sends when the worker should pick the scene. */
export const NEXT_SCENE_RX = /^NEXT\/(EP\d{3})$/
export const nextSceneTarget = (episode: string) => `NEXT/${episode}`
export const EPISODE_RX = /^EP\d{3}$/

const EP_SC_RX = /(?:^|[^A-Z0-9])EP[\s_-]?(\d{1,3})[\s_-]*SC[\s_-]?(\d{1,3})(?![0-9])/i
const SC_RX = /(?:^|[^A-Z0-9])SC[\s_-]?(\d{3})(?![0-9])/i

const pad = (n: string | number, w: number) => String(n).padStart(w, '0')
export { shotId }

/** Highest scene number used per episode, from shot ids (queued jobs, files on disk). */
function lastScene(shots: string[], episode: string, code: string): number {
  let max = 0
  for (const s of shots) {
    const m = s.match(idRx(code).sceneAtStart)
    if (m && m[1] === episode) max = Math.max(max, Number(m[2]))
  }
  return max
}

/**
 * What each next-free-scene row would become if the batch were approved now, in
 * row order, past every known shot and every explicit shot in the batch. Mirrors
 * assignScenes in worker/lib/scenes.mjs, which decides for real.
 */
export function previewScenes(
  rows: { key: string; auto: boolean; episode: string; shot: string }[],
  knownShots: string[],
  code: string,
): Map<string, string> {
  const used = [...knownShots, ...rows.filter((r) => !r.auto).map((r) => r.shot)]
  const last = new Map<string, number>()
  const out = new Map<string, string>()
  for (const r of rows) {
    if (!r.auto || !EPISODE_RX.test(r.episode)) continue
    const n = (last.get(r.episode) ?? lastScene(used, r.episode, code)) + 1
    last.set(r.episode, n)
    out.set(r.key, shotId(code, r.episode, n))
  }
  return out
}

/** The episode new footage most likely belongs to: the highest one with any shot. */
export function latestEpisode(shots: string[], code: string): string {
  const eps = shots.map((s) => s.match(idRx(code).shotParts)?.[1]).filter((e): e is string => !!e).sort()
  return eps[eps.length - 1] ?? 'EP001'
}

/**
 * A shot the document names. A full id counts anywhere, the prompt included;
 * the looser `EP001 SC013` and `sc013` forms only in a file name or label,
 * where they cannot be a sentence about some other scene.
 */
export function sceneFromDocument(where: { file?: string | null; label?: string | null; prompt?: string | null }, episode: string, code: string): string | null {
  for (const s of [where.label, where.file, where.prompt]) {
    const m = String(s ?? '').match(idRx(code).shotAnywhere)
    if (m) return `${code}-EP${m[1]}-SC${m[2]}-SH${m[3]}`
  }
  for (const s of [where.label, where.file]) {
    const t = String(s ?? '')
    const m = t.match(EP_SC_RX)
    if (m) return shotId(code, `EP${pad(m[1], 3)}`, Number(m[2]))
    const sc = t.match(SC_RX)
    if (sc) return shotId(code, episode, Number(sc[1]))
  }
  return null
}
