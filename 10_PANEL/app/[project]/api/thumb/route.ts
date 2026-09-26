import { fileEtag, notModified } from '@/lib/http-cache'
import { getProject } from '@/lib/projects'
import { thumbnail, thumbnailSource } from '@/lib/thumbs'

export const dynamic = 'force-dynamic'

const WIDTHS = [96, 240, 480, 720]

/**
 * A small JPEG of a project image: `/<project>/api/thumb?path=01_CHARACTERS/...&w=96`.
 * Same path gate as the asset route (inside the project, image extensions only); widths are
 * a fixed set so a URL cannot ask for an arbitrary resize.
 */
export async function GET(request: Request, ctx: RouteContext<'/[project]/api/thumb'>) {
  const url = new URL(request.url)
  const rel = url.searchParams.get('path')
  const w = Number(url.searchParams.get('w') ?? 96)
  if (!rel) return new Response('missing path', { status: 400 })
  const pr = await getProject((await ctx.params).project)
  if (!pr) return new Response('no such project', { status: 404 })
  const width = WIDTHS.find((x) => x >= w) ?? WIDTHS[WIDTHS.length - 1]

  const src = await thumbnailSource(pr.root, rel)
  if (!src) return new Response('not found', { status: 404 })
  const etag = fileEtag(src.stat, String(width))
  // Same policy as api/asset: a path can be given a new image, so revalidate, cheaply.
  const headers = {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'private, max-age=60, stale-while-revalidate=86400',
    ETag: etag,
    'Last-Modified': src.stat.mtime.toUTCString(),
  }
  if (notModified(request, etag, src.stat.mtime)) return new Response(null, { status: 304, headers })

  const bytes = await thumbnail(pr.root, rel, width)
  if (!bytes) return new Response('not found', { status: 404 })
  return new Response(new Uint8Array(bytes), { headers })
}
