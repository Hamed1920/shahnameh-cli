/**
 * Which episode, shot and take a project file belongs to, so the client portal
 * can check that something was released before serving it. Pure: no fs.
 *
 * Paths seen in a project (relative, forward slashes):
 *   07_EPISODES/SHM-EP013/shots/SHM-EP013-SC003-SH0010_V01_T02.mp4
 *   07_EPISODES/SHM-EP001-ZAHHAK-ENTRY/...   (episode folder: CODE-EPnnn[-SLUG])
 *   09_OUTPUT/_drafts|_rejected|_staging|_uploads|_discarded|_archive/...
 * A shot file name is <CODE>-EPnnn-SCnnn-SHnnnn_Vnn[_Tnn].ext; the take is the file
 * name without its extension, the shot is SHnnnn, the episode is EPnnn. Shot
 * numbers repeat across scenes (SH0010 is in every scene), so the scene is
 * kept as well.
 * Any `_`-prefixed segment is working space and any `..` is an escape: both null.
 */

export type AssetRef = { episode?: string; scene?: string; shot?: string; take?: string }

export function assetToRef(relPath: string): AssetRef | null {
  const parts = String(relPath).replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.')
  if (parts.length === 0) return null
  if (parts.some((s) => s === '..' || s.startsWith('_'))) return null

  const ref: AssetRef = {}
  const joined = parts.join('/')
  const ep = joined.match(/(?:^|[/-])(EP\d{3})(?=[-/_.]|$)/)
  if (ep) ref.episode = ep[1]
  const sc = joined.match(/(?:^|[/-])(SC\d{3})(?=[-/_.]|$)/)
  if (sc) ref.scene = sc[1]
  const sh = joined.match(/(?:^|[/-])(SH\d{4})(?=[-/_.]|$)/)
  if (sh) ref.shot = sh[1]

  const file = parts[parts.length - 1]
  const dot = file.lastIndexOf('.')
  if (dot > 0) ref.take = file.slice(0, dot)
  return ref
}
