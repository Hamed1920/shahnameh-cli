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
function resolveEntry() {
  if (ENTRY !== null) return ENTRY
  const candidates = []
  if (process.env.SHM_HIGGSFIELD_JS) candidates.push(process.env.SHM_HIGGSFIELD_JS)
  try {
    const root = execFileSync(process.execPath, [
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      'root', '-g',
    ], { encoding: 'utf8' }).trim()
    candidates.push(path.join(root, '@higgsfield', 'cli', 'bin', 'higgsfield.js'))
  } catch { /* fall through */ }
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@higgsfield', 'cli', 'bin', 'higgsfield.js'))
  }
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) { ENTRY = c; return ENTRY } } catch { /* next */ }
  }
  ENTRY = false
  return ENTRY
}

/**
 * Thin wrapper over the Higgsfield CLI.
 *
 * Surface captured in 00_PROJECT/reference/HIGGSFIELD-CLI.md. Two things matter:
 *  - media flags accept LOCAL FILE PATHS and auto-upload, so no upload step
 *  - there is no --output flag; completed jobs expose a result URL we download
 */

export function hf(args, { timeoutMs = 20 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const entry = resolveEntry()
    if (!entry) {
      resolve({
        code: -1, stdout: '',
        stderr: 'Could not locate the Higgsfield CLI entrypoint. Install it with '
              + '`npm i -g @higgsfield/cli`, or set SHM_HIGGSFIELD_JS to bin/higgsfield.js.',
      })
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

export async function isAuthenticated() {
  const r = await hf(['auth', 'token'], { timeoutMs: 30_000 })
  return r.code === 0 && r.stdout.trim().length > 0
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

/** Credits for a planned job. Returns null when the figure cannot be read. */
export async function estimateCost(model, params) {
  const args = ['generate', 'cost', model, ...paramsToArgs(params)]
  const r = await hfJson(args, { timeoutMs: 120_000 })
  if (r.code !== 0) return { credits: null, raw: r.stderr || r.stdout }
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
  return { credits: find(r.json), raw: r.json ?? r.stdout }
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
