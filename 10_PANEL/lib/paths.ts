import path from 'node:path'

/**
 * The Shahnameh project root — the parent of 10_PANEL.
 * Override with SHM_ROOT when running the panel from somewhere else.
 */
export const ROOT = process.env.SHM_ROOT
  ? path.resolve(process.env.SHM_ROOT)
  : path.resolve(process.cwd(), '..')

export const P = {
  root: ROOT,
  entities: path.join(ROOT, '00_PROJECT', 'registry', 'ENTITIES.csv'),
  manifest: path.join(ROOT, '00_PROJECT', 'registry', 'ASSET_MANIFEST.csv'),
  ledger: path.join(ROOT, '00_PROJECT', 'sync', 'JOB_LEDGER.csv'),
  reviewLog: path.join(ROOT, '00_PROJECT', 'review', 'REVIEW_LOG.jsonl'),
  learnings: path.join(ROOT, '00_PROJECT', 'review', 'LEARNINGS.jsonl'),
  queue: path.join(ROOT, '00_PROJECT', 'queue', 'QUEUE.jsonl'),
  workerState: path.join(ROOT, '00_PROJECT', 'queue', 'state.json'),
  workerLog: path.join(ROOT, '00_PROJECT', 'queue', 'worker.log'),
  /** Holds the running worker's pid; its modified time is when that worker started. */
  workerLock: path.join(ROOT, '00_PROJECT', 'queue', 'worker.lock'),
  staging: path.join(ROOT, '09_OUTPUT', '_staging'),
  rejected: path.join(ROOT, '09_OUTPUT', '_rejected'),
  drafts: path.join(ROOT, '09_OUTPUT', '_drafts'),
  /** Raw reviewer uploads, waiting for the worker to file them. Working space. */
  uploads: path.join(ROOT, '09_OUTPUT', '_uploads'),
  /** Worker-written record of what each upload became. */
  filings: path.join(ROOT, '00_PROJECT', 'queue', 'FILINGS.jsonl'),
  /** References page requests (panel appends) and their outcomes (worker appends). */
  indexOps: path.join(ROOT, '00_PROJECT', 'review', 'INDEX_OPS.jsonl'),
  indexOpResults: path.join(ROOT, '00_PROJECT', 'queue', 'INDEX_OPS_RESULTS.jsonl'),
  /** Archived looks and their saved registry rows. Working space. */
  archive: path.join(ROOT, '09_OUTPUT', '_archive'),
  /** Prompts page and Regenerate requests (panel appends) and their outcomes (worker appends). */
  jobRequests: path.join(ROOT, '00_PROJECT', 'review', 'JOB_REQUESTS.jsonl'),
  /**
   * Gallery likes, tags and manual order. The panel is the only reader and the
   * only writer: it is how Hamed arranges accepted takes, and says nothing about
   * where a file lives, so the worker never looks at it.
   */
  gallery: path.join(ROOT, '00_PROJECT', 'review', 'GALLERY.jsonl'),
  jobRequestResults: path.join(ROOT, '00_PROJECT', 'queue', 'JOB_REQUEST_RESULTS.jsonl'),
  /** Written by the panel to ask the running worker to stop after its current job. */
  stopFlag: path.join(ROOT, '00_PROJECT', 'queue', 'worker.stop'),
  /** Console output of a worker started from the panel. */
  workerStdout: path.join(ROOT, '00_PROJECT', 'queue', 'worker.stdout.log'),
}

/**
 * Resolve a project-relative path and prove it stays inside ROOT.
 *
 * The asset route serves files from outside `public/`, so this is the only thing
 * standing between a crafted `?path=` and the rest of the disk. Returns null
 * rather than throwing so callers are forced to handle the reject case.
 */
export function safeResolve(relative: string): string | null {
  if (!relative) return null
  // Reject NUL and absolute/UNC/drive-qualified inputs outright.
  if (relative.includes('\0')) return null
  if (path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative) || relative.startsWith('\\\\')) {
    return null
  }
  const resolved = path.resolve(ROOT, relative)
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep
  if (resolved !== ROOT && !resolved.startsWith(rootWithSep)) return null
  return resolved
}

/** Project-relative, forward-slashed, for storing in JSONL and CSV. */
export function toRelative(absolute: string): string {
  return path.relative(ROOT, absolute).split(path.sep).join('/')
}
