// Block status (PRD 10.1), derived from what exists. Never stored.
export type BlockStatus =
  | 'not_started' | 'in_production' | 'ready_for_review'
  | 'revision_required' | 'director_approved' | 'final_ready';

export const BLOCK_STATUS_LABEL: Record<BlockStatus, string> = {
  not_started: 'Not started',
  in_production: 'In production',
  ready_for_review: 'Ready for review',
  revision_required: 'Revision required',
  director_approved: 'Director approved',
  final_ready: 'Final ready',
};

export type SubmissionState = { status: 'pending' | 'approved' | 'revision_requested' };

export type StatusInput = {
  generations: number;
  // The block's one active submission. Approval belongs to that submission only,
  // so a newer generation (G08 after G07 was approved) does not change it.
  activeSubmission: SubmissionState | null;
  // A final exists for the block.
  final: boolean;
  // ...and it points at an approved submission. Without this the final does not count.
  finalApproved?: boolean;
};

export function blockStatus(i: StatusInput): BlockStatus {
  if (i.final && i.finalApproved) return 'final_ready';
  const s = i.activeSubmission?.status;
  if (s === 'approved') return 'director_approved';
  if (s === 'revision_requested') return 'revision_required';
  if (s === 'pending') return 'ready_for_review';
  return i.generations > 0 ? 'in_production' : 'not_started';
}

export type FeedbackItem = { id: string; resolutionStatus: 'open' | 'in_progress' | 'resolved' };

// open = not yet resolved; unread = not in readIds.
export function feedbackCounts(feedback: FeedbackItem[], readIds: Iterable<string>): { open: number; unread: number } {
  const read = new Set(readIds);
  let open = 0;
  let unread = 0;
  for (const f of feedback) {
    if (f.resolutionStatus !== 'resolved') open++;
    if (!read.has(f.id)) unread++;
  }
  return { open, unread };
}
