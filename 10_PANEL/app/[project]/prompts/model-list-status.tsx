'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'
import { catalog, modelsFor } from '@/lib/models'
import { modelRefreshResult, refreshModels } from './actions'

/**
 * How many Higgsfield models the pickers offer and when the list was fetched,
 * with a button to fetch it again. The worker does the fetching (it holds the
 * CLI login); the panel asks, then shows what the worker answered -- the new
 * count, or why it could not (the CLI not signed in, no workspace selected).
 */
export function ModelListStatus() {
  const project = useProject()
  const router = useRouter()
  const [reqId, setReqId] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const video = modelsFor('video').length
  const image = modelsFor('image').length
  const fetchedAt = catalog().fetchedAt
  const at = fetchedAt ? new Date(fetchedAt) : null

  async function refresh() {
    setNote({ text: 'Asked the worker…', bad: false })
    const r = await refreshModels(project.slug).catch((e: Error) => ({ ok: false as const, error: e.message, reqId: undefined }))
    if (!r.ok || !r.reqId) { setNote({ text: r.error ?? 'Could not ask the worker.', bad: true }); return }
    setReqId(r.reqId)
  }

  // Follow the request until the worker answers: every 2 s, for up to three minutes.
  useEffect(() => {
    if (!reqId) return
    const since = Date.now()
    let t: ReturnType<typeof setTimeout>
    const tick = async () => {
      const r = await modelRefreshResult(project.slug, reqId).catch(() => null)
      if (r?.state === 'done') {
        setNote({ text: `Refreshed: ${r.count} models, ${r.usable} usable from a prompt.`, bad: false })
        setReqId(null)
        router.refresh()
        return
      }
      if (r?.state === 'failed') { setNote({ text: `Not refreshed: ${r.reason}`, bad: true }); setReqId(null); return }
      if (r?.state === 'retrying') setNote({ text: `Still trying: ${r.reason}`, bad: true })
      if (Date.now() - since > 180_000) { setNote({ text: 'No answer from the worker. Is it running? See the Queue page.', bad: true }); setReqId(null); return }
      t = setTimeout(tick, 2000)
    }
    t = setTimeout(tick, 2000)
    return () => clearTimeout(t)
  }, [reqId, project.slug, router])

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
      <span suppressHydrationWarning>
        {video} video and {image} image models from Higgsfield
        {at ? `, list fetched ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ', no list fetched yet'}
      </span>
      <Button type="button" size="sm" tone="ghost" onClick={refresh} disabled={reqId !== null}>
        <RefreshCw aria-hidden className={reqId ? 'size-3 animate-spin' : 'size-3'} /> Refresh
      </Button>
      {note && <span className={note.bad ? 'text-bad' : 'text-muted'} dir="auto">{note.text}</span>}
    </div>
  )
}
