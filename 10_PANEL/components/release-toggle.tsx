'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Share2 } from 'lucide-react'
import { releaseItem, revokeRelease } from '@/app/[project]/release-actions'
import { useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'
import type { ReleaseKind } from '@/lib/release-match'

/**
 * "Release to client" / "Released (revoke)". Rendered only when login is on and the person may
 * manage releases (the server passes `releaseId` = null or a string; it passes nothing otherwise).
 */
export function ReleaseToggle({
  kind, reference, label, releaseId,
}: {
  kind: ReleaseKind
  reference: string
  label: string
  /** The live release's id, or null when it is not released. */
  releaseId: string | null
}) {
  const project = useProject()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setBusy(true)
    setError(null)
    const r = await (releaseId ? revokeRelease(project.slug, releaseId) : releaseItem(project.slug, kind, reference, label))
      .catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (!r.ok) { setError(r.error ?? 'Could not do that.'); return }
    router.refresh()
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" tone="outline" pending={busy} pendingLabel={releaseId ? 'Revoking' : 'Releasing'} onClick={toggle}>
        <Share2 aria-hidden className="size-3.5" />
        {releaseId ? 'Released ✓ (revoke)' : 'Release to client'}
      </Button>
      {error && <span role="alert" className="text-xs text-bad">{error}</span>}
    </span>
  )
}
