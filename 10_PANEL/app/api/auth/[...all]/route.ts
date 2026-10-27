// BetterAuth's endpoints. A 404 when login is off; better-auth is loaded only when it is on.
import { authEnabled } from '@/lib/actor-core'

async function handle(req: Request, method: 'GET' | 'POST') {
  if (!authEnabled()) return new Response('Not found', { status: 404 })
  const [{ toNextJsHandler }, { getAuth }] = await Promise.all([import('better-auth/next-js'), import('@/lib/auth/server')])
  return toNextJsHandler(getAuth())[method](req)
}

export const GET = (req: Request) => handle(req, 'GET')
export const POST = (req: Request) => handle(req, 'POST')
