import { notFound, redirect } from 'next/navigation'
import { authEnabled } from '@/lib/actor-core'
import { safeNext } from '@/lib/auth/safe-next'
import { Logo } from '@/components/logo'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  if (!authEnabled()) notFound()
  const next = safeNext((await searchParams).next)
  const { sessionActor } = await import('@/lib/auth/session')
  if (await sessionActor()) redirect(next)

  return (
    <main className="scroll-pane flex-1">
      <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-6 py-16">
        <div className="mb-8 flex items-center gap-3">
          <Logo className="size-7 text-fg" title="Film Making for Dummies" />
          <h1 className="font-display text-[24px] leading-none text-fg">Sign in</h1>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  )
}
