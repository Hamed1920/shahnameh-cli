#!/usr/bin/env node
/**
 * Start the panel:  npm run up          (npm run up -- --dev for the dev server)
 *
 * Serves the production build, which is several times faster than the dev
 * server: pages are compiled once, not on first visit, and links prefetch.
 * The build is redone only when the panel's code has changed since the last
 * one (a hash of the sources, kept in .next/source-hash), so a normal start
 * takes seconds and the first start after a pull takes about a minute. If the
 * build fails, the dev server starts instead so the panel is never down.
 *
 * The panel's server starts the workers itself and keeps them running
 * (lib/worker-supervisor.ts); that is the same in both modes.
 *
 * The environment passes through untouched, so a sandbox works: SHM_PROJECTS for
 * the copied projects and SHM_HIGGSFIELD_JS for the stub CLI (10_PANEL/.env.local).
 * Not SHM_ROOT: the panel sets that per worker, and refuses to start workers when
 * it is set for the panel itself (lib/worker-guard.ts).
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const NEXT = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
const HASH_FILE = path.join(ROOT, '.next', 'source-hash')
const DEV = process.argv.includes('--dev')
const extra = process.argv.slice(2).filter((a) => a !== '--dev')

// What the build is made from. The model catalogue is left out on purpose: the
// panel reads it at runtime (lib/catalog.ts), so a daily refresh needs no rebuild.
const SOURCE_DIRS = ['app', 'components', 'lib', 'public', 'worker/lib']
const SOURCE_FILES = ['next.config.ts', 'package-lock.json', 'postcss.config.mjs', 'tsconfig.json', 'instrumentation.ts']

function sourceHash() {
  const h = createHash('sha1')
  const add = (rel) => {
    const abs = path.join(ROOT, rel)
    let st
    try { st = fs.statSync(abs) } catch { return }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) add(path.join(rel, name))
    } else if (!/\.test\.(ts|mjs)$/.test(rel)) {
      h.update(rel.replaceAll('\\', '/'))
      h.update(fs.readFileSync(abs))
    }
  }
  for (const d of SOURCE_DIRS) add(d)
  for (const f of SOURCE_FILES) add(f)
  return h.digest('hex')
}

function run(name, args) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const pipe = (stream) => {
    let buf = ''
    stream.on('data', (d) => {
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const l of lines) process.stdout.write(`[${name}] ${l}\n`)
    })
    stream.on('end', () => { if (buf) process.stdout.write(`[${name}] ${buf}\n`) })
  }
  pipe(child.stdout)
  pipe(child.stderr)
  child.on('exit', (code) => process.stdout.write(`[${name}] exited (${code ?? 'signal'})\n`))
  return child
}

const exited = (child) => new Promise((resolve) => child.on('exit', (code) => resolve(code)))

async function ensureBuild() {
  const hash = sourceHash()
  let built = null
  try { built = fs.readFileSync(HASH_FILE, 'utf8').trim() } catch { /* never built */ }
  if (built === hash && fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) return true
  process.stdout.write('[panel] The code changed since the last build: building the panel (about a minute)...\n')
  const code = await exited(run('build', [NEXT, 'build']))
  if (code !== 0) return false
  fs.writeFileSync(HASH_FILE, hash)
  return true
}

let panel
if (DEV) {
  panel = run('panel', [NEXT, 'dev', ...extra])
} else if (await ensureBuild()) {
  panel = run('panel', [NEXT, 'start', ...extra])
} else {
  process.stdout.write('[panel] The build failed (see above). Starting the slower dev server instead, so the panel still works.\n')
  panel = run('panel', [NEXT, 'dev', ...extra])
}

const stop = () => {
  try { panel.kill() } catch { /* already gone */ }
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
panel.on('exit', () => process.exit(0))
