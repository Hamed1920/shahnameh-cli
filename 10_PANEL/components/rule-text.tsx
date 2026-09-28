import { RefChip } from '@/components/ref-chip'
import { cn } from '@/lib/cn'
import type { TextSegment } from '@/lib/types'

/**
 * Rule or note text with every @-reference drawn as its picture (RefChip), so
 * it reads as a sentence with the looks in it. Farsi or English: dir="auto".
 */
export function RuleText({ segments, className }: { segments: TextSegment[]; className?: string }) {
  return (
    <p dir="auto" className={cn('whitespace-pre-line', className)}>
      {segments.map((s, i) => ('ref' in s ? <RefChip key={i} r={s.ref} /> : <span key={i}>{s.text}</span>))}
    </p>
  )
}
