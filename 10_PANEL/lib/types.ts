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
  /** A previous decision on this candidate the worker could not apply, and why. */
  failedDecision?: { id: string; reason: string } | null
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
  /** English version of the note. When present it is what the model reads. */
  notesEn?: string
  /**
   * The full ordered reference list for the job this decision queues. Absent
   * means unchanged. `upload:<id>` entries are placeholders the worker swaps
   * for the token of the filed upload.
   */
  refs?: string[]
  /** The references the candidate was generated with, kept for the diff. */
  refsBefore?: string[]
  uploads?: ReviewUpload[]
}

export interface ReviewUpload {
  id: string
  /** Project-relative, under 09_OUTPUT/_uploads. */
  file: string
  originalName: string
  /** variant = a new look of an existing entity; new = a new entity. */
  mode: 'variant' | 'new'
  /** Full entity id, for mode=variant. */
  entity?: string
  /** For mode=new. The worker allocates the number. */
  kind?: string
  name?: string
  description?: string
  role: string
  descriptor: string
}

/** One line of FILINGS.jsonl. */
export interface Filing {
  decisionId: string
  uploadId?: string
  ok: boolean
  token?: string
  entity?: string
  filename?: string
  reason?: string
  ts: string
}

/** An entity as the reference picker needs it. */
export interface CatalogEntity {
  id: string
  shortId: string
  kind: string
  slug: string
  name: string
  canonical: string
  variants: { variant: string; path: string }[]
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

/** A prompt reference token paired with the asset it resolved to, if any. */
export interface ResolvedReference {
  /** The token as written in the job, e.g. SHM-CHR-001-ZAHHAK/V02/T01. */
  token: string
  /** Project-relative, forward-slashed. Null when nothing on disk matches. */
  path: string | null
}

/** One earlier attempt at the same shot, for the review history. */
export interface AttemptEntry {
  jobId: string
  attempt: number
  stage: 'draft' | 'final' | null
  verdict: Verdict | null
  notes: string
  tags: string[]
  decidedAt: string | null
  /** Project-relative video, where the worker left it. Null if it cannot be found. */
  video: string | null
  refs: string[]
}

/** Everything the review page shows about a candidate beyond the file itself. */
export interface ReviewContext {
  /** Block label from the source document, e.g. P01. */
  label: string | null
  episode: string | null
  scene: string | null
  shot: string | null
  /** Shot titles from the prompt, e.g. ["Convergence", "The Final Approach"]. */
  beats: string[]
  /** Earlier attempts, oldest first. */
  history: AttemptEntry[]
  /** Credit estimates, null when there is nothing to go on. */
  cost: { regenerate: number | null; final: number | null }
}

export interface ReviewItem {
  candidate: Candidate
  /** The references the job was generated with, resolved. */
  editable: ResolvedReference[]
  /** An entity target's canonical plate when it is not among the refs: compare only. */
  plate: ResolvedReference | null
  context: ReviewContext
}

// ---------------------------------------------------------------- References page

/** One look (variant) of an entity; takes are counted, the highest shown. */
export interface LibraryLook {
  variant: string
  takes: number
  role: string
  status: string
  /** Project-relative file of the highest take. */
  path: string
  filename: string
  source: string
  added: string
}

export interface LibraryEntity {
  id: string
  shortId: string
  kind: string
  number: string
  slug: string
  name: string
  family: string
  status: string
  canonical: string
  description: string
  flags: string[]
  looks: LibraryLook[]
}

export interface ArchivedLook {
  archiveId: string
  shortId: string
  entityId: string
  variant: string
  take: string
  role: string
  /** Project-relative, under 09_OUTPUT/_archive. */
  file: string
  by: string
  ts: string
}

export type IndexOpType =
  | 'add' | 'retire' | 'restore' | 'status' | 'canonical' | 'role' | 'rename' | 'archive' | 'unarchive' | 'move'

export interface IndexOp {
  id: string
  ts: string
  reviewer: string
  type: IndexOpType
  [key: string]: unknown
}

export interface IndexOpResult {
  opId: string
  ok: boolean
  summary?: string
  reason?: string
  ts: string
}

export interface WorkerStatus {
  running: boolean
  /** Running, but started before its code last changed, so newer features are missing. */
  outdated: boolean
  startedAt?: string
}

export interface LibraryData {
  entities: LibraryEntity[]
  archived: ArchivedLook[]
  /** Requested but not yet applied by the worker. */
  pending: IndexOp[]
  /** Most recent outcomes, newest first, joined with their request. */
  results: (IndexOpResult & { type?: IndexOpType })[]
  worker: WorkerStatus
}
