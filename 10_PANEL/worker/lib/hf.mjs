import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve the CLI's JavaScript entrypoint so we can spawn it with `shell: false`.
 *
 * SECURITY: `higgsfield` on Windows is a .cmd/.ps1 shim, which Node can only launch
 * with `shell: true` — and that concatenates arguments into a command line instead of
 * escaping them. Our arguments include prompts authored in Claude Chat/Cowork, so a
 * prompt containing `&`, `|` or a quote would be a command injection. Running the
 * .js entrypoint under the current Node binary avoids the shell entirely.
 */
let ENTRY = null
// A CLI that was not found is looked for again after this long, so installing it
// does not need a worker restart. (npm root -g is too slow to run on every call.)
const MISSING_RETRY_MS = 60_000
let missingSince = 0
function resolveEntry() {
  if (ENTRY) return ENTRY
  if (ENTRY === false && Date.now() - missingSince < MISSING_RETRY_MS) return false
  // An explicit CLI (the sandbox stub) is the only candidate. Falling back to the
  // real CLI when that path is wrong would spend real credits on test data.
  if (process.env.SHM_HIGGSFIELD_JS) {
    ENTRY = fs.existsSync(process.env.SHM_HIGGSFIELD_JS) ? process.env.SHM_HIGGSFIELD_JS : false
    if (!ENTRY) missingSince = Date.now()
    return ENTRY
  }
  const candidates = []
  // npm sits beside node.exe on Windows, but under ../lib/node_modules on macOS and
  // Linux (nvm included). Asking only the Windows layout leaves ENTRY false on a Mac,
  // and every hf() call then fails as "not authenticated" without running. Try both.
  const nodeDir = path.dirname(process.execPath)
  for (const cli of [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]) {
    try {
      if (!fs.existsSync(/*turbopackIgnore: true*/ cli)) continue
      const root = execFileSync(process.execPath, [cli, 'root', '-g'], { encoding: 'utf8' }).trim()
      candidates.push(path.join(root, '@higgsfield', 'cli', 'bin', 'higgsfield.js'))
      break
    } catch { /* try the next layout */ }
  }
  // Last resort if npm itself cannot be run: the POSIX global root, derived directly.
  candidates.push(path.join(nodeDir, '..', 'lib', 'node_modules', '@higgsfield', 'cli', 'bin', 'higgsfield.js'))
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@higgsfield', 'cli', 'bin', 'higgsfield.js'))
  }
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) { ENTRY = c; return ENTRY } } catch { /* next */ }
  }
  ENTRY = false
  missingSince = Date.now()
  return ENTRY
}

export const CLI_MISSING = 'Could not locate the Higgsfield CLI entrypoint. Install it with '
  + '`npm i -g @higgsfield/cli`, or set SHM_HIGGSFIELD_JS to bin/higgsfield.js.'

/**
 * What a failed CLI call means for a person, in one line: the CLI is missing, it
 * is not signed in, or (CLI 1.1.26+) no workspace is chosen. Anything else is the
 * CLI's own first line, so the panel shows the real reason rather than a guess.
 */
export function cliProblem(text) {
  const t = String(text ?? '').trim()
  if (!t) return 'the Higgsfield CLI failed without saying why'
  if (t.startsWith('Could not locate the Higgsfield CLI')) return 'the Higgsfield CLI is not installed on this machine: npm i -g @higgsfield/cli'
  if (/no workspace selected/i.test(t)) return 'no Higgsfield workspace is selected: run higgsfield workspace list, then higgsfield workspace set <id>'
  if (/not (logged|signed) in|unauthori[sz]ed|auth(entication)? required|token (expired|invalid)|\b401\b/i.test(t)) return 'the Higgsfield CLI is not signed in: run higgsfield auth login'
  return t.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 300) ?? t.slice(0, 300)
}

/**
 * Thin wrapper over the Higgsfield CLI.
 *
 * Surface captured in docs/reference/HIGGSFIELD-CLI.md. Two things matter:
 *  - media flags accept LOCAL FILE PATHS and auto-upload, so no upload step
 *  - there is no --output flag; completed jobs expose a result URL we download
 */

export function hf(args, { timeoutMs = 20 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const entry = resolveEntry()
    if (!entry) {
      resolve({ code: -1, stdout: '', stderr: CLI_MISSING })
      return
    }
    // shell:false — arguments are passed as an argv array and never parsed by a shell.
    const child = spawn(process.execPath, [entry, ...args], {
      shell: false,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, stdout, stderr: stderr + '\n[worker] timed out' })
    }, timeoutMs)

    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: String(err) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

export async function hfJson(args, opts) {
  const r = await hf([...args, '--json'], opts)
  let json = null
  if (r.stdout.trim()) {
    try {
      json = JSON.parse(r.stdout)
    } catch {
      // Some CLIs emit progress lines before the JSON body; take the last
      // balanced object or array in the stream.
      const m = r.stdout.match(/[[{][\s\S]*[\]}]/)
      if (m) { try { json = JSON.parse(m[0]) } catch { /* leave null */ } }
    }
  }
  return { ...r, json }
}

/**
 * Can this machine's CLI run jobs? { ok, reason }. `auth token` proves the sign-in;
 * `workspace status` proves a workspace is chosen, without which CLI 1.1.26 refuses
 * every generate and cost call ("No workspace selected", exit 4). An older CLI with
 * no workspace command answers with an unknown-command error, which is not a problem.
 */
let readyAt = 0
export async function cliReady() {
  // A good answer holds for a minute (it is asked every pass); a bad one is never cached.
  if (Date.now() - readyAt < 60_000) return { ok: true, reason: null }
  const result = await checkCli()
  readyAt = result.ok ? Date.now() : 0
  return result
}

async function checkCli() {
  const auth = await hf(['auth', 'token'], { timeoutMs: 30_000 })
  if (auth.code !== 0 || !auth.stdout.trim()) {
    return { ok: false, reason: cliProblem(auth.stderr || auth.stdout || 'the Higgsfield CLI is not signed in: run higgsfield auth login') }
  }
  const ws = await hf(['workspace', 'status'], { timeoutMs: 30_000 })
  if (ws.code !== 0 && /no workspace selected/i.test(`${ws.stderr}\n${ws.stdout}`)) {
    return { ok: false, reason: cliProblem('No workspace selected') }
  }
  return { ok: true, reason: null }
}

export async function isAuthenticated() {
  return (await cliReady()).ok
}

/**
 * Pull the deliverable URLs out of a generate response.
 *
 * Verified schema (2026-09-03, live account). The response is an array of job
 * objects, each shaped:
 *   { id, job_type, status, result_url, min_result_url, params: {...} }
 *
 * Only `result_url` is the deliverable. Two things must NOT be downloaded:
 *   - `min_result_url`, a small webp thumbnail of the same image
 *   - anything under `params` — that echoes back the INPUT reference images we
 *     supplied, which would land our own reference in the review queue as if it
 *     were a new candidate
 *
 * A broad tree-walk picked up both. This reads the exact field instead.
 */
export function extractResultUrls(json) {
  const urls = []
  const push = (u) => { if (typeof u === 'string' && /^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u) }

  const fromJob = (job) => {
    if (!job || typeof job !== 'object') return
    if (job.status && String(job.status).toLowerCase() !== 'completed') return
    push(job.result_url ?? job.resultUrl)
    // Some job types return several outputs in one job.
    for (const key of ['result_urls', 'resultUrls', 'results', 'outputs']) {
      const v = job[key]
      if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === 'string') push(item)
          else if (item && typeof item === 'object') push(item.result_url ?? item.url)
        }
      }
    }
  }

  if (Array.isArray(json)) json.forEach(fromJob)
  else fromJob(json)

  return urls
}

export function extractJobId(json) {
  const KEYS = ['job_id', 'jobId', 'id', 'generation_id', 'generationId']
  const seen = new Set()
  const walk = (node) => {
    if (node == null || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (const n of node) { const r = walk(n); if (r) return r }
      return null
    }
    for (const k of KEYS) {
      const v = node[k]
      if (typeof v === 'string' && v.length >= 8 && !seen.has(v)) { seen.add(v); return v }
    }
    for (const v of Object.values(node)) { const r = walk(v); if (r) return r }
    return null
  }
  return walk(json)
}

/**
 * Credits for a planned job: { credits, raw, error }. `credits` is null when the
 * figure cannot be read, and then `error` says why, in words a person can act on.
 */
export async function estimateCost(model, params) {
  const args = ['generate', 'cost', model, ...paramsToArgs(params)]
  const r = await hfJson(args, { timeoutMs: 120_000 })
  if (r.code !== 0) return { credits: null, raw: r.stderr || r.stdout, error: cliProblem(r.stderr || r.stdout) }
  const find = (node) => {
    if (node == null) return null
    if (typeof node === 'number') return node
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (/credit|cost|price/i.test(k) && typeof v === 'number') return v
        const r2 = find(v)
        if (r2 != null) return r2
      }
    }
    return null
  }
  const credits = find(r.json)
  return { credits, raw: r.json ?? r.stdout, error: credits == null ? 'the price came back without a credit figure' : null }
}

/**
 * Build argv from a params object.
 *
 * Array-valued params become REPEATED flags, which is what the CLI expects for
 * image_references / video_references / audio_references. Comma-joining them
 * into a single flag silently produces one bogus reference instead of several.
 */
export function paramsToArgs(params) {
  const args = []
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === '') continue
    const flag = k.startsWith('--') ? k : `--${String(k).replace(/_/g, '-')}`
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === undefined || item === null || item === '') continue
        args.push(flag, String(item))
      }
    } else {
      args.push(flag, String(v))
    }
  }
  return args
}
