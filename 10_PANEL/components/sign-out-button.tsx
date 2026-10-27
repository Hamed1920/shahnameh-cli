'use client'

import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SignOutButton({ name }: { name: string }) {
  return (
    <Button
      type="button"
      size="sm"
      tone="ghost"
      title={`Signed in as ${name}`}
      onClick={async () => {
        const { authClient } = await import('@/lib/auth/client')
        await authClient.signOut()
        window.location.href = '/login'
      }}
    >
      <LogOut aria-hidden className="size-3.5" /> Sign out
    </Button>
  )
}
