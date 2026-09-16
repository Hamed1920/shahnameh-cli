'use server'

import { revalidatePath } from 'next/cache'
import { MAX_TAG_LENGTH, cleanTag, newGalleryId, type GalleryEvent } from '@/lib/gallery'
import { REVIEWER, appendGalleryEvent } from '@/lib/gallery-log'
import { getDecisions } from '@/lib/store'

/**
 * The Gallery page's writes: one append to GALLERY.jsonl each.
 *
 * Every one checks that the decision exists and was accepted, so a stale tab
 * cannot tag something that is no longer there. This folder holds no page.tsx,
 * so it is not a route -- the Gallery is the root page and imports from here.
 */

async function acceptedIds(): Promise<Set<string>> {
  const decisions = await getDecisions()
  return new Set(decisions.filter((d) => d.verdict === 'accepted').map((d) => d.id))
}

function stamp<T extends GalleryEvent['type']>(type: T) {
  return { id: newGalleryId(), ts: new Date().toISOString(), reviewer: REVIEWER, type }
}

export async function setLike(decisionId: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!decisionId) return { ok: false, error: 'Missing take.' }
  if (!(await acceptedIds()).has(decisionId)) return { ok: false, error: 'That take is not an accepted one.' }

  await appendGalleryEvent({ ...stamp('like'), decisionId, on })
  revalidatePath('/')
  return { ok: true }
}

export async function setTag(decisionId: string, rawTag: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!decisionId) return { ok: false, error: 'Missing take.' }
  const tag = cleanTag(rawTag)
  if (!tag) return { ok: false, error: 'A tag needs some text.' }
  if (tag.length > MAX_TAG_LENGTH) return { ok: false, error: `A tag is at most ${MAX_TAG_LENGTH} characters.` }
  if (!(await acceptedIds()).has(decisionId)) return { ok: false, error: 'That take is not an accepted one.' }

  await appendGalleryEvent({ ...stamp('tag'), decisionId, tag, on })
  revalidatePath('/')
  return { ok: true }
}

/**
 * The whole arrangement in one event. A full list rather than a move-this-there
 * delta: it is a few kilobytes at this scale, and it cannot drift out of step
 * with a list that changed underneath the drag.
 */
export async function setOrder(order: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!Array.isArray(order)) return { ok: false, error: 'Bad order.' }
  const accepted = await acceptedIds()
  const clean = [...new Set(order.map((id) => String(id ?? '')))].filter((id) => accepted.has(id))
  if (clean.length > 5000) return { ok: false, error: 'Too many takes to order at once.' }

  await appendGalleryEvent({ ...stamp('order'), order: clean })
  revalidatePath('/')
  return { ok: true }
}
