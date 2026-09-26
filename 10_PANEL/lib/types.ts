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
  /**
   * Another look of the NEW entity an earlier upload in this same request
   * proposes: its upload id. Only with mode=variant and an empty `entity`, and
   * exactly one level deep -- a grouped upload can never itself be grouped, so
   * a cycle cannot be written down. Allowed on a References batch add and
   * refused everywhere else, so nothing else has to learn about it.
   */
  groupOf?: string
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
  /**
   * A reference-studio try (worker/lib/studio.mjs). Its `target` is empty
   * (the empty string here, null in the file) when it is for a new thing, which is
   * numbered only when a result is picked.
   */
  studio?: { sessionId: string; genId: string; proposal?: { kind: string; name: string; description?: string } }
  /** Runs ahead of batch work: someone is waiting on it in an open dialog. */
  priority?: boolean
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
  /** An episode starts: the worker makes its folder, so it exists before it holds anything. */
  | 'new-episode'
  /** An episode's readable name changes. Its number never does. */
  | 'rename-episode'
  /** Footage put into an episode by hand: filed as a new scene, or a new take of one. */
  | 'add-shot'
  /** A shot leaves its episode for 09_OUTPUT/_archive. Not a delete: it can be put back. */
  | 'archive-shot'
  /** An archived shot goes back to the episode it came from. */
  | 'restore-shot'
  /** An empty episode's folder goes. Its number stays spent for ever. */
  | 'remove-episode'

/** One file being put into an episode by hand (an 'add-shot' op). */
export interface FootageUpload {
  /** u1, u2 ... within this request. */
  id: string
  /** Project-relative, under 09_OUTPUT/_uploads/<op id>/. */
  file: string
  originalName: string
  /**
   * 'next' takes the next free scene of the episode. An SCnnn that the episode
   * already uses files this as another take of it. Nothing else is accepted:
   * scene numbers are allocated, never typed.
   */
  scene: string
}

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

/** A move the worker refused, so the page that asked can say what happened. */
export interface ShotMoveFailure {
  opId: string
  episode: string
  shots: string[]
  reason: string
  ts: string
}

/** Moves asked for and not applied yet, plus recent refusals. Plain objects: this crosses to the client. */
export interface ShotMoveRequests {
  /** Shot id -> the episode it has been asked to move to. */
  pending: Record<string, string>
  failed: ShotMoveFailure[]
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
  /** The default model's own settings (Kling's mode, ...), for rows that use that model. */
  extra?: Record<string, string>
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
      /**
       * Files added on the Prompts page. Rows name them as `upload:<id>`; the
       * worker files them into the index when it validates the batch and swaps
       * each placeholder for the token it was filed as.
       */
      uploads?: ReviewUpload[]
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
  /** Fetch the Higgsfield model list again (worker/lib/models.mjs). */
  | (JobRequestBase & { type: 'models.refresh' })
  // The reference studio (worker/lib/studio.mjs).
  | (JobRequestBase & {
      type: 'studio.price'
      sessionId: string
      genId: string
      /** An existing entity (the pick becomes a new look of it)... */
      target?: { entity: string }
      /** ...or a new thing, numbered only when a result is picked. */
      proposal?: StudioProposal
      model: string
      prompt: string
      /** @-tokens, `studio:<session>/uN` (a file dropped in), `staged:<hfJobId>/Tnn` (an earlier try). */
      refs: string[]
      params: Record<string, string | number | boolean>
      count: number
    })
  | (JobRequestBase & { type: 'studio.approve'; sessionId: string; genId: string; expectedTotal: number | null })
  | (JobRequestBase & {
      type: 'studio.pick'
      sessionId: string
      hfJobId: string
      take: string
      fileAs: { mode: 'variant'; entity: string } | ({ mode: 'new' } & StudioProposal)
      role: string
      descriptor: string
    })
  | (JobRequestBase & { type: 'studio.close'; sessionId: string })

export interface StudioProposal { kind: string; name: string; description?: string }

export type JobRequestType = JobRequest['type']

/** One line of JOB_REQUEST_RESULTS.jsonl. Every line names the batch or request it belongs to. */
export type JobRequestEvent = { batchId?: string | null; reqId?: string; ts: string } & (
  | { event: 'validated'; jobs: { key: string; ok: boolean; reason?: string; target: string; jobId: string }[]; newEntities: { key: string; kind: string; slug: string }[] }
  | { event: 'rejected'; reason: string }
  | { event: 'price'; key: string; credits: number | null; reason?: string | null }
  | { event: 'priced'; total: number; unpriced: number }
  | { event: 'queued'; jobIds: Record<string, string>; assigned: { key: string; proposal: string; id: string; shortId: string }[]; total: number | null; ceilingNote?: string }
  | { event: 'discarded' }
  | { event: 'error'; reason: string; sessionId?: string; genId?: string }
  | { event: 'models'; count: number; usable: number }
  | { event: 'studio.received'; sessionId: string; genId: string }
  | { event: 'studio.priced'; sessionId: string; genId: string; credits: number | null; count: number; total: number | null; reason?: string | null }
  | { event: 'studio.error'; sessionId: string; genId: string; reason: string }
  | { event: 'studio.queued'; sessionId: string; genId: string; jobIds: string[]; total: number | null }
  | { event: 'studio.picked'; sessionId: string; hfJobId: string; take: string; token: string; entity: string }
  | { event: 'studio.closed'; sessionId: string; putAway: number }
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
  /** Why the worker could not price this row, when it could not. */
  priceReason: string | null
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

/**
 * One output of a shot: a take that was generated, filed, or turned down.
 *
 * Every file the shot has ever produced that is still on disk, so its history
 * can be watched rather than read about. A denied take is kept -- nothing is
 * deleted here -- and is part of how the shot got where it is.
 */
export interface ShotOutput {
  /** Project-relative. */
  file: string
  /** T01, T02 ... -- the take, from the filename when it is filed. */
  take: string
  /** What was decided about it, when anything was. */
  verdict: 'accepted' | 'denied' | null
  stage: 'draft' | 'final' | null
  attempt: number
  ts: string
  /** Why it was accepted or denied, as written at the time. */
  notes: string
  /** In the episode's shots folder: this one is the footage, not a record of it. */
  filed: boolean
  isVideo: boolean
}

/** Where one scene of an episode stands, for the Episodes page. */
export interface EpisodeScene {
  /** The shot id as it is now: SHM-EP001-SC004-SH0010. */
  shot: string
  /** SC004. */
  scene: string
  /** The prompt block it came from (P05), when the queue or a sidecar carries one. */
  label: string | null
  /**
   * accepted: a take is filed. review: one is waiting to be decided.
   * generating / queued: the worker has it. denied: every take so far was
   * turned down. planned: a target with nothing generated against it yet.
   */
  state: 'accepted' | 'review' | 'generating' | 'queued' | 'denied' | 'planned'
  /**
   * The pass the shown take came from. An approved 480p `draft` is accepted but
   * not finished -- its 1080p final may still be queued, or have been denied --
   * so it must not read the same as a filed final.
   */
  stage: 'draft' | 'final' | null
  /** The accepted take on disk, project-relative, for a thumbnail. */
  file: string | null
  /** Accepted takes of this shot. */
  takes: number
  /** Credits every generation against this shot has cost, from the ledger. */
  credits: number
  /** The episode it has been asked to move to and the worker has not moved it to yet. */
  movingTo: string | null
  /** Every output this shot has, oldest first. */
  outputs: ShotOutput[]
}

/** One episode, as the Episodes page reads it. */
export interface EpisodeBoard {
  id: string
  title: string
  /** The folder under 07_EPISODES, or null while the episode has none yet. */
  dir: string | null
  scenes: EpisodeScene[]
  counts: {
    scenes: number
    /** Accepted, draft or final. */
    accepted: number
    /** Accepted as a 480p draft only: the final is not filed. */
    drafts: number
    review: number
    working: number
    denied: number
    planned: number
  }
  credits: number
}

/** A shot taken out of an episode, sitting in 09_OUTPUT/_archive until it is put back. */
export interface ArchivedShot {
  archiveId: string
  /** The shot id it had, and will have again: its number was never reissued. */
  shot: string
  episode: string | null
  /** Project-relative, for a thumbnail. */
  file: string | null
  takes: number
  by: string
  ts: string
}

/** One accepted take, as the "add outputs" picker offers it. */
export interface AcceptedTake {
  /** The shot id as it is now. Footage moves as a whole shot, so this is the unit. */
  shot: string
  /** EP001, or null for a design image filed under an entity -- which cannot move. */
  episode: string | null
  scene: string | null
  /** The prompt block (P05) or whatever the shot is called. */
  label: string
  /** Project-relative, for a thumbnail. */
  file: string | null
  /**
   * Filed as footage in an episode, which is the only thing that can move. An
   * approved 480p draft has a file -- in 09_OUTPUT/_drafts -- and is not this.
   */
  filed: boolean
  isVideo: boolean
  /** Accepted takes of this shot. */
  takes: number
  /** Newest accepted decision, so the list can be newest-first. */
  ts: string
  /** The episode the worker has been asked to move it to and has not yet. */
  movingTo: string | null
}
