'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { ReferenceStudio, type StudioConfig } from '@/components/reference-studio'
import { Button } from '@/components/ui/button'
import type { CatalogEntity } from '@/lib/types'

export interface OpenStudioSession { sessionId: string; label: string; startedAt: string | null; results: number }

/**
 * "Create a reference": opens the reference studio for a new thing or a new
 * look of an entity (chosen in the dialog), and lists the sessions left open
 * earlier so they can be picked up again.
 */
export function StudioLauncher({ catalog, cfg, sessions }: { catalog: CatalogEntity[]; cfg: StudioConfig; sessions: OpenStudioSession[] }) {
  const router = useRouter()
  const [open, setOpen] = useState<{ sessionId: string | null } | null>(null)
  const close = () => { setOpen(null); router.refresh() }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" tone="accent" size="sm" className="h-9 px-3.5" onClick={() => setOpen({ sessionId: null })}>
        <Sparkles aria-hidden className="size-3.5" /> Create a reference
      </Button>
      {sessions.length > 0 && <span className="ml-2 text-xs text-faint">Open in the studio:</span>}
      {sessions.map((s) => (
        <button
          key={s.sessionId}
          type="button"
          onClick={() => setOpen({ sessionId: s.sessionId })}
          className="focus-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-edge-strong px-2.5 text-[12px] text-muted transition-colors hover:border-muted hover:text-fg"
        >
          {s.label}
          {s.results > 0 && <span className="font-mono text-[10.5px] text-faint">{s.results} to pick</span>}
        </button>
      ))}
      {open && (
        <ReferenceStudio
          key={open.sessionId ?? 'new'}
          open
          onClose={close}
          catalog={catalog}
          cfg={cfg}
          sessionId={open.sessionId}
        />
      )}
    </div>
  )
}
