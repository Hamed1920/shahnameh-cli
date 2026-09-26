'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, X } from 'lucide-react'
import { studioClose } from '@/app/[project]/studio/actions'
import { useProject } from '@/components/project-context'
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
  const project = useProject()
  const [open, setOpen] = useState<{ sessionId: string | null } | null>(null)
  const close = () => { setOpen(null); router.refresh() }
  // Ended here: hidden at once, before the page refresh confirms it.
  const [ended, setEnded] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const visible = sessions.filter((s) => !ended.has(s.sessionId))
  async function end(sessionId: string) {
    setEnded((s) => new Set(s).add(sessionId))
    const r = await studioClose(project.slug, sessionId).catch((e: Error) => ({ ok: false, error: e.message }))
    if (!r.ok) {
      setEnded((s) => { const n = new Set(s); n.delete(sessionId); return n })
      setError(r.error ?? 'Could not end that session.')
    }
    router.refresh()
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" tone="accent" size="sm" className="h-9 px-3.5" onClick={() => setOpen({ sessionId: null })}>
        <Sparkles aria-hidden className="size-3.5" /> Create a reference
      </Button>
      {visible.length > 0 && <span className="ml-2 text-xs text-faint">Open in the studio:</span>}
      {visible.map((s) => (
        <span key={s.sessionId} className="inline-flex h-7 items-center rounded-md border border-edge-strong text-[12px] text-muted transition-colors hover:border-muted">
          <button
            type="button"
            onClick={() => setOpen({ sessionId: s.sessionId })}
            className="focus-ring inline-flex h-full cursor-pointer items-center gap-1.5 rounded-l-md pl-2.5 pr-1.5 hover:text-fg"
          >
            {s.label}
            {s.results > 0 && <span className="font-mono text-[10.5px] text-faint">{s.results} to pick</span>}
          </button>
          <button
            type="button"
            aria-label={`End the studio session for ${s.label}`}
            title={s.results > 0 ? 'End this session: the results you did not pick are set aside' : 'End this session'}
            onClick={() => end(s.sessionId)}
            className="focus-ring grid h-full cursor-pointer place-items-center rounded-r-md px-1.5 text-faint hover:text-fg"
          >
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
      {error && <span className="text-xs text-bad">{error}</span>}
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
