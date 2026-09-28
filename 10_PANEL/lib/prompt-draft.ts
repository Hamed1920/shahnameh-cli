/**
 * The Prompts page's unsent work, kept in this browser until Clear all or a
 * successful send. Leaving the page, reloading it or closing the tab used to
 * throw away every row, reference and dropped picture.
 *
 * IndexedDB, not localStorage: dropped pictures are Files, and a dozen of them
 * is past localStorage's few megabytes. The draft is one record per project and
 * each picture its own, so typing a prompt never rewrites the images.
 *
 * Every call is best-effort. With no storage (a private window, blocked site
 * data) the page works exactly as before; it only forgets on leaving.
 */

const DB = 'shm-panel'
const STORE = 'prompt-drafts'

export interface SavedDraft<Row, Doc, Defaults> {
  v: 1
  text: string
  docs: Doc[]
  rows: Row[]
  defaults: Defaults
  episode: string
  name: string
  prepend: boolean
}

let opening: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).catch((e) => { opening = null; throw e })
  return opening
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db()
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = d.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req ? req.result : undefined)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

const draftKey = (project: string) => `draft:${project}`
const fileKey = (project: string, id: string) => `file:${project}:${id}`
/** Every file key of one project: `file:<slug>:` up to the next character after ':'. */
const filesOf = (project: string) => IDBKeyRange.bound(`file:${project}:`, `file:${project};`, false, true)

export async function loadDraft<R, D, F>(project: string): Promise<{ draft: SavedDraft<R, D, F>; files: Map<string, File> } | null> {
  try {
    const draft = await run<SavedDraft<R, D, F>>('readonly', (s) => s.get(draftKey(project)))
    if (!draft || draft.v !== 1) return null
    const files = new Map<string, File>()
    const [keys, values] = await Promise.all([
      run<IDBValidKey[]>('readonly', (s) => s.getAllKeys(filesOf(project))),
      run<File[]>('readonly', (s) => s.getAll(filesOf(project))),
    ])
    keys?.forEach((k, i) => { if (values?.[i]) files.set(String(k).slice(fileKey(project, '').length), values[i]) })
    return { draft, files }
  } catch {
    return null
  }
}

export async function saveDraft<R, D, F>(project: string, draft: SavedDraft<R, D, F>): Promise<void> {
  try { await run('readwrite', (s) => { s.put(draft, draftKey(project)) }) } catch { /* no storage */ }
}

export async function saveDraftFile(project: string, id: string, file: File): Promise<void> {
  try { await run('readwrite', (s) => { s.put(file, fileKey(project, id)) }) } catch { /* no storage */ }
}

/** Pictures no row uses any more, so a long session does not pile them up. */
export async function pruneDraftFiles(project: string, keep: Set<string>): Promise<void> {
  try {
    const keys = await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys(filesOf(project)))
    const drop = (keys ?? []).filter((k) => !keep.has(String(k).slice(fileKey(project, '').length)))
    if (drop.length) await run('readwrite', (s) => { for (const k of drop) s.delete(k) })
  } catch { /* no storage */ }
}

export async function clearDraft(project: string): Promise<void> {
  try {
    await run('readwrite', (s) => { s.delete(draftKey(project)); s.delete(filesOf(project)) })
  } catch { /* no storage */ }
}
