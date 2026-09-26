import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliProblem, hfJson } from './hf.mjs'
import { acquireFileLock, releaseFileLock } from './locks.mjs'
import { summarizeModel } from './model-schema.mjs'

/**
 * The Higgsfield model catalogue: every image and video model the account can
 * run, with the params each one takes. Fetched from `model list` and `model get`
 * rather than kept by hand, so a model Higgsfield adds is selectable without a
 * code change.
 *
 * One file for the whole system (every project spends from the same account),
 * tracked in git so a panel on another machine can draw its pickers. The panel
 * imports it (lib/models.ts); workers read it here.
 *
 * A worker running against the stub CLI (SHM_HIGGSFIELD_JS) keeps its own copy
 * beside the sandbox projects, so a test run can never replace the real list
 * with the stub's four-model fixture.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REAL = path.resolve(HERE, '..', 'MODEL_CATALOG.json')

export const CATALOG_KINDS = ['image', 'video']
export const CATALOG_MAX_AGE_MS = 24 * 3600_000

export function catalogPath() {
  if (process.env.SHM_MODEL_CATALOG) return path.resolve(process.env.SHM_MODEL_CATALOG)
  if (process.env.SHM_HIGGSFIELD_JS) {
    const dir = process.env.SHM_PROJECTS ?? (process.env.SHM_ROOT ? path.dirname(path.resolve(process.env.SHM_ROOT)) : HERE)
    return path.join(dir, '.model-catalog.json')
  }
  return REAL
}

let cached = null
let cachedMtime = 0

/** The catalogue, or null before the first fetch. Re-read when the file changes. */
export function loadCatalog() {
  const file = catalogPath()
  let mtime = 0
  try { mtime = fsSync.statSync(file).mtimeMs } catch { return cached }
  if (cached && mtime === cachedMtime) return cached
  try {
    cached = JSON.parse(fsSync.readFileSync(file, 'utf8'))
    cachedMtime = mtime
  } catch { /* a torn write: keep the last good copy */ }
  return cached
}

export function catalogAge(catalog = loadCatalog()) {
  const at = Date.parse(catalog?.fetchedAt ?? '')
  return Number.isFinite(at) ? Date.now() - at : Infinity
}

/**
 * Fetch the list and every image/video model's params. Returns
 * { ok, count, skipped, error }. Writes nothing unless the list came back, and
 * keeps a model's previous entry when its `model get` fails, so one flaky call
 * cannot drop a model the account has.
 */
export async function refreshCatalog({ lockDir, log = async () => {} } = {}) {
  const lock = path.join(lockDir ?? path.dirname(catalogPath()), '.catalog.lock')
  if (!(await acquireFileLock(lock, { note: 'model catalogue refresh' }))) return { ok: false, error: 'another worker is refreshing' }
  try {
    const list = await hfJson(['model', 'list'], { timeoutMs: 120_000 })
    if (list.code !== 0 || !Array.isArray(list.json)) {
      return { ok: false, error: `the model list could not be fetched: ${cliProblem(list.stderr || list.stdout)}` }
    }
    const previous = loadCatalog()?.models ?? {}
    const wanted = list.json.filter((m) => CATALOG_KINDS.includes(m.type))
    const models = {}
    const skipped = []
    // A few at a time: 70 sequential calls take minutes, 70 at once is rude.
    for (let i = 0; i < wanted.length; i += 8) {
      await Promise.all(wanted.slice(i, i + 8).map(async (m) => {
        const r = await hfJson(['model', 'get', m.job_type], { timeoutMs: 60_000 })
        if (r.code === 0 && r.json && Array.isArray(r.json.params)) {
          models[m.job_type] = summarizeModel({ ...r.json, type: r.json.type ?? m.type, display_name: r.json.display_name ?? m.display_name })
        } else if (previous[m.job_type]) {
          models[m.job_type] = previous[m.job_type]
          skipped.push(m.job_type)
        } else {
          skipped.push(m.job_type)
        }
      }))
    }
    const sorted = Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b)))
    const file = catalogPath()
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify({
      _comment: 'Written by the worker from `higgsfield model list` / `model get` (worker/lib/models.mjs). Do not edit by hand; refresh from the Prompts page or restart a worker once it is a day old.',
      fetchedAt: new Date().toISOString(),
      models: sorted,
    }, null, 1) + '\n')
    await fs.rename(tmp, file)
    const usable = Object.values(sorted).filter((m) => m.usable).length
    await log(`MODELS refreshed: ${Object.keys(sorted).length} image/video models, ${usable} usable from a prompt${skipped.length ? `; kept or skipped ${skipped.join(', ')}` : ''}`)
    return { ok: true, count: Object.keys(sorted).length, usable, skipped }
  } finally {
    await releaseFileLock(lock)
  }
}

/** Refresh when missing or older than a day. Never throws: a stale list is better than no worker. */
export async function ensureFreshCatalog(opts = {}) {
  if (catalogAge() < CATALOG_MAX_AGE_MS) return { ok: true, fresh: true }
  try { return await refreshCatalog(opts) } catch (e) { return { ok: false, error: e.message } }
}
