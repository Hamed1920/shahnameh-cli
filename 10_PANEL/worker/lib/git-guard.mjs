import { execFile } from 'node:child_process'
import { ROOT } from './project.mjs'

/**
 * Has another machine pushed changes to this project's index that this clone has
 * not pulled yet?
 *
 * Every machine runs its own worker (machine.mjs), and the CSV registries and
 * SHOT_MOVES are rewritten whole. A worker that writes them on top of an index
 * another machine has already changed makes a merge conflict at the next pull --
 * or two different things with the same new number. So before writing, a worker
 * asks git; when the answer is yes it holds that work with PULL_FIRST and tries
 * again, and after a pull it carries on.
 *
 * Asked at most once a minute (a fetch is a network call). No git, no upstream,
 * offline, or a sandbox copy that is not a clone: the answer is no, and work goes
 * ahead as before -- a machine is never stopped from working on its own.
 */

export const PULL_FIRST = 'pull first: another machine has changed this project\'s index since your last pull (git pull, then it carries on by itself)'

const EVERY_MS = 60_000
let last = { at: 0, head: null, changed: false }

function git(args, timeout = 20_000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', ROOT, ...args], {
      timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout) => resolve(err ? null : String(stdout)))
  })
}

export async function remoteChangedIndex() {
  if (process.env.SHM_GIT_GUARD === 'off') return false
  // The answer holds for a minute -- unless this clone moved (a pull), which is what
  // the held work is waiting for: then ask again at once.
  const head = (await git(['rev-parse', 'HEAD']))?.trim() ?? null
  if (Date.now() - last.at < EVERY_MS && head === last.head) return last.changed
  let changed = false
  try {
    const upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']))?.trim()
    if (upstream && (await git(['fetch', '--quiet'], 30_000)) !== null) {
      // What the upstream changed since this clone last had it, in this project's index only.
      const names = await git(['diff', '--name-only', 'HEAD...@{u}', '--', '00_PROJECT/registry', '00_PROJECT/queue/SHOT_MOVES.jsonl'])
      changed = Boolean(names && names.trim())
    }
  } catch { changed = false }
  last = { at: Date.now(), head, changed }
  return changed
}
