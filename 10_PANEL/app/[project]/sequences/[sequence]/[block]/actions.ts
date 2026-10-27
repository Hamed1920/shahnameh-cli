'use server'

import { revalidatePath } from 'next/cache'
import { gate } from '@/lib/actor'
import { authEnabled } from '@/lib/actor-core'
import type { Actor } from '@/lib/actor-core'
import { freshCatalog } from '@/lib/catalog'
import { buildGenerateRow, submitOneRowBatch } from '@/lib/generate-row'
import { blockJobLabel } from '@/lib/pd-gen-map'
import { displayOf } from '@/lib/pd/keys'
import { requireProject, type Project } from '@/lib/projects'
import { getCatalog, getWorkerConfig } from '@/lib/store'
import { isBlocks } from '@/lib/structure'
import { Invalid } from '@/lib/uploads'

/**
 * Write side of the block workspace. The database holds prompt versions, links and the numbering of
 * generations; generating goes through the same one-row batch as the Prompts page, so the worker
 * prices it and nothing spends until the priced batch is approved. Each action checks its own
 * capability, because a Server Action is a public POST endpoint.
 */

export interface BlockResult {
  ok: boolean
  error?: string
  batchId?: string
  version?: number
  created?: boolean
  g?: number
}

const fail = (error: string): BlockResult => ({ ok: false, error })

async function guard(project: string, ...caps: ('block.write' | 'batch.submit')[]): Promise<{ pr: Project; actor: Actor } | { error: string }> {
  let actor: Actor | null = null
  for (const cap of caps) {
    const g = await gate(project, cap)
    if (!g.ok) return { error: g.error }
    actor = g.actor
  }
  const pr = await requireProject(project)
  if (!isBlocks(pr) || !authEnabled()) return { error: 'This project is not organised in sequences and blocks.' }
  return { pr, actor: actor! }
}

function refresh(pr: Project, blockId: string) {
  revalidatePath(`/${pr.slug}/sequences`, 'layout')
  void blockId
}

/** The reference tokens of a block's linked assets, in the order they were linked. */
async function linkedTokens(pr: Project, blockId: string): Promise<string[]> {
  const { listAssetLinks, linkToken } = await import('@/lib/pd-assets')
  const catalog = await getCatalog(pr)
  return (await listAssetLinks(blockId)).flatMap((l) => {
    const e = catalog.find((c) => c.id === l.entityId)
    return e ? [linkToken(e.shortId, l.variant)] : []
  })
}

export async function savePromptAction(project: string, blockId: string, text: string): Promise<BlockResult> {
  const g = await guard(project, 'block.write')
  if ('error' in g) return fail(g.error)
  const { savePromptVersion } = await import('@/lib/pd-prompts')
  const r = await savePromptVersion(g.pr.slug, blockId, text, await linkedTokens(g.pr, blockId), g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr, blockId)
  return { ok: true, version: r.version.versionNumber, created: r.created }
}

export async function addLinkAction(project: string, blockId: string, entityId: string, variant: string, role: string): Promise<BlockResult> {
  const g = await guard(project, 'block.write')
  if ('error' in g) return fail(g.error)
  freshCatalog()
  const entity = (await getCatalog(g.pr)).find((e) => e.id === entityId || e.shortId === entityId)
  if (!entity) return fail(`${entityId || '(none)'} is not in the index.`)
  const v = variant.trim().toUpperCase()
  if (v && !entity.variants.some((x) => x.variant === v)) return fail(`${entity.shortId} has no look ${v}.`)
  const { addAssetLink } = await import('@/lib/pd-assets')
  const r = await addAssetLink(g.pr.slug, blockId, entity.id, v || null, role.trim() || entity.kind.toLowerCase(), g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr, blockId)
  return { ok: true }
}

export async function removeLinkAction(project: string, blockId: string, linkId: string): Promise<BlockResult> {
  const g = await guard(project, 'block.write')
  if ('error' in g) return fail(g.error)
  const { removeAssetLink } = await import('@/lib/pd-assets')
  const r = await removeAssetLink(g.pr.slug, blockId, linkId, g.actor)
  if (!r.ok) return fail(r.error)
  refresh(g.pr, blockId)
  return { ok: true }
}

/**
 * Generate from a block: save the text as a new version when it changed, then send a one-row batch
 * targeting the block's internal shot id, labelled `<block id> pv<n>`. Fields: project, block,
 * prompt, plus the generation form (model, aspect_ratio, stage, duration, sound, extra).
 */
export async function generateForBlock(formData: FormData): Promise<BlockResult> {
  const project = String(formData.get('project') ?? '')
  const g = await guard(project, 'block.write', 'batch.submit')
  if ('error' in g) return fail(g.error)
  const { pr, actor } = g
  freshCatalog()
  const blockId = String(formData.get('block') ?? '')
  const { getBlock } = await import('@/lib/pd-store')
  // The form carries the block's key; the lookup is by display id inside this project.
  const b = await getBlock(pr.slug, displayOf(blockId))
  if (!b || !b.internalId) return fail('That block does not exist.')
  const prompt = String(formData.get('prompt') ?? '')
  if (!prompt.trim()) return fail('The prompt cannot be empty.')

  const { savePromptVersion } = await import('@/lib/pd-prompts')
  const tokens = await linkedTokens(pr, b.id)
  const saved = await savePromptVersion(pr.slug, b.id, prompt, tokens, actor)
  if (!saved.ok) return fail(saved.error)
  const version = saved.version

  try {
    const cfg = await getWorkerConfig()
    const versionRefs = Array.isArray(version.refs) ? (version.refs as unknown[]).map(String) : []
    const { job, defaults } = await buildGenerateRow(pr, formData, cfg, {
      target: b.internalId,
      label: blockJobLabel(b.displayId, version.versionNumber),
      // Verbatim: the worker keeps this as basePrompt, which is how the generation finds its version.
      prompt: version.promptText,
      refs: [...new Set([...versionRefs, ...tokens])],
    })
    const batchId = await submitOneRowBatch(pr, actor, {
      name: `${b.displayId} pv${version.versionNumber}`,
      source: { kind: 'paste', files: [] },
      defaults,
      job,
    })
    // The Activity Log (auth is on here: guard() refuses otherwise).
    const { audit } = await import('@/lib/audit')
    await audit({ project: pr.slug, actor, action: 'generation.request', objectType: 'block', objectId: b.displayId, detail: { batchId, promptVersion: version.versionNumber } })
    refresh(pr, b.displayId)
    return { ok: true, batchId, version: version.versionNumber, created: saved.created }
  } catch (e) {
    if (e instanceof Invalid) return fail(e.message)
    throw e
  }
}

export async function assignOutputAction(project: string, key: string, blockId: string): Promise<BlockResult> {
  const g = await guard(project, 'block.write')
  if ('error' in g) return fail(g.error)
  const { assignOutput } = await import('@/lib/pd-generations')
  const r = await assignOutput(g.pr, key, blockId, g.actor)
  if (!r.ok) return fail(r.error)
  revalidatePath(`/${g.pr.slug}/sequences`, 'layout')
  return { ok: true, g: r.g }
}
