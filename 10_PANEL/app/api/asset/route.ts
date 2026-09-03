import fs from 'node:fs/promises'
import path from 'node:path'
import { safeResolve } from '@/lib/paths'

export const dynamic = 'force-dynamic'

/**
 * Streams project files (assets live outside `public/`).
 *
 * Two independent gates, because this is the one route that reads arbitrary
 * disk paths: the path must resolve inside ROOT, and the extension must be
 * on the media allowlist. Either alone would be enough; both means a mistake
 * in one is not a disclosure.
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

export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get('path')
  if (!rel) return new Response('missing path', { status: 400 })

  const abs = safeResolve(rel)
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

  const data = await fs.readFile(abs)
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      // Files are immutable once written; the URL changes when the file does.
      'Cache-Control': 'private, max-age=60',
    },
  })
}
