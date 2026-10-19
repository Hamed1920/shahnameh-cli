/**
 * Finding a filed take after its episode folder was renamed.
 *
 * The worker log records where it filed a take, e.g.
 * `07_EPISODES/SHM-EP014-JAMSHID-GIRLS/shots/<file>`. The readable suffix of an
 * episode folder can change afterwards and nothing records it, so the logged path
 * goes stale. The worker itself matches an episode folder by its `CODE-EPnnn`
 * prefix (`shotFolder` in worker/lib/project.mjs); this does the same, on
 * directory listings passed in (no file access here).
 */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The live directory for an episode: `SHM-EP014` exactly or `SHM-EP014-...`, never `SHM-EP0140`. */
export function episodeDirFor(code: string, episodeId: string, dirNames: string[]): string | null {
  const ep = episodeId.startsWith(`${code}-`) ? episodeId : `${code}-${episodeId}`
  const found = dirNames.filter((n) => n === ep || n.startsWith(`${ep}-`)).sort()[0]
  return found ?? null
}

/**
 * A project-relative `07_EPISODES/<dir>/shots/<name>` whose dir is gone, moved under the
 * live dir for the same episode. Null when the path is not of that shape, its dir is
 * live already, or no live dir matches.
 */
export function rebaseFiledPath(relPath: string, dirNames: string[], code: string): string | null {
  const parts = relPath.split(/[\\/]+/).filter(Boolean)
  if (parts.length < 3 || parts[0] !== '07_EPISODES') return null
  const [, dir, ...rest] = parts
  if (dirNames.includes(dir)) return null
  const rx = new RegExp(`^${esc(code)}-EP[0-9]+`)
  const ep = dir.match(rx)?.[0] ?? parts[parts.length - 1].match(rx)?.[0]
  if (!ep) return null
  const live = episodeDirFor(code, ep, dirNames)
  if (!live || live === dir) return null
  return ['07_EPISODES', live, ...rest].join('/')
}

/** `CODE-...-SH0010_V01.mp4` is take 1, `_T02` take 2, and so on. */
export function takeNumber(name: string, stem: string): number {
  const m = name.slice(stem.length).match(/^_T(\d+)/)
  return m ? parseInt(m[1], 10) : 1
}
