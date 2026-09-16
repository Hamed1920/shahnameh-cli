import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { safeResolve } from './paths'

/**
 * Small JPEG copies of look images, for reference chips and the index PDF.
 * The originals are several MB each; a chip needs a few KB and a PDF with
 * every look must stay small enough to attach to a chat.
 *
 * Kept in memory, keyed by path, width and the file's mtime, so an edited or
 * replaced image is re-made and a restart simply starts cold.
 */

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const cache = new Map<string, Buffer>()
const MAX_CACHED = 400

/** Project-relative image path -> JPEG bytes at most `width` px wide. Null when the path is not a readable image. */
export async function thumbnail(relative: string, width: number): Promise<Buffer | null> {
  const abs = safeResolve(relative)
  if (!abs || !IMAGE_EXT.has(path.extname(abs).toLowerCase())) return null
  let stat
  try { stat = await fs.stat(abs) } catch { return null }
  if (!stat.isFile()) return null

  const key = `${abs}|${width}|${stat.mtimeMs}`
  const hit = cache.get(key)
  if (hit) return hit
  try {
    const out = await sharp(abs, { animated: false })
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#0f0f0f' })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer()
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
    cache.set(key, out)
    return out
  } catch {
    return null
  }
}
