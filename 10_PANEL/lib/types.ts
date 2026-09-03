export type Verdict = 'accepted' | 'denied'

export interface Entity {
  id: string
  short_id: string
  kind: string
  number: string
  slug: string
  name: string
  family: string
  status: string
  canonical_variant: string
  variant_count: string
  folder: string
  related: string
  flags: string
  description: string
}

export interface AssetRow {
  filename: string
  entity_id: string
  variant: string
  take: string
  role: string
  status: string
  folder: string
  source: string
  original_filename: string
  added: string
  notes: string
}

/** Written by the worker beside each downloaded batch: _staging/<hfJobId>/job.json */
export interface StagingSidecar {
  jobId: string
  parentJobId: string | null
  hfJobId: string
  attempt: number
  /** draft = cheap preview; approving it queues the final. null for stills. */
  stage: 'draft' | 'final' | null
  label: string | null
  target: string
  variant: string
  model: string
  prompt: string
  params: Record<string, string>
  refs: string[]
  createdAt: string
  costCredits: number | null
  candidates: { file: string; take: string; resultUrl: string }[]
}

export interface Candidate {
  hfJobId: string
  take: string
  /** project-relative, forward-slashed */
  path: string
  resultUrl: string
  sidecar: StagingSidecar
  decided: ReviewDecision | null
}

export interface ReviewDecision {
  id: string
  ts: string
  reviewer: string
  candidate: string
  jobId: string
  hfJobId: string
  target: string
  variant: string
  take: string
  verdict: Verdict
  /** Why it failed, or — for accepts — why it worked. Both feed the learning corpus. */
  notes: string
  tags: string[]
  model: string
  requeue: boolean
  promotedTo?: string
}

export type LearningStatus = 'proposed' | 'approved' | 'rejected'

export interface Learning {
  id: string
  scope: { kind: string | null; entity: string | null; family: string | null }
  rule: string
  evidence: string[]
  status: LearningStatus
  created: string
  decidedBy?: string
  decidedAt?: string
}

export interface QueueItem {
  jobId: string
  parentJobId: string | null
  attempt: number
  target: string
  variant: string
  model: string
  prompt: string
  params: Record<string, string>
  refs: string[]
  enqueuedAt: string
  enqueuedBy: string
}
