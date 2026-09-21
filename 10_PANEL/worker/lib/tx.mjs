import fs from 'node:fs/promises'
import path from 'node:path'
import { P, ROOT, log, readText, restoreText, writeCsv } from './project.mjs'
import { parseCsv } from './csv.mjs'

/**
 * One index op, applied as a unit.
 *
 * Its own module so that promote.mjs can file an upload into a transaction
 * the caller owns without importing index-ops.mjs, which imports promote.mjs
 * back. Everything here moved out of index-ops.mjs unchanged.
 */

export const MANIFEST_HEADER = [
  'filename', 'entity_id', 'variant', 'take', 'role', 'status', 'folder',
  'source', 'original_filename', 'added', 'notes',
]

/** A request that breaks a rule. Retrying cannot help, so it is recorded as failed. */
export class OpError extends Error {}

export const fail = (msg) => { throw new OpError(msg) }

// ---------------------------------------------------------------- transaction

export async function moveFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  try {
    await fs.rename(src, dest)
  } catch (e) {
    if (e.code !== 'EXDEV') throw e
    await fs.copyFile(src, dest)
    await fs.rm(src, { force: true })
  }
}

export async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

/**
 * Run `fn` against in-memory registries. On success both CSVs are written; on
 * any error every recorded file move is reversed, every rewritten sidecar put
 * back, and the CSVs restored.
 */
export async function transaction(fn) {
  const [entitiesText, manifestText] = await Promise.all([readText(P.entities), readText(P.manifest)])
  const e = parseCsv(entitiesText)
  const m = parseCsv(manifestText)
  const moves = []
  const copies = []
  const rewrites = []
  const tx = {
    entities: e.rows,
    assets: m.rows,
    async move(src, dest) {
      if (await exists(dest)) fail(`${rel(dest)} already exists`)
      await moveFile(src, dest)
      moves.push([src, dest])
    },
    async copy(src, dest) {
      if (await exists(dest)) fail(`${rel(dest)} already exists`)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.copyFile(src, dest)
      copies.push(dest)
    },
    async rewrite(file, original, next) {
      await restoreText(file, next)
      rewrites.push([file, original])
    },
  }
  try {
    const result = await fn(tx)
    await writeCsv(P.manifest, tx.assets, m.header.length ? m.header : MANIFEST_HEADER)
    await writeCsv(P.entities, tx.entities, e.header)
    // Side records (the archive index) only once the registries are committed.
    if (typeof result === 'object' && result.after) await result.after()
    return typeof result === 'object' ? result.summary : result
  } catch (err) {
    for (const [src, dest] of moves.reverse()) {
      await moveFile(dest, src).catch((r) => log(`ROLLBACK move failed ${rel(dest)}: ${r.message}`))
    }
    // A copy left nothing behind to put back; undoing it is removing it.
    for (const dest of copies.reverse()) {
      await fs.rm(dest, { force: true }).catch((r) => log(`ROLLBACK copy failed ${rel(dest)}: ${r.message}`))
    }
    for (const [file, text] of rewrites.reverse()) {
      await restoreText(file, text).catch((r) => log(`ROLLBACK ${rel(file)} failed: ${r.message}`))
    }
    await restoreText(P.manifest, manifestText).catch((r) => log(`ROLLBACK manifest failed: ${r.message}`))
    await restoreText(P.entities, entitiesText).catch((r) => log(`ROLLBACK entities failed: ${r.message}`))
    throw err
  }
}

export const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')
