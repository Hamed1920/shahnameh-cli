'use server'

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { safeResolve } from '@/lib/paths'

/**
 * Open File Explorer with one project file selected. Reads nothing and writes
 * nothing -- it only asks the desktop to show a file -- so it sits apart from
 * the write-side actions in actions.ts.
 *
 * The panel is localhost-only and runs as the reviewer's own user, so the
 * window opens on their desktop. Any path is confined to the project root.
 */
export async function revealInFolder(relative: string): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: 'Show in folder only works on Windows.' }

  const abs = safeResolve(String(relative ?? ''))
  // A double quote cannot occur in a Windows filename; refusing it keeps the
  // hand-built argument below unambiguous.
  if (!abs || abs.includes('"')) return { ok: false, error: 'That path is outside the project.' }

  try {
    if (!(await fs.stat(abs)).isFile()) return { ok: false, error: 'Not a file.' }
  } catch {
    return { ok: false, error: 'The file is not there any more. Refresh the page.' }
  }

  // explorer.exe wants exactly `/select,"C:\path with spaces\file"`. Node's
  // default quoting would wrap the whole argument, which Explorer ignores and
  // opens Documents instead -- hence verbatim arguments. No shell is involved.
  const child = spawn('explorer.exe', [`/select,"${abs}"`], {
    windowsVerbatimArguments: true,
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', () => {})
  child.unref()
  return { ok: true }
}
