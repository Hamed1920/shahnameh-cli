import { getProjectVersion } from '@/lib/live'
import { getProject } from '@/lib/projects'
import { gateRoute } from '@/lib/actor'

export const dynamic = 'force-dynamic'

/** Polled by <LiveRefresh> every couple of seconds, for the project that tab has open. See lib/live.ts. */
export async function GET(_request: Request, ctx: RouteContext<'/[project]/api/live'>) {
  const slug = (await ctx.params).project
  const gr = await gateRoute(slug, 'view.prompts')
  if (!gr.ok) return gr.response
  const pr = await getProject(slug)
  if (!pr) return new Response('no such project', { status: 404 })
  return Response.json(
    { version: await getProjectVersion(pr) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
