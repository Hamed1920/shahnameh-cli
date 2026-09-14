import { getProjectVersion } from '@/lib/live'

export const dynamic = 'force-dynamic'

/** Polled by <LiveRefresh> every couple of seconds. See lib/live.ts. */
export async function GET() {
  return Response.json(
    { version: await getProjectVersion() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
