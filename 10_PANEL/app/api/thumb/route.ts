import { thumbnail } from '@/lib/thumbs'

export const dynamic = 'force-dynamic'

const WIDTHS = [96, 240, 480]

/**
 * A small JPEG of a project image: `/api/thumb?path=01_CHARACTERS/...&w=96`.
 * Same path gate as /api/asset (inside ROOT, image extensions only); widths are
 * a fixed set so a URL cannot ask for an arbitrary resize.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const rel = url.searchParams.get('path')
  const w = Number(url.searchParams.get('w') ?? 96)
  if (!rel) return new Response('missing path', { status: 400 })
  const width = WIDTHS.find((x) => x >= w) ?? WIDTHS[WIDTHS.length - 1]
  const bytes = await thumbnail(rel, width)
  if (!bytes) return new Response('not found', { status: 404 })
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300' },
  })
}
