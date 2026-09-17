import { getProjectVersion } from '@/lib/live'
import { getProject } from '@/lib/projects'

export const dynamic = 'force-dynamic'

/** Polled by <LiveRefresh> every couple of seconds, for the project that tab has open. See lib/live.ts. */
export async function GET(_request: Request, ctx: RouteContext<'/[project]/api/live'>) {
  const pr = await getProject((await ctx.params).project)
  if (!pr) return new Response('no such project', { status: 404 })
  return Response.json(
    { version: await getProjectVersion(pr) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
