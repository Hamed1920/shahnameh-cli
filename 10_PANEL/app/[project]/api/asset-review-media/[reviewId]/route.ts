import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { Readable } from 'node:stream'
import { and, eq } from 'drizzle-orm'
import { authEnabled } from '@/lib/actor-core'
import { gateRoute } from '@/lib/actor'
import { fileEtag, notModified } from '@/lib/http-cache'
import { getProject } from '@/lib/projects'

export const dynamic = 'force-dynamic'

/**
 * The picture of one asset version that was sent to the director. The director (and the owner)
 * never get a file path: the id in the URL is a review row, and the file is resolved here from the
 * registry. The row must belong to this project, the file must resolve inside the project root and
 * be an image. Production may preview too. Anything else is refused the same way, so the route does
 * not say which ids exist.
 */
export async function GET(request: Request, ctx: RouteContext<'/[project]/api/asset-review-media/[reviewId]'>) {
  const { project: slug, reviewId } = await ctx.params
  if (!authEnabled()) return new Response('forbidden', { status: 403 })

  let gr = await gateRoute(slug, 'asset.review')
  if (!gr.ok) gr = await gateRoute(slug, 'asset.present')
  if (!gr.ok) return gr.response

  const refused = new Response('forbidden', { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(reviewId)) return refused
  const pr = await getProject(slug)
  if (!pr) return refused

  const [{ getDb }, { assetReview }, { resolveReviewFile }] = await Promise.all([
    import('@/lib/db/client'),
    import('@/lib/db/schema'),
    import('@/lib/pd-library'),
  ])
  const [row] = await getDb().select().from(assetReview)
    .where(and(eq(assetReview.id, reviewId), eq(assetReview.projectSlug, slug)))
  if (!row || !row.variant) return refused

  const file = await resolveReviewFile(pr, row.entityId, row.variant)
  if (!file) return new Response('not found', { status: 404 })
  let stat
  try {
    stat = await fs.stat(file.abs)
  } catch {
    return new Response('not found', { status: 404 })
  }
  if (!stat.isFile()) return new Response('not found', { status: 404 })

  const etag = fileEtag(stat)
  const headers = {
    'Content-Type': file.type,
    // Private and short: a new take can replace the file under the same version.
    'Cache-Control': 'private, max-age=60',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  }
  if (notModified(request, etag, stat.mtime)) return new Response(null, { status: 304, headers })

  const stream = createReadStream(file.abs)
  stream.on('error', () => {})
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: { ...headers, 'Content-Length': String(stat.size) },
  })
}
