import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { safeResolve } from './paths'

/**
 * Small JPEG copies of look images, for grids, reference chips and the index
 * PDF. The originals are several MB each; a card needs tens of KB and a PDF
 * with every look must stay small enough to attach to a chat.
 *
 * Keyed by path, width and the file's mtime, so an edited or replaced image is
 * re-made. Kept in memory, and on disk under .next/cache/thumbs (never in a
 * project: those folders are committed) so a restart does not start cold.
 */

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const cache = new Map<string, Buffer>()
const MAX_CACHED = 400
const DISK = path.join(process.cwd(), '.next', 'cache', 'thumbs')

/** The image a thumbnail is made from, or null when the path is not a readable image inside the project. */
export async function thumbnailSource(root: string, relative: string): Promise<{ abs: string; stat: Stats } | null> {
  const abs = safeResolve(root, relative)
  if (!abs || !IMAGE_EXT.has(path.extname(abs).toLowerCase())) return null
  let stat
  try { stat = await fs.stat(abs) } catch { return null }
  return stat.isFile() ? { abs, stat } : null
}

/** Project-relative image path -> JPEG bytes at most `width` px wide. Null when the path is not a readable image. */
export async function thumbnail(root: string, relative: string, width: number): Promise<Buffer | null> {
  const src = await thumbnailSource(root, relative)
  if (!src) return null

  const key = `${src.abs}|${width}|${src.stat.mtimeMs}`
  const hit = cache.get(key)
  if (hit) return hit
  const file = path.join(DISK, createHash('sha1').update(key).digest('hex') + '.jpg')
  let out = await fs.readFile(file).catch(() => null)
  if (!out) {
    try {
      out = await sharp(src.abs, { animated: false })
        .rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#0f0f0f' })
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer()
    } catch {
      return null
    }
    // Best effort: a thumbnail that cannot be saved is simply made again next time.
    await fs.mkdir(DISK, { recursive: true }).then(() => fs.writeFile(file, out!)).catch(() => {})
  }
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
  cache.set(key, out)
  return out
}
