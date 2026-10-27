import { BadgeCheck, Check, CircleDashed, Eye, Hammer, RotateCcw, type LucideIcon } from 'lucide-react'
import { BLOCK_STATUS_LABEL, type BlockStatus } from '@/lib/pd/status'
import { cn } from '@/lib/cn'

const ICON: Record<BlockStatus, LucideIcon> = {
  not_started: CircleDashed,
  in_production: Hammer,
  ready_for_review: Eye,
  revision_required: RotateCcw,
  director_approved: Check,
  final_ready: BadgeCheck,
}

const TONE: Record<BlockStatus, string> = {
  not_started: 'text-faint',
  in_production: 'text-muted',
  ready_for_review: 'text-fg',
  revision_required: 'text-bad',
  director_approved: 'text-good',
  final_ready: 'text-good',
}

/** A status as icon and words together, never colour alone. */
export function StatusLabel({ status }: { status: BlockStatus }) {
  const Icon = ICON[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap', TONE[status])}>
      <Icon aria-hidden strokeWidth={1.75} className="size-4 shrink-0" />
      {BLOCK_STATUS_LABEL[status]}
    </span>
  )
}
