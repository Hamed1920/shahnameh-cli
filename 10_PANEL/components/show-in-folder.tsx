'use client'

import { useState, useTransition } from 'react'
import { FolderOpen } from 'lucide-react'
import { revealInFolder } from '@/app/[project]/reveal-action'
import { useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'

/** Opens File Explorer with the file selected. */
export function ShowInFolder({ path }: { path: string }) {
  const { slug } = useProject()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        tone="outline"
        pending={pending}
        pendingLabel="Opening"
        onClick={() =>
          start(async () => {
            const r = await revealInFolder(slug, path)
            setError(r.ok ? null : (r.error ?? 'Could not open the folder.'))
          })
        }
      >
        <FolderOpen aria-hidden className="size-3.5" />
        Show in folder
      </Button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  )
}
