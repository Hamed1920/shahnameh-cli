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
  /** Audio for the job this decision queues (revision or final). Absent when nothing is queued. */
  sound?: boolean
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
  /** The Review decision that carried the upload. Absent on a Regenerate upload. */
  decisionId?: string
  /** The Regenerate request (JOB_REQUESTS.jsonl) that carried the upload. */
  requestId?: string
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
  /** Why a token no longer resolves (a look archived, a file gone), when that is known. */
  stale?: string
  /** A token for the same entity that does resolve today, offered as a one-click fix. */
  suggest?: { token: string; path: string }
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
/** Something that will still read a look's file. */
export interface LookUse {
  /** "P12", or the job id when a job has no shot label. */
  label: string
  /** generating / queued: the worker refuses to archive or move the look until it is done.
   *  review: a video waiting for review; archiving or moving retargets its references. */
  state: 'generating' | 'queued' | 'review'
}

export interface LibraryLook {
  variant: string
  usedBy: LookUse[]
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
  /** Footage moves to another episode: the shot keeps its takes, gets the next free scene there. */
  | 'move-shot'

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

/** One shot that changed episode, as the worker recorded it. */
export interface ShotMove {
  opId: string
  from: string
  to: string
  files: { from: string; to: string }[]
  ts: string
}

/**
 * Where footage went, folded. Plain objects: this crosses to the client.
 * A shot moved twice is followed all the way, so the oldest id still resolves.
 */
export interface ShotMoves {
  /** Old shot id -> the id it has now. */
  shot: Record<string, string>
  /** Old project-relative file -> where that file is now. */
  file: Record<string, string>
  /** Old shot id -> the folder its takes are in now. */
  folder: Record<string, string>
}

export interface WorkerStatus {
  running: boolean
  /** Why the panel will not start the worker on this machine, or null when it keeps it running. */
  autostartOff?: string | null
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

// ---------------------------------------------------------------- Prompts page / job requests

/** Batch-wide settings the Prompts page applies to every row that has no override. */
export interface BatchDefaults {
  model: string
  aspect_ratio: string
  duration: number
  stage: 'draft' | 'final'
  generate_audio: boolean
}

/** One row of a submitted batch, as the worker validates it. `target` may be `NEW/KIND/SLUG`. */
export interface BatchJobInput {
  key: string
  label: string | null
  target: string
  newEntity?: { kind: string; slug: string; name?: string; description?: string }
  variant: string | null
  model: string | null
  stage?: 'draft' | 'final' | null
  refs: string[]
  params: Record<string, string | number | boolean>
  /** Verbatim. Never reworded by the panel or the worker. */
  prompt: string
}

interface JobRequestBase {
  id: string
  ts: string
  reviewer: string
}

export type JobRequest =
  | (JobRequestBase & {
      type: 'batch.submit'
      batchId: string
      name: string
      /** `library`: started again from the prompt library; `files` holds the job it was copied from. */
      source: { kind: 'paste' | 'files' | 'library'; files: string[] }
      defaults: BatchDefaults
      jobs: BatchJobInput[]
    })
  | (JobRequestBase & { type: 'batch.approve'; batchId: string; expectedTotal: number | null })
  | (JobRequestBase & { type: 'batch.discard'; batchId: string })
  | (JobRequestBase & {
      type: 'regenerate'
      jobId: string
      decisionId: string
      note?: string
      sound?: boolean
      /** Overrides. Anything absent is kept from the accepted job. */
      prompt?: string
      /** `upload:<id>` entries are placeholders the worker swaps for the filed upload's token. */
      refs?: string[]
      model?: string
      stage?: 'draft' | 'final'
      variant?: string
      params?: Record<string, string | number | boolean>
      /** Images added in the dialog. The worker files them before it queues anything. */
      uploads?: ReviewUpload[]
    })

export type JobRequestType = JobRequest['type']

/** One line of JOB_REQUEST_RESULTS.jsonl. Every line names the batch or request it belongs to. */
export type JobRequestEvent = { batchId?: string | null; reqId?: string; ts: string } & (
  | { event: 'validated'; jobs: { key: string; ok: boolean; reason?: string; target: string; jobId: string }[]; newEntities: { key: string; kind: string; slug: string }[] }
  | { event: 'rejected'; reason: string }
  | { event: 'price'; key: string; credits: number | null }
  | { event: 'priced'; total: number; unpriced: number }
  | { event: 'queued'; jobIds: Record<string, string>; assigned: { key: string; proposal: string; id: string; shortId: string }[]; total: number | null; ceilingNote?: string }
  | { event: 'discarded' }
  | { event: 'error'; reason: string }
)

export type BatchStatus = 'received' | 'validated' | 'pricing' | 'priced' | 'approving' | 'queued' | 'discarded' | 'rejected'

export interface BatchJobView {
  key: string
  label: string | null
  target: string
  assignedId: string | null
  jobId: string | null
  model: string
  stage: 'draft' | 'final' | null
  ok: boolean
  reason: string | null
  credits: number | null
  prompt: string
}

/** A submitted batch as the Prompts page shows it, folded from requests and events. */
export interface BatchView {
  batchId: string
  name: string
  submittedAt: string
  status: BatchStatus
  jobs: BatchJobView[]
  total: number | null
  unpriced: number
  /** The last error or refusal, if any. */
  message: string | null
  ceilingNote: string | null
  newEntities: { key: string; kind: string; slug: string; assigned: string | null }[]
  /** Request ids the worker has not processed yet. */
  pending: string[]
}

/** The accepted job as the Regenerate dialog starts from it. */
export interface RegenerateSource {
  prompt: string
  /**
   * The references to start from: what the take was made with, plus whatever
   * the accept decision changed (which only its follow-up final received).
   * Each is resolved against the index as it is now.
   */
  refs: ResolvedReference[]
  model: string
  stage: 'draft' | 'final' | null
  variant: string
  params: Record<string, string | number | boolean>
  revisionNotes: string[]
  /** The job that made the take. */
  jobId: string
  attempt: number
  /** The full prompt the take was actually sent with: notes and learnings included. */
  sentPrompt: string
}

/** One prompt in the Prompts page library: a job and every attempt queued after it, shown as its latest attempt. */
export interface PromptLibraryItem {
  /** The first job in the chain. */
  rootJobId: string
  /** The latest attempt, which the Generate dialog starts from. */
  jobId: string
  label: string | null
  target: string
  attempts: number
  enqueuedAt: string
  prompt: string
  refs: string[]
  model: string
  stage: 'draft' | 'final' | null
  variant: string
  params: Record<string, string | number | boolean>
  /** Notes the latest attempt carried. A fresh run does not inherit them. */
  revisionNotes: string[]
  state: 'queued' | 'generating' | 'failed' | 'to-review' | 'accepted' | 'denied'
}

/** A Regenerate request and what became of it, for the Decided page. */
export interface RegenerationView {
  reqId: string
  ts: string
  note: string
  sound: boolean | null
  state: 'waiting' | 'queued' | 'rejected'
  jobId: string | null
  reason: string | null
}
