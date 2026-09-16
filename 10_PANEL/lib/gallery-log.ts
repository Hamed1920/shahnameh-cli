import fs from 'node:fs/promises'
import path from 'node:path'
import { P } from './paths'
import { foldGallery, type GalleryEvent, type GalleryState } from './gallery'

/**
 * The panel's side of GALLERY.jsonl: how accepted takes are liked, tagged and
 * ordered on the Gallery page.
 *
 * Append-only, like every other JSONL here, so two tabs (or two machines
 * between syncs) union-merge instead of overwriting each other. Nothing is ever
 * deleted -- unliking is an event saying so, which is what keeps the file
 * mergeable.
 *
 * Server-only and deliberately not a 'use server' module: appending must never
 * become a callable endpoint of its own. Unlike JOB_REQUESTS.jsonl nothing in
 * the worker reads this; it is presentation, not production state, which is
 * why the panel may own both ends of it.
 */

export const REVIEWER = process.env.SHM_REVIEWER || 'hamed'

// One append at a time within this process, so two tabs cannot interleave.
let tail: Promise<void> = Promise.resolve()

export function appendGalleryEvent(record: GalleryEvent): Promise<void> {
  const run = tail.then(async () => {
    await fs.mkdir(path.dirname(P.gallery), { recursive: true })
    await fs.appendFile(P.gallery, JSON.stringify(record) + '\n', 'utf8')
  })
  tail = run.catch(() => {})
  return run
}

export async function getGalleryState(): Promise<GalleryState> {
  let text: string
  try {
    text = await fs.readFile(P.gallery, 'utf8')
  } catch {
    return { liked: [], tags: {}, order: [] }
  }
  const events: GalleryEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as GalleryEvent)
    } catch {
      // A half-written line from a crash: skip it rather than lose the file.
    }
  }
  return foldGallery(events)
}
