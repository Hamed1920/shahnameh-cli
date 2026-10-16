import { getAccount } from '@/lib/account'
import { getProject } from '@/lib/projects'

export const dynamic = 'force-dynamic'

/** The Higgsfield account this machine spends from and what it has left. Polled by the sidebar. See lib/account.ts. */
export async function GET(_request: Request, ctx: { params: Promise<{ project: string }> }) {
  const pr = await getProject((await ctx.params).project)
  if (!pr) return new Response('no such project', { status: 404 })
  return Response.json(await getAccount(), { headers: { 'Cache-Control': 'no-store' } })
}
