import type { Stats } from 'node:fs'

/**
 * Conditional-request helpers for the media routes (api/asset, api/thumb), so
 * a browser that already holds a file gets a 304 instead of the file again.
 */

/** A validator from the file's size and mtime; `extra` distinguishes variants (a thumbnail width). */
export function fileEtag(stat: Pick<Stats, 'size' | 'mtimeMs'>, extra = ''): string {
  return `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}${extra ? '-' + extra : ''}"`
}

/** True when the request's If-None-Match (or, lacking it, If-Modified-Since) says it has this version. */
export function notModified(request: Request, etag: string, mtime: Date): boolean {
  const inm = request.headers.get('if-none-match')
  if (inm) return inm.split(',').some((t) => t.trim() === etag || t.trim() === '*')
  const ims = request.headers.get('if-modified-since')
  if (!ims) return false
  const since = Date.parse(ims)
  // HTTP dates have whole seconds.
  return Number.isFinite(since) && Math.floor(mtime.getTime() / 1000) * 1000 <= since
}
