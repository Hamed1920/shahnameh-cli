'use client'

import { useActionState, useState } from 'react'
import { Check, PenLine, X } from 'lucide-react'
import { MentionTextarea, type MentionOption } from '@/components/mention-textarea'
import { Button } from '@/components/ui/button'
import { decideLearning, type LearningResult } from '../actions'

/** A mention with no look (@CHR-002) means the canonical one. */
function sameRef(mention: string, o: MentionOption) {
  if (mention === o.token) return true
  return !mention.includes('/') && o.token.startsWith(`${mention}/`) && o.keywords.includes(' canonical')
}

/**
 * Approve / Reject for one proposed rule. The rule is shown with its pictures
 * (drawn on the server, passed in as `rule`); Edit swaps in the wording, where
 * "@" offers every look in the index. An edit is saved with the verdict --
 * nothing is written until Approve or Reject.
 */
export function LearningForm({
  project, id, text, options, head, rule, children,
}: {
  project: string
  id: string
  /** The rule as written, to start an edit from. */
  text: string
  options: MentionOption[]
  head: React.ReactNode
  rule: React.ReactNode
  children: React.ReactNode
}) {
  const [result, action, pending] = useActionState<LearningResult | null, FormData>(decideLearning, null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)

  return (
    <form action={action}>
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="id" value={id} />
      {head}

      <div className="mt-6">
        {editing ? (
          <div className="space-y-2">
            <MentionTextarea
              name="rule"
              rows={3}
              dir="auto"
              value={draft}
              onChange={setDraft}
              options={options}
              sameRef={sameRef}
              missingLabel="is not a look in the index"
              className="text-start text-[15px]"
            />
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(text) }}
              className="focus-ring rounded text-xs text-faint transition-colors duration-150 hover:text-fg"
            >
              Discard the edit
            </button>
          </div>
        ) : (
          <div className="group flex items-start gap-3">
            <div className="min-w-0 flex-1">{rule}</div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="focus-ring mt-1 inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-edge px-2 py-1 text-[11px] text-muted transition-colors duration-150 hover:border-edge-strong hover:text-fg"
            >
              <PenLine aria-hidden className="size-3" /> Edit
            </button>
          </div>
        )}
      </div>

      {children}

      <div className="mt-7 grid grid-cols-2 gap-2 border-t border-edge pt-5">
        <Button type="submit" name="status" value="approved" tone="good" disabled={pending} className="h-11">
          <Check aria-hidden className="size-4" /> {editing && draft.trim() !== text.trim() ? 'Approve as edited' : 'Approve'}
        </Button>
        <Button type="submit" name="status" value="rejected" tone="outline" disabled={pending} className="h-11">
          <X aria-hidden className="size-4" /> Reject
        </Button>
      </div>
      {(pending || (result && !result.ok)) && (
        <p role={result && !result.ok ? 'alert' : undefined} className={result && !result.ok ? 'mt-3 text-[13px] text-bad' : 'mt-3 text-xs text-muted'}>
          {pending ? 'Saving…' : result?.error}
        </p>
      )}
    </form>
  )
}
