// Pure pieces of the generation sync: how queue jobs, staging sidecars and review decisions
// become generation outputs, how a prompt version is matched, and the label a block job carries.
// No fs, no database: lib/pd-generations.ts reads the files and the rows and calls these.
import { nextGNumbers } from './pd/numbering.ts';
import { operationType, type OperationType } from './pd/operation.ts';
import { promptHash } from './pd/prompt-hash.ts';

export interface RawJob {
  jobId: string;
  parentJobId?: string | null;
  retryOf?: string | null;
  attempt?: number | null;
  target?: string | null;
  stage?: string | null;
  model?: string | null;
  params?: Record<string, unknown> | null;
  prompt?: string | null;
  basePrompt?: string | null;
  label?: string | null;
  enqueuedAt?: string | null;
  enqueuedBy?: string | null;
  studio?: unknown;
}

export interface RawSidecar {
  jobId: string;
  parentJobId?: string | null;
  hfJobId: string;
  attempt?: number | null;
  stage?: string | null;
  label?: string | null;
  target?: string | null;
  model?: string | null;
  prompt?: string | null;
  basePrompt?: string | null;
  params?: Record<string, unknown> | null;
  createdAt?: string | null;
  costCredits?: number | null;
  candidates?: { file: string; take: string }[];
  studio?: unknown;
}

export interface RawDecision {
  id?: string;
  ts: string;
  reviewer?: string;
  candidate: string;
  hfJobId: string;
  take?: string;
  verdict: 'accepted' | 'denied' | 'discarded' | string;
}

export type Verdict = 'accepted' | 'denied' | 'discarded';

/** One take of one job: what a generation row is made from. Keyed by (hfJobId, candidate). */
export interface MappedOutput {
  key: string;
  /** The job's target as queued (the internal shot id of a block, or something else). */
  target: string;
  hfJobId: string;
  /** The take: T01, T02 ... */
  candidate: string;
  jobId: string | null;
  parentJobId: string | null;
  stage: string | null;
  model: string | null;
  resolution: string | null;
  durationSeconds: number | null;
  costCredits: number | null;
  operationType: OperationType;
  createdBy: string | null;
  createdAt: string;
  /** Hash of the prompt as written (basePrompt), to find its version. Null when unknown. */
  promptHash: string | null;
  label: string | null;
  /** What the review log says about this take, or null while it is waiting. */
  verdict: Verdict | null;
}

export const outputKey = (hfJobId: string, candidate: string): string => `${hfJobId}|${candidate}`;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

function verdictOf(v: string): Verdict | null {
  return v === 'accepted' || v === 'denied' || v === 'discarded' ? v : null;
}

/**
 * Every output the sidecars describe, joined to the queue job that made it and to the last decision
 * about it. A queued job with no sidecar has made nothing yet and yields nothing. Reference-studio
 * tries are not shots and are skipped. `failed` lists decision ids the worker could not apply: those
 * leave the take waiting, as on the Review page. Oldest first.
 */
export function mapOutputs(
  jobs: RawJob[],
  sidecars: RawSidecar[],
  decisions: RawDecision[],
  failed: ReadonlySet<string> = new Set(),
): MappedOutput[] {
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));
  const sidecarByJob = new Map(sidecars.map((s) => [s.jobId, s]));
  const stageOfJob = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return str(jobById.get(id)?.stage) ?? str(sidecarByJob.get(id)?.stage);
  };

  // The last live decision per candidate file wins, as in the Review page.
  const verdictByCandidate = new Map<string, Verdict | null>();
  for (const d of decisions) {
    if (d.id && failed.has(d.id)) {
      verdictByCandidate.delete(d.candidate);
      continue;
    }
    verdictByCandidate.set(d.candidate, verdictOf(d.verdict));
  }

  const out: MappedOutput[] = [];
  const seen = new Set<string>();
  for (const s of sidecars) {
    if (s.studio) continue;
    const job = jobById.get(s.jobId);
    if (job?.studio) continue;
    const target = str(job?.target) ?? str(s.target);
    if (!target) continue;
    const parentJobId = str(job?.parentJobId) ?? str(s.parentJobId);
    const stage = str(s.stage) ?? str(job?.stage);
    const params = { ...(job?.params ?? {}), ...(s.params ?? {}) };
    const basePrompt = str(job?.basePrompt) ?? str(s.basePrompt);
    for (const c of s.candidates ?? []) {
      const key = outputKey(s.hfJobId, c.take);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        target,
        hfJobId: s.hfJobId,
        candidate: c.take,
        jobId: s.jobId,
        parentJobId,
        stage,
        model: str(s.model) ?? str(job?.model),
        resolution: str(params.resolution),
        durationSeconds: num(params.duration),
        costCredits: num(s.costCredits),
        operationType: operationType({
          parentJobId,
          parentStage: stageOfJob(parentJobId),
          stage,
          attempt: num(job?.attempt) ?? num(s.attempt),
          enqueuedBy: str(job?.enqueuedBy),
          retryOf: str(job?.retryOf),
        }),
        createdBy: str(job?.enqueuedBy),
        createdAt: str(s.createdAt) ?? str(job?.enqueuedAt) ?? '',
        promptHash: basePrompt ? promptHash(basePrompt) : null,
        label: str(job?.label) ?? str(s.label),
        verdict: verdictByCandidate.get(`09_OUTPUT/_staging/${s.hfJobId}/${c.file}`) ?? null,
      });
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/** Group outputs by the block that owns their target. Targets that are no block are returned apart. */
export function splitByBlock(
  outputs: MappedOutput[],
  blockByInternal: ReadonlyMap<string, string>,
  assignedKeys: ReadonlySet<string> = new Set(),
): { byBlock: Map<string, MappedOutput[]>; unassigned: MappedOutput[] } {
  const byBlock = new Map<string, MappedOutput[]>();
  const unassigned: MappedOutput[] = [];
  for (const o of outputs) {
    // Assigned by hand to some block: it has its row there and goes nowhere else.
    if (assignedKeys.has(o.key)) continue;
    const b = blockByInternal.get(o.target);
    if (!b) unassigned.push(o);
    else byBlock.set(b, [...(byBlock.get(b) ?? []), o]);
  }
  return { byBlock, unassigned };
}

/**
 * The outputs of one block that need a row, each with its frozen G number. Existing keys keep their
 * number and are not returned; new ones continue after the highest, in created-at order.
 */
export function numberNewOutputs(
  existing: { key: string; g: number }[],
  outputs: MappedOutput[],
): (MappedOutput & { g: number })[] {
  const fresh = nextGNumbers(existing, outputs.map((o) => ({ key: o.key, at: o.createdAt })));
  const byKey = new Map(outputs.map((o) => [o.key, o]));
  return fresh.map((f) => ({ ...byKey.get(f.key)!, g: f.g }));
}

export interface VersionRef {
  id: string;
  versionNumber: number;
  promptHash: string;
}

/**
 * The prompt version a generation was made from: the one whose hash equals the prompt as written, the
 * latest such version if wording was saved twice; else the `pvN` in the job label, if the label starts
 * with this block's id. Null when neither matches (a revision with a new prompt, say).
 */
export function matchPromptVersion(
  hash: string | null,
  label: string | null,
  blockDisplay: string,
  versions: VersionRef[],
): VersionRef | null {
  if (hash) {
    const hit = versions.filter((v) => v.promptHash === hash).sort((a, b) => b.versionNumber - a.versionNumber)[0];
    if (hit) return hit;
  }
  const m = label ? new RegExp(`^${blockDisplay.replace(/[^A-Za-z0-9-]/g, '')} pv(\\d+)$`).exec(label.trim()) : null;
  if (m) return versions.find((v) => v.versionNumber === Number(m[1])) ?? null;
  return null;
}

/** The label a block's generate job carries: `PD-S01-B003 pv2`. */
export function blockJobLabel(blockDisplayId: string, versionNumber: number): string {
  return `${blockDisplayId} pv${versionNumber}`;
}

/** What the next saved wording should do: a new version only when the normalized text differs from the latest. */
export function shouldSaveVersion(latestHash: string | null, text: string): { save: boolean; hash: string } {
  const hash = promptHash(text);
  return { save: latestHash !== hash, hash };
}
