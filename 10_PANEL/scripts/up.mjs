#!/usr/bin/env node
/**
 * Start the panel:  npm run up
 *
 * The panel's server starts the worker itself and keeps it running
 * (lib/worker-supervisor.ts), so this is now the same as npm run dev, with
 * the output prefixed. Kept so the command people know still works.
 *
 * The environment passes through untouched, so a sandbox works: SHM_PROJECTS for
 * the copied projects and SHM_HIGGSFIELD_JS for the stub CLI (10_PANEL/.env.local).
 * Not SHM_ROOT: the panel sets that per worker, and refuses to start workers when
 * it is set for the panel itself (lib/worker-guard.ts).
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const extra = process.argv.slice(2)

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

const panel = run('panel', [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', ...extra])

const stop = () => {
  try { panel.kill() } catch { /* already gone */ }
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
panel.on('exit', () => process.exit(0))
