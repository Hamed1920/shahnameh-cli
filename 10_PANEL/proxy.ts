import { NextResponse, type NextRequest } from 'next/server'

/**
 * Login off: pass everything through. Login on: a fast, cookie-only redirect for people who are
 * not signed in. It checks nothing in the database; the real check is in every action and route
 * (lib/actor.ts), because Server Actions are POSTs this does not reliably cover.
 */
export async function proxy(req: NextRequest) {
  if (process.env.SHM_AUTH !== 'on') return NextResponse.next()
  const { pathname, search } = req.nextUrl
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) return NextResponse.next()
  // Loaded only here, so a panel with login off never loads better-auth.
  const { getSessionCookie } = await import('better-auth/cookies')
  if (getSessionCookie(req)) return NextResponse.next()
  if (pathname.includes('/api/')) {
    return NextResponse.json({ error: 'sign in' }, { status: 401 })
  }
  const to = new URL('/login', req.url)
  to.searchParams.set('next', pathname + search)
  return NextResponse.redirect(to)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\.ico|icon\.svg|.*\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)'],
}
