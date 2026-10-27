'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { assignOutputAction } from '../[sequence]/[block]/actions'

export function Assigner({ project, outputKey, options }: { project: string; outputKey: string; options: { id: string; label: string }[] }) {
  const [block, setBlock] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={block} onChange={(e) => setBlock(e.target.value)} aria-label="Block">
          <option value="">Choose a block…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
        <Button type="button" size="sm" tone="outline" disabled={!block || busy} pending={busy} pendingLabel="Assigning" onClick={() => {
          setError(null)
          start(async () => {
            const r = await assignOutputAction(project, outputKey, block).catch((e: Error) => ({ ok: false, error: e.message }))
            if (!r.ok) setError(r.error ?? 'Could not assign.')
          })
        }}>Assign</Button>
      </div>
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </div>
  )
}
