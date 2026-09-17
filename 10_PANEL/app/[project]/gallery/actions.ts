'use server'

import { revalidatePath } from 'next/cache'
import { MAX_TAG_LENGTH, cleanTag, newGalleryId, type GalleryEvent } from '@/lib/gallery'
import { REVIEWER, appendGalleryEvent } from '@/lib/gallery-log'
import { requireProject } from '@/lib/projects'
import { getDecisions } from '@/lib/store'
import type { Project } from '@/lib/projects'

/**
 * The Gallery page's writes: one append to GALLERY.jsonl each.
 *
 * Every one checks that the decision exists and was accepted, so a stale tab
 * cannot tag something that is no longer there. This folder holds no page.tsx,
 * so it is not a route -- the Gallery is the root page and imports from here.
 */

async function acceptedIds(pr: Project): Promise<Set<string>> {
  const decisions = await getDecisions(pr)
  return new Set(decisions.filter((d) => d.verdict === 'accepted').map((d) => d.id))
}

function stamp<T extends GalleryEvent['type']>(type: T) {
  return { id: newGalleryId(), ts: new Date().toISOString(), reviewer: REVIEWER, type }
}

export async function setLike(project: string, decisionId: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  const pr = await requireProject(project)
  if (!decisionId) return { ok: false, error: 'Missing take.' }
  if (!(await acceptedIds(pr)).has(decisionId)) return { ok: false, error: 'That take is not an accepted one.' }

  await appendGalleryEvent(pr, { ...stamp('like'), decisionId, on })
  revalidatePath(`/${pr.slug}`)
  return { ok: true }
}

export async function setTag(project: string, decisionId: string, rawTag: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  const pr = await requireProject(project)
  if (!decisionId) return { ok: false, error: 'Missing take.' }
  const tag = cleanTag(rawTag)
  if (!tag) return { ok: false, error: 'A tag needs some text.' }
  if (tag.length > MAX_TAG_LENGTH) return { ok: false, error: `A tag is at most ${MAX_TAG_LENGTH} characters.` }
  if (!(await acceptedIds(pr)).has(decisionId)) return { ok: false, error: 'That take is not an accepted one.' }

  await appendGalleryEvent(pr, { ...stamp('tag'), decisionId, tag, on })
  revalidatePath(`/${pr.slug}`)
  return { ok: true }
}

/**
 * The whole arrangement in one event. A full list rather than a move-this-there
 * delta: it is a few kilobytes at this scale, and it cannot drift out of step
 * with a list that changed underneath the drag.
 */
export async function setOrder(project: string, order: string[]): Promise<{ ok: boolean; error?: string }> {
  const pr = await requireProject(project)
  if (!Array.isArray(order)) return { ok: false, error: 'Bad order.' }
  const accepted = await acceptedIds(pr)
  const clean = [...new Set(order.map((id) => String(id ?? '')))].filter((id) => accepted.has(id))
  if (clean.length > 5000) return { ok: false, error: 'Too many takes to order at once.' }

  await appendGalleryEvent(pr, { ...stamp('order'), order: clean })
  revalidatePath(`/${pr.slug}`)
  return { ok: true }
}
