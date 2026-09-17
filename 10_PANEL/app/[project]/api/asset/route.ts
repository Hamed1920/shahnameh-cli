import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { safeResolve } from '@/lib/paths'
import { getProject } from '@/lib/projects'

export const dynamic = 'force-dynamic'

/**
 * Streams project files (assets live outside `public/`).
 *
 * Two independent gates, because this is the one route that reads arbitrary
 * disk paths: the path must resolve inside the project's own root, and the extension must be
 * on the media allowlist. Either alone would be enough; both means a mistake
 * in one is not a disclosure.
 *
 * Byte ranges are honoured. A browser will not let a <video> seek unless the
 * server answers `Range` with 206, so without this the scrub bar is dead.
 */
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}

/** `bytes=start-end`, `bytes=start-` or `bytes=-suffix`, clamped to the file. Null when unsatisfiable. */
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
  return Readable.toWeb(createReadStream(abs, opts)) as ReadableStream<Uint8Array>
}

export async function GET(request: Request, ctx: RouteContext<'/[project]/api/asset'>) {
  const rel = new URL(request.url).searchParams.get('path')
  if (!rel) return new Response('missing path', { status: 400 })

  const pr = await getProject((await ctx.params).project)
  if (!pr) return new Response('no such project', { status: 404 })

  const abs = safeResolve(pr.root, rel)
  if (!abs) return new Response('forbidden', { status: 403 })

  const type = TYPES[path.extname(abs).toLowerCase()]
  if (!type) return new Response('unsupported type', { status: 403 })

  let stat
  try {
    stat = await fs.stat(abs)
  } catch {
    return new Response('not found', { status: 404 })
  }
  if (!stat.isFile()) return new Response('not found', { status: 404 })

  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    // Files are immutable once written; the URL changes when the file does.
    'Cache-Control': 'private, max-age=60',
  }

  const rangeHeader = request.headers.get('range')
  if (rangeHeader) {
    const range = parseRange(rangeHeader.trim(), stat.size)
    if (!range) {
      return new Response('range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
    }
    return new Response(stream(abs, range), {
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
      },
    })
  }

  return new Response(stream(abs), { headers: { ...headers, 'Content-Length': String(stat.size) } })
}
