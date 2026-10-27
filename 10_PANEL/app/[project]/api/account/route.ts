import { getAccount } from '@/lib/account'
import { getProject } from '@/lib/projects'
import { gateRoute } from '@/lib/actor'

export const dynamic = 'force-dynamic'

/** The Higgsfield account this machine spends from and what it has left. Polled by the sidebar. See lib/account.ts. */
export async function GET(_request: Request, ctx: { params: Promise<{ project: string }> }) {
  const slug = (await ctx.params).project
  const gr = await gateRoute(slug, 'view.costs')
  if (!gr.ok) return gr.response
  const pr = await getProject(slug)
  if (!pr) return new Response('no such project', { status: 404 })
  return Response.json(await getAccount(), { headers: { 'Cache-Control': 'no-store' } })
}
