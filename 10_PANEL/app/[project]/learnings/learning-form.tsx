'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { decideLearning, type LearningResult } from '../actions'

/**
 * Approve / Reject for one proposed rule. The rule text and its evidence are
 * drawn on the server and passed in as children; this adds the buttons, which
 * show they are working, and a line saying why, if it did not save.
 */
export function LearningForm({ project, id, children }: { project: string; id: string; children: React.ReactNode }) {
  const [result, action, pending] = useActionState<LearningResult | null, FormData>(decideLearning, null)
  return (
    <form action={action}>
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="id" value={id} />
      {children}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button type="submit" name="status" value="approved" tone="good" size="sm" disabled={pending}>
          Approve
        </Button>
        <Button type="submit" name="status" value="rejected" size="sm" disabled={pending}>
          Reject
        </Button>
        {pending && <span className="text-xs text-muted">Saving…</span>}
        {result && !result.ok && <span role="alert" className="text-[13px] text-bad">{result.error}</span>}
      </div>
    </form>
  )
}
