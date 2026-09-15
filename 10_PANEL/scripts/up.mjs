#!/usr/bin/env node
/**
 * Start the panel and the worker together:  npm run up
 *
 * Both run as children of this process with their output prefixed. Ctrl+C
 * stops both. If the worker exits at once (a worker is already running on
 * this or another machine, or it is not authenticated), its output is shown
 * and the panel keeps running, where the Queue page can start it later.
 *
 * SHM_ROOT and SHM_HIGGSFIELD_JS pass through untouched, so a sandbox works.
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
const worker = run('worker', [path.join(ROOT, 'worker', 'worker.mjs')])

const stop = () => {
  for (const c of [worker, panel]) { try { c.kill() } catch { /* already gone */ } }
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
panel.on('exit', () => { try { worker.kill() } catch { /* gone */ } process.exit(0) })
