import path from 'node:path'

/**
 * Every file the panel reads or appends to, inside one project's folder
 * (projects/<slug>/). lib/projects.ts finds the folder; this only names what is
 * in it. Mirrors P in worker/lib/project.mjs.
 */
export function projectPaths(root: string) {
  return {
    root,
    entities: path.join(root, '00_PROJECT', 'registry', 'ENTITIES.csv'),
    manifest: path.join(root, '00_PROJECT', 'registry', 'ASSET_MANIFEST.csv'),
    ledger: path.join(root, '00_PROJECT', 'sync', 'JOB_LEDGER.csv'),
    reviewLog: path.join(root, '00_PROJECT', 'review', 'REVIEW_LOG.jsonl'),
    learnings: path.join(root, '00_PROJECT', 'review', 'LEARNINGS.jsonl'),
    queue: path.join(root, '00_PROJECT', 'queue', 'QUEUE.jsonl'),
    workerState: path.join(root, '00_PROJECT', 'queue', 'state.json'),
    workerLog: path.join(root, '00_PROJECT', 'queue', 'worker.log'),
    /** Holds the running worker's pid; its modified time is when that worker started. */
    workerLock: path.join(root, '00_PROJECT', 'queue', 'worker.lock'),
    staging: path.join(root, '09_OUTPUT', '_staging'),
    rejected: path.join(root, '09_OUTPUT', '_rejected'),
    drafts: path.join(root, '09_OUTPUT', '_drafts'),
    /** Raw reviewer uploads, waiting for the worker to file them. Working space. */
    uploads: path.join(root, '09_OUTPUT', '_uploads'),
    /** Worker-written record of what each upload became. */
    filings: path.join(root, '00_PROJECT', 'queue', 'FILINGS.jsonl'),
    /**
     * Worker-written record of footage that changed episode. QUEUE.jsonl and
     * REVIEW_LOG.jsonl are append-only history and keep the old shot id; this is
     * how the panel reads that id forward to where the file is now.
     */
    shotMoves: path.join(root, '00_PROJECT', 'queue', 'SHOT_MOVES.jsonl'),
    /** References page requests (panel appends) and their outcomes (worker appends). */
    indexOps: path.join(root, '00_PROJECT', 'review', 'INDEX_OPS.jsonl'),
    indexOpResults: path.join(root, '00_PROJECT', 'queue', 'INDEX_OPS_RESULTS.jsonl'),
    /** Archived looks and their saved registry rows. Working space. */
    archive: path.join(root, '09_OUTPUT', '_archive'),
    /** Prompts page and Regenerate requests (panel appends) and their outcomes (worker appends). */
    jobRequests: path.join(root, '00_PROJECT', 'review', 'JOB_REQUESTS.jsonl'),
    /**
     * Gallery likes, tags and manual order. The panel is the only reader and the
     * only writer: it is how the reviewer arranges accepted takes, and says
     * nothing about where a file lives, so the worker never looks at it.
     */
    gallery: path.join(root, '00_PROJECT', 'review', 'GALLERY.jsonl'),
    jobRequestResults: path.join(root, '00_PROJECT', 'queue', 'JOB_REQUEST_RESULTS.jsonl'),
    /** Written by the panel to ask the running worker to stop after its current job. */
    stopFlag: path.join(root, '00_PROJECT', 'queue', 'worker.stop'),
    /** Console output of a worker started from the panel. */
    workerStdout: path.join(root, '00_PROJECT', 'queue', 'worker.stdout.log'),
  }
}

export type ProjectPaths = ReturnType<typeof projectPaths>

/**
 * Resolve a project-relative path and prove it stays inside the project root.
 *
 * The asset route serves files from outside `public/`, so this is the only thing
 * standing between a crafted `?path=` and the rest of the disk. Returns null
 * rather than throwing so callers are forced to handle the reject case.
 */
export function safeResolve(root: string, relative: string): string | null {
  if (!relative) return null
  // Reject NUL and absolute/UNC/drive-qualified inputs outright.
  if (relative.includes('\0')) return null
  if (path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative) || relative.startsWith('\\\\')) {
    return null
  }
  const resolved = path.resolve(root, relative)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null
  return resolved
}

/** Project-relative, forward-slashed, for storing in JSONL and CSV. */
export function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}
