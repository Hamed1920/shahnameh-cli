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
  staging: path.join(ROOT, '09_OUTPUT', '_staging'),
  rejected: path.join(ROOT, '09_OUTPUT', '_rejected'),
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
