import { Badge } from '@/components/ui/text'
import type { Filing, ReviewDecision } from '@/lib/types'

/**
 * The parts of a decision beyond the verdict: the English version of the note,
 * how the reference list changed, and what each upload was filed as.
 */
export function DecisionDetails({
  decision: d,
  filings,
  failed,
}: {
  decision: ReviewDecision
  filings: Filing[]
  failed?: string
}) {
  const mine = filings.filter((f) => f.decisionId === d.id)
  const before = d.refsBefore ?? []
  const after = d.refs ?? []
  const removed = before.filter((t) => !after.includes(t))
  const added = after.filter((t) => !before.includes(t))

  return (
    <div className="mt-3 space-y-2.5 text-xs">
      {d.notesEn && (
        <p className="leading-relaxed text-muted" dir="auto">
          <span className="eyebrow mr-1.5 text-faint">en</span> {d.notesEn}
        </p>
      )}

      {d.refs && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="eyebrow mr-1 text-faint">refs</span>
          {removed.map((t) => (
            <Badge key={`-${t}`} tone="bad" className="font-mono line-through">
              {t}
            </Badge>
          ))}
          {added.map((t) => {
            const up = t.startsWith('upload:')
              ? mine.find((f) => f.uploadId === t.slice(7) && f.ok)
              : null
            return (
              <Badge key={`+${t}`} tone="good" className="font-mono">
                + {up?.token ?? t}
              </Badge>
            )
          })}
          {removed.length === 0 && added.length === 0 && (
            <span className="text-muted">reordered</span>
          )}
        </div>
      )}

      {(d.uploads ?? []).map((u) => {
        const f = mine.find((x) => x.uploadId === u.id)
        return (
          <div key={u.id} className="flex flex-wrap items-center gap-2">
            <span className="eyebrow text-faint">upload</span>
            <span className="text-muted">{u.originalName}</span>
            {f?.ok ? (
              <>
                <Badge tone="good" className="font-mono">
                  {f.token}
                </Badge>
                <span className="font-mono text-[10.5px] break-all text-faint">{f.filename}</span>
              </>
            ) : failed ? (
              <Badge tone="bad">not filed</Badge>
            ) : (
              <Badge tone="muted">waiting for the worker</Badge>
            )}
          </div>
        )
      })}

      {failed && (
        <p className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 leading-relaxed text-bad">
          Could not be applied, returned to review: {failed}
        </p>
      )}
    </div>
  )
}
