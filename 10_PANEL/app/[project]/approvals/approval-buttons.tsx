'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { approveRequest, rejectRequest } from './actions'
import { useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'

export function ApprovalButtons({ id }: { id: string }) {
  const project = useProject()
  const router = useRouter()
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(which: 'approve' | 'reject') {
    setBusy(which)
    setError(null)
    const r = await (which === 'approve' ? approveRequest(project.slug, id) : rejectRequest(project.slug, id))
      .catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(null)
    if (!r.ok) setError(r.error ?? 'Could not do that.')
    router.refresh()
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {error && <span role="alert" className="text-xs text-bad">{error}</span>}
      <Button type="button" size="sm" tone="ghost" pending={busy === 'reject'} pendingLabel="Rejecting" disabled={busy !== null} onClick={() => act('reject')}>
        <X aria-hidden className="size-3.5" /> Reject
      </Button>
      <Button type="button" size="sm" tone="accent" pending={busy === 'approve'} pendingLabel="Approving" disabled={busy !== null} onClick={() => act('approve')}>
        <Check aria-hidden className="size-3.5" /> Approve
      </Button>
    </span>
  )
}
