'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'
import { CATALOG, modelsFor } from '@/lib/models'
import { refreshModels } from './actions'

/**
 * How many Higgsfield models the pickers offer and when the list was fetched,
 * with a button to fetch it again. The worker does the fetching (it holds the
 * CLI login); the panel only asks.
 */
export function ModelListStatus() {
  const project = useProject()
  const router = useRouter()
  const [asked, setAsked] = useState(false)
  const video = modelsFor('video').length
  const image = modelsFor('image').length
  const at = CATALOG.fetchedAt ? new Date(CATALOG.fetchedAt) : null

  async function refresh() {
    setAsked(true)
    await refreshModels(project.slug).catch(() => setAsked(false))
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
      <span>
        {video} video and {image} image models from Higgsfield
        {at ? `, list fetched ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ', no list fetched yet'}
      </span>
      <Button type="button" size="sm" tone="ghost" onClick={refresh} disabled={asked}>
        <RefreshCw aria-hidden className="size-3" /> {asked ? 'Asked the worker' : 'Refresh'}
      </Button>
    </div>
  )
}
