import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv, toCsv } from './csv.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = process.env.SHM_ROOT
  ? path.resolve(process.env.SHM_ROOT)
  : path.resolve(HERE, '..', '..', '..')

export const P = {
  root: ROOT,
  entities: path.join(ROOT, '00_PROJECT', 'registry', 'ENTITIES.csv'),
  manifest: path.join(ROOT, '00_PROJECT', 'registry', 'ASSET_MANIFEST.csv'),
  ledger: path.join(ROOT, '00_PROJECT', 'sync', 'JOB_LEDGER.csv'),
  reviewLog: path.join(ROOT, '00_PROJECT', 'review', 'REVIEW_LOG.jsonl'),
  learnings: path.join(ROOT, '00_PROJECT', 'review', 'LEARNINGS.jsonl'),
  queue: path.join(ROOT, '00_PROJECT', 'queue', 'QUEUE.jsonl'),
  state: path.join(ROOT, '00_PROJECT', 'queue', 'state.json'),
  log: path.join(ROOT, '00_PROJECT', 'queue', 'worker.log'),
  lock: path.join(ROOT, '00_PROJECT', 'queue', 'worker.lock'),
  staging: path.join(ROOT, '09_OUTPUT', '_staging'),
  rejected: path.join(ROOT, '09_OUTPUT', '_rejected'),
  drafts: path.join(ROOT, '09_OUTPUT', '_drafts'),
  uploads: path.join(ROOT, '09_OUTPUT', '_uploads'),
  filings: path.join(ROOT, '00_PROJECT', 'queue', 'FILINGS.jsonl'),
  // References page: requests written by the panel, results by the worker.
  indexOps: path.join(ROOT, '00_PROJECT', 'review', 'INDEX_OPS.jsonl'),
  indexOpResults: path.join(ROOT, '00_PROJECT', 'queue', 'INDEX_OPS_RESULTS.jsonl'),
  archive: path.join(ROOT, '09_OUTPUT', '_archive'),
  // Prompts page and Regenerate: requests written by the panel, outcomes by the worker.
  jobRequests: path.join(ROOT, '00_PROJECT', 'review', 'JOB_REQUESTS.jsonl'),
  jobRequestResults: path.join(ROOT, '00_PROJECT', 'queue', 'JOB_REQUEST_RESULTS.jsonl'),
  // Panel-requested graceful stop: the worker exits after the job in progress.
  stopFlag: path.join(ROOT, '00_PROJECT', 'queue', 'worker.stop'),
  // Console output of a worker started from the panel (crash traces, "already running").
  workerStdout: path.join(ROOT, '00_PROJECT', 'queue', 'worker.stdout.log'),
}

export const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

export async function readText(file) {
  try { return await fs.readFile(file, 'utf8') } catch (e) {
    if (e.code === 'ENOENT') return ''
    throw e
  }
}

export async function readJsonl(file) {
  const out = []
  for (const line of (await readText(file)).split('\n')) {
    const t = line.trim()
    if (t) { try { out.push(JSON.parse(t)) } catch { /* torn line */ } }
  }
  return out
}

export async function appendJsonl(file, record) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8')
}

export async function readCsv(file) {
  return parseCsv(await readText(file))
}

/**
 * Replace `file` with `tmp`, retrying while Windows reports the target busy.
 *
 * On Windows a rename over a file fails with EPERM/EBUSY/EACCES while any other
 * process has it open -- including the panel, which reads the registries many
 * times per page render, right when a fresh decision makes the worker write
 * them. The lock lasts milliseconds; give up only after a few seconds.
 */
export async function replaceFile(tmp, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || attempt >= 25) throw e
      await new Promise((r) => setTimeout(r, Math.min(40 * attempt, 400)))
    }
  }
}

/** Atomic-ish CSV write: temp file then rename, so a crash cannot truncate a registry. */
export async function writeCsv(file, rows, header) {
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, toCsv(rows, header), 'utf8')
  await replaceFile(tmp, file)
}

/** Put a file back exactly as it was read (used to roll back a half-applied change). */
export async function restoreText(file, text) {
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, text, 'utf8')
  await replaceFile(tmp, file)
}

export async function loadEntities() {
  const { rows } = await readCsv(P.entities)
  return rows
}

/**
 * SHM-EP001-SC010-SH0010 and friends. A shot is a valid generation target but is
 * not an entity - it belongs to an episode, so its output lands in the episode
 * folder rather than an entity folder. See INDEXING.md section 7.
 */
export const SHOT_RX = /^SHM-EP\d{3}(-SQ\d{2})?(-SC\d{3})?(-SH\d{4})?$/
export const isShotId = (ref) => SHOT_RX.test(String(ref).trim())

/**
 * Project-relative output folder for a shot: 07_EPISODES/<episode dir>/shots.
 * The episode directory is matched by its SHM-EPnnn prefix, so the readable
 * suffix (...-ZAHHAK-ENTRY) can change without breaking anything.
 */
export async function shotFolder(ref) {
  const ep = String(ref).match(/^SHM-EP\d{3}/)[0]
  const root = path.join(ROOT, '07_EPISODES')
  let dirName = ep
  try {
    const found = (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name.startsWith(ep))
      .map((e) => e.name)[0]
    if (found) dirName = found
  } catch { /* episode folder not created yet */ }
  return `07_EPISODES/${dirName}/shots`
}

export function findEntity(entities, ref) {
  const r = String(ref).trim().replace(/^@/, '')
  return entities.find((e) => e.id === r) ?? entities.find((e) => e.short_id === r) ?? null
}

/**
 * Resolve an @-token to a file path, mirroring Resolve-ShmRef in Shm-Common.ps1.
 *   @CHR-001  @CHR-001/V02  @CHR-001/V02/T03
 */
export async function resolveRef(token, entities, assets) {
  const t = String(token).trim().replace(/^@/, '')
  const [ref, variantIn, takeIn] = t.split('/')
  const ent = findEntity(entities, ref)
  if (!ent) return { ok: false, reason: `unknown entity '${ref}'` }

  const variant = (variantIn || ent.canonical_variant || '').toUpperCase()
  if (!variant) return { ok: false, reason: `${ent.id} has no canonical_variant and none was given` }

  let rows = assets.filter((a) => a.entity_id === ent.id && a.variant === variant)
  if (takeIn) rows = rows.filter((a) => a.take === takeIn.toUpperCase())
  if (rows.length === 0) return { ok: false, reason: `${ent.id} has no asset for ${variant}` }

  const row = rows.sort((a, b) => b.take.localeCompare(a.take))[0]
  const abs = path.join(ROOT, row.folder, row.filename)
  try { await fs.access(abs) } catch { return { ok: false, reason: `file missing: ${row.filename}` } }
  return { ok: true, path: abs, entity: ent, variant, take: row.take }
}

export async function log(line) {
  const stamp = new Date().toISOString()
  const msg = `${stamp}  ${line}`
  console.log(msg)
  await fs.mkdir(path.dirname(P.log), { recursive: true })
  await fs.appendFile(P.log, msg + '\n', 'utf8')
}

/**
 * Credits spent on generations in the last `hours`, from the ledger. The spend
 * ceiling is a rolling window over this, not state.spentCredits: that is a
 * lifetime total, and with a worker that never stops it only ever grows, so a
 * ceiling on it eventually holds every job for good.
 */
export async function spentWithin(hours) {
  const { rows } = await readCsv(P.ledger)
  const since = Date.now() - hours * 3600_000
  let total = 0
  for (const r of rows) {
    if (r.state !== 'GENERATED') continue
    const cost = parseFloat(r.cost)
    const at = Date.parse(r.ingested)
    if (Number.isFinite(cost) && Number.isFinite(at) && at >= since) total += cost
  }
  return total
}

export async function readState() {
  const t = await readText(P.state)
  if (!t.trim()) return { processedJobs: [], processedDecisions: [], spentCredits: 0 }
  try {
    const s = JSON.parse(t)
    return {
      processedJobs: s.processedJobs ?? [],
      processedDecisions: s.processedDecisions ?? [],
      spentCredits: s.spentCredits ?? 0,
      ...s,
    }
  } catch {
    return { processedJobs: [], processedDecisions: [], spentCredits: 0 }
  }
}

// One save at a time. The index-op watcher and a pass can both save while a
// generation is running, and two writes to the same temp file would collide.
let stateWrites = Promise.resolve()

/** Key-order-independent form of a state, so two states that say the same compare equal. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** What is on disk now, minus the stamp. null when the file is missing or unreadable. */
async function stateOnDisk() {
  try {
    const { updatedAt: _stamp, ...rest } = JSON.parse(await readText(P.state))
    return canonical(rest)
  } catch {
    return null
  }
}

/**
 * Save the state -- but only when something in it actually moved. `pass()` saves
 * every tick whether or not it did any work, so a fresh `updatedAt` on an idle
 * worker left state.json permanently modified in git: it blocked a pull and put
 * a meaningless timestamp in every commit. Nothing reads the stamp.
 */
export function writeState(state) {
  const run = stateWrites.then(async () => {
    const { updatedAt: _stamp, ...rest } = state
    if (canonical(rest) === await stateOnDisk()) return
    await fs.mkdir(path.dirname(P.state), { recursive: true })
    const tmp = P.state + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2))
    await replaceFile(tmp, P.state)
  })
  stateWrites = run.catch(() => {})
  return run
}

/**
 * Variants of an entity that sit in the archive. A look number is never handed
 * out again while its old look can still be restored, or @CHR-001/V04 in past
 * notes would silently point at a different picture.
 */
export async function archivedVariants(shortId) {
  const index = await readJsonl(path.join(P.archive, 'index.jsonl'))
  const restored = new Set(index.filter((x) => x.restored).map((x) => x.archiveId))
  return index
    .filter((x) => !x.restored && !restored.has(x.archiveId) && x.short_id === shortId && x.row?.variant)
    .map((x) => x.row.variant)
}
