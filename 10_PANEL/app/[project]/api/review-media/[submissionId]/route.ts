import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { authEnabled } from '@/lib/actor-core'
import { gateRoute } from '@/lib/actor'
import { fileEtag, notModified } from '@/lib/http-cache'
import { safeResolve } from '@/lib/paths'
import { getProject } from '@/lib/projects'

export const dynamic = 'force-dynamic'

/**
 * The video of one submission (one round of one block) that was sent to the director. The id in the
 * URL is a review_submission row; the file is looked up here, server side, from that row's
 * generation, and its bytes must still match the hash taken when it was sent. So a reviewer can
 * only ever fetch what exists as a submission of this project, never an arbitrary generation or
 * path (PRD 14.2). Anything else, including an id that does not exist, is the same 403.
 * Byte ranges are honoured so the scrub bar works.
 */
const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = header.match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start: number
  let end: number
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (suffix === 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start > end || start >= size) return null
  return { start, end }
}

function stream(abs: string, opts?: { start: number; end: number }) {
  const file = createReadStream(abs, opts)
  file.on('error', () => {})
  return Readable.toWeb(file) as ReadableStream<Uint8Array>
}

export async function GET(request: Request, ctx: RouteContext<'/[project]/api/review-media/[submissionId]'>) {
  const { project: slug, submissionId } = await ctx.params
  if (!authEnabled()) return new Response('forbidden', { status: 403 })

  let gr = await gateRoute(slug, 'review.view')
  if (!gr.ok) gr = await gateRoute(slug, 'block.write')
  if (!gr.ok) return gr.response

  const refused = new Response('forbidden', { status: 403 })
  const pr = await getProject(slug)
  if (!pr) return refused
  const review = await import('@/lib/pd-review')
  const row = await review.submissionForMedia(slug, submissionId)
  if (!row) return refused

  const { resolveGenerationFile } = await import('@/lib/pd-generations')
  const rel = await resolveGenerationFile(pr, row.g)
  if (!rel) return new Response('not found', { status: 404 })
  const abs = safeResolve(pr.root, rel)
  if (!abs) return refused
  const type = TYPES[path.extname(abs).toLowerCase()]
  if (!type) return refused

  let stat
  try {
    stat = await fs.stat(abs)
  } catch {
    return new Response('not found', { status: 404 })
  }
  if (!stat.isFile()) return new Response('not found', { status: 404 })

  // The file must be what was sent. A moved file has the same bytes; a replaced one does not.
  let sha: string
  try { sha = await review.fileSha256(abs) } catch { return new Response('not found', { status: 404 }) }
  const { fileMatches } = await import('@/lib/pd/review-rules')
  if (!fileMatches(row.s.fileSha256, sha)) return new Response('this file changed after it was sent', { status: 409 })

  const etag = fileEtag(stat)
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=60',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  }
  if (notModified(request, etag, stat.mtime)) return new Response(null, { status: 304, headers })

  const ifRange = request.headers.get('if-range')
  const rangeHeader = ifRange && ifRange !== etag ? null : request.headers.get('range')
  if (rangeHeader) {
    const range = parseRange(rangeHeader.trim(), stat.size)
    if (!range) return new Response('range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
    return new Response(stream(abs, range), {
      status: 206,
      headers: { ...headers, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` },
    })
  }
  return new Response(stream(abs), { headers: { ...headers, 'Content-Length': String(stat.size) } })
}
