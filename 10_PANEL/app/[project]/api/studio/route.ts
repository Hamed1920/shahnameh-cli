import { getProject } from '@/lib/projects'
import { getStudioSession } from '@/lib/store'

export const dynamic = 'force-dynamic'

/** Polled by the reference studio while it is open: one session, rebuilt from the files (lib/studio.ts). */
export async function GET(request: Request, ctx: RouteContext<'/[project]/api/studio'>) {
  const pr = await getProject((await ctx.params).project)
  if (!pr) return new Response('no such project', { status: 404 })
  const id = new URL(request.url).searchParams.get('session') ?? ''
  if (!/^ss_[a-z0-9]{4,40}$/.test(id)) return new Response('bad session', { status: 400 })
  return Response.json(await getStudioSession(pr, id), { headers: { 'Cache-Control': 'no-store' } })
}
