'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { presentToDirector } from './actions'

export function PresentButton({ project, entityId, variant }: { project: string; entityId: string; variant: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        pending={pending}
        pendingLabel="Sending"
        onClick={() =>
          start(async () => {
            const r = await presentToDirector(project, entityId, variant)
            setError(r.ok ? null : r.error ?? 'Could not send it.')
            if (r.ok) router.refresh()
          })
        }
      >
        <Send aria-hidden className="size-3.5" /> Present to director
      </Button>
      {error ? <span role="alert" className="text-[12px] text-bad">{error}</span> : null}
    </span>
  )
}
