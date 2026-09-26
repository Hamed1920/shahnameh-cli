import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv, toCsv } from './csv.mjs'
import { codeProblem, episodeFolderName, idRx, slugProblem } from './ids.mjs'
import { spentInWindow } from './spend.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

/**
 * The folder the projects sit in: the repo root. SHM_PROJECTS overrides it (a
 * sandbox); with only SHM_ROOT set it is that project's parent folder.
 */
export const PROJECTS_DIR = process.env.SHM_PROJECTS
  ? path.resolve(process.env.SHM_PROJECTS)
  : process.env.SHM_ROOT
    ? path.dirname(path.resolve(process.env.SHM_ROOT))
    : path.resolve(HERE, '..', '..', '..')

/**
 * This worker's project: SHM_ROOT (the panel's supervisor sets it for every
 * worker it starts), or --project <folder name> under PROJECTS_DIR. There is no
 * default -- a worker guessing its project could file one film's renders into another.
 */
function resolveRoot() {
  if (process.env.SHM_ROOT) return path.resolve(process.env.SHM_ROOT)
  const slug = argValue('--project')
  if (!slug) {
    throw new Error('No project given. Pass --project <project folder name>, or set SHM_ROOT to a project folder.')
  }
  const why = slugProblem(slug)
  if (why) throw new Error(`--project ${slug}: ${why}`)
  return path.join(PROJECTS_DIR, slug)
}

export const ROOT = resolveRoot()

function readProject() {
  const file = path.join(ROOT, 'project.json')
  let json
  try {
    json = JSON.parse(fsSync.readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`${file} is missing or unreadable (${e.code ?? e.message}). Is ${ROOT} a project folder?`)
  }
  const why = codeProblem(json.code)
  if (why) throw new Error(`${file}: code ${json.code}: ${why}`)
  return json
}

/** project.json: { schema, name, slug, code, description, mark?, created }. */
export const PROJECT = readProject()
/** The ID prefix of this project, e.g. SHM. */
export const CODE = PROJECT.code
/** Every ID pattern for this project, built once from its code. */
export const RX = idRx(CODE)

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
  /** Footage that changed episode: old shot id -> new, and every file it took with it. */
  shotMoves: path.join(ROOT, '00_PROJECT', 'queue', 'SHOT_MOVES.jsonl'),
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
  // The job being generated right now, for the panel. Per machine, like the lock.
  workerNow: path.join(ROOT, '00_PROJECT', 'queue', 'worker.now'),
}

export const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

/**
 * A file as text, '' when it does not exist. A leading byte-order mark is dropped:
 * PowerShell 5.1 writes one, and before the first line of a JSONL file it makes
 * JSON.parse fail, so readJsonl would skip that line as torn. (The CSV parsers
 * strip it themselves.)
 */
export async function readText(file) {
  try { return (await fs.readFile(file, 'utf8')).replace(/^﻿/, '') } catch (e) {
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
 * CODE-EP001-SC010-SH0010 and friends. A shot is a valid generation target but is
 * not an entity - it belongs to an episode, so its output lands in the episode
 * folder rather than an entity folder. See docs/INDEXING.md section 7.
 */
export const SHOT_RX = RX.shot
export const isShotId = (ref) => SHOT_RX.test(String(ref).trim())

/**
 * Project-relative output folder for a shot: 07_EPISODES/<episode dir>/shots.
 * The episode directory is matched by its CODE-EPnnn prefix, so the readable
 * suffix (...-ZAHHAK-ENTRY) can change without breaking anything.
 *
 * `title` names the folder of an episode that has none yet, so filing into an
 * episode never renames the one it already has: the name it was given when it
 * started is the one it keeps.
 */
export async function shotFolder(ref, title = '') {
  const ep = String(ref).match(RX.episodePrefix)[0]
  const root = path.join(ROOT, '07_EPISODES')
  let dirName = episodeFolderName(CODE, ep.slice(CODE.length + 1), title)
  try {
    // The prefix has to end the name or be followed by the title's dash, so a
    // bare CODE-EP001 never matches a CODE-EP001X someone made by hand.
    const found = (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && (e.name === ep || e.name.startsWith(`${ep}-`)))
      .map((e) => e.name)
      .sort()[0]
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
 *
 * The reference studio adds two working-space forms, which are not in the
 * index and have no entity (the caller gets entity: null and a `label`):
 *   studio:<session>/u1      a picture dropped into the studio (09_OUTPUT/_uploads/<session>/)
 *   staged:<hfJobId>/T01     an earlier try, still in _staging; once picked, the look it was filed as
 *
 * And one for the Prompts page: a picture sent with a batch is filed into the index
 * only when the batch is approved, so until then its rows point at the raw file:
 *   pending:<request id>/u1  a picture sent with a batch (09_OUTPUT/_uploads/<request id>/)
 */
export const STUDIO_SESSION_RX = /^ss_[a-z0-9]{4,40}$/
export async function resolveRef(token, entities, assets) {
  const raw = String(token).trim()
  const loose = raw.match(/^(studio|pending):((?:ss|jr)_[a-z0-9]{4,40})\/(u\d{1,3})$/)
  if (loose) {
    const dir = path.join(P.uploads, loose[2])
    const f = (await fs.readdir(dir).catch(() => [])).find((n) => n.startsWith(`${loose[3]}.`))
    if (!f) return { ok: false, reason: `${raw}: the file is gone` }
    return { ok: true, path: path.join(dir, f), entity: null, variant: null, take: null, label: 'an attached reference picture' }
  }
  const staged = raw.match(/^staged:([A-Za-z0-9_-]{4,80})\/(T\d{2})$/)
  if (staged) {
    const dir = path.join(P.staging, staged[1])
    const f = (await fs.readdir(dir).catch(() => [])).find((n) => n.startsWith(`${staged[2]}.`))
    if (f) return { ok: true, path: path.join(dir, f), entity: null, variant: null, take: null, label: 'an earlier try' }
    const filed = (await readJsonl(P.filings)).reverse().find((x) => x.ok && x.hfJobId === staged[1] && x.take === staged[2])
    if (filed?.token) return resolveRef(filed.token, entities, assets)
    return { ok: false, reason: `${raw}: that try is no longer in staging` }
  }
  const t = raw.replace(/^@/, '')
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
 * Every project's JOB_LEDGER.csv: this one's, plus each folder under
 * PROJECTS_DIR that has a project.json. Deduplicated, since this project is
 * normally one of those folders.
 */
export function ledgerFiles() {
  const files = new Set([path.resolve(P.ledger)])
  let dirs = []
  try { dirs = fsSync.readdirSync(PROJECTS_DIR, { withFileTypes: true }) } catch { /* no projects folder */ }
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue
    const root = path.join(PROJECTS_DIR, d.name)
    if (fsSync.existsSync(path.join(root, 'project.json'))) {
      files.add(path.resolve(root, '00_PROJECT', 'sync', 'JOB_LEDGER.csv'))
    }
  }
  return [...files]
}

/**
 * Credits spent on generations in the last `hours`, across EVERY project: they
 * all spend from one Higgsfield account, so the ceiling is the account's. See
 * spend.mjs for why this is a rolling window.
 */
export async function spentWithin(hours) {
  const rows = []
  for (const file of ledgerFiles()) rows.push(...(await readCsv(file)).rows)
  return spentInWindow(rows, hours)
}

/**
 * The machine-wide generation lock: one generation at a time across every
 * project's worker, so two workers cannot both pass the spend ceiling check
 * with the same remaining room. Held from that check until the ledger records
 * the spend.
 */
export const GENERATE_LOCK = path.join(PROJECTS_DIR, '.generate.lock')

/**
 * Where a shot is now, following every episode move it has been through
 * (SHOT_MOVES.jsonl). A regeneration or a final queued from an old record must
 * land where the footage lives, not where it was first filed.
 */
export async function currentShotId(id) {
  const moves = await readJsonl(P.shotMoves)
  let at = String(id ?? '')
  for (let guard = 0; guard < 50; guard++) {
    const hop = moves.find((m) => m?.from === at)
    if (!hop?.to) break
    at = hop.to
  }
  return at
}

/**
 * Every shot id in use in this project, so a new scene never takes a number that
 * was ever given out (INDEXING.md: numbers are never reused): queued targets,
 * shot files on disk, where footage was moved to (SHOT_MOVES.jsonl), and shots
 * taken out of an episode into _archive, whose files are no longer in shots/.
 */
export async function usedShotIds() {
  const ids = (await readJsonl(P.queue)).map((q) => String(q.target ?? ''))
  for (const m of await readJsonl(P.shotMoves)) ids.push(String(m?.from ?? ''), String(m?.to ?? ''))
  for (const a of await readJsonl(path.join(P.archive, 'index.jsonl'))) if (a?.kind === 'shot') ids.push(String(a.shot ?? ''))
  const root = path.join(ROOT, '07_EPISODES')
  let eps = []
  try { eps = await fs.readdir(root, { withFileTypes: true }) } catch { /* no episodes yet */ }
  for (const ep of eps.filter((e) => e.isDirectory())) {
    try { ids.push(...(await fs.readdir(path.join(root, ep.name, 'shots')))) } catch { /* no shots folder */ }
  }
  return ids
}

/**
 * Whether state.json can be trusted. readState() treats a missing or corrupt
 * file as a fresh project, which is right for a new project and a disaster for
 * one with history: every past decision and job would run again and spend
 * credits. Returns null when it is safe to start, else the reason not to.
 */
export async function stateStartProblem() {
  const t = await readText(P.state)
  let problem = null
  if (!t.trim()) problem = 'state.json is missing or empty'
  else {
    try { JSON.parse(t) } catch { problem = 'state.json is not valid JSON' }
  }
  if (!problem) return null
  const history = [P.queue, P.reviewLog, P.jobRequests, P.indexOps]
  for (const file of history) {
    if ((await readText(file)).trim()) {
      return `${problem}, but ${rel(file)} has history. Starting would replay it and spend credits again. Restore state.json from git (git checkout -- ${rel(P.state)}) before starting.`
    }
  }
  return null
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
