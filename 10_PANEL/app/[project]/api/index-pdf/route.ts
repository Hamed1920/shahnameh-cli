import { buildIndexPack, type PackPart } from '@/lib/index-pack'
import { getProject } from '@/lib/projects'

export const dynamic = 'force-dynamic'

/**
 * `/<project>/api/index-pdf?part=full` (guide, scenes, index) or `?part=index` (the index alone), as a download.
 * `&inline=1` shows it in the browser's PDF viewer instead.
 *
 * `&format=json` returns `{ name, data }` with the PDF base64-encoded. The panel's button uses
 * that: a download manager (Internet Download Manager, on Hamed's machine) grabs any response
 * that looks like a PDF, cancels the browser's request -- the page sees an empty 204 -- and
 * saves its own copy under the URL's name (`index-pdf.txt`). It leaves JSON alone.
 */
export async function GET(request: Request, ctx: RouteContext<'/[project]/api/index-pdf'>) {
  const params = new URL(request.url).searchParams
  const part: PackPart = params.get('part') === 'index' ? 'index' : 'full'
  const disposition = params.get('inline') === '1' ? 'inline' : 'attachment'
  const pr = await getProject((await ctx.params).project)
  if (!pr) return new Response('no such project', { status: 404 })
  try {
    const bytes = await buildIndexPack(pr, part)
    const date = new Date().toISOString().slice(0, 10)
    // The project's own name, so two packs in one downloads folder are told apart.
    const stem = pr.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || pr.code
    const name = part === 'full' ? `${stem}-Reference-Pack-${date}.pdf` : `${stem}-Index-${date}.pdf`
    if (params.get('format') === 'json') {
      return Response.json({ name, data: Buffer.from(bytes).toString('base64') }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return new Response(`Could not build the PDF: ${(e as Error).message}`, { status: 500 })
  }
}
