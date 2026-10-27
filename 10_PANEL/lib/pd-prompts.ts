// Prompt versions of a block (database). Server only, behind authEnabled(): import dynamically.
// Editing never overwrites: a saved wording is a new version, and only when the normalized text
// differs from the latest one (PRD 3 / 7.1).
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Actor } from './actor-core.ts'
import { audit } from './audit.ts'
import { getDb } from './db/client.ts'
import { block, promptVersion } from './db/schema.ts'
import { shouldSaveVersion } from './pd-gen-map.ts'

export type PromptVersionRow = typeof promptVersion.$inferSelect
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export async function listPromptVersions(blockId: string): Promise<PromptVersionRow[]> {
  return getDb().select().from(promptVersion).where(eq(promptVersion.blockId, blockId)).orderBy(asc(promptVersion.versionNumber))
}

export async function getPromptVersion(blockId: string, versionNumber: number): Promise<PromptVersionRow | null> {
  const [row] = await getDb().select().from(promptVersion).where(and(eq(promptVersion.blockId, blockId), eq(promptVersion.versionNumber, versionNumber))).limit(1)
  return row ?? null
}

/** Save `text` as the next version unless it equals the latest (after normalizing). `created` says which. */
export async function savePromptVersion(
  project: string, blockId: string, text: string, refs: string[], actor: Actor,
): Promise<Result<{ version: PromptVersionRow; created: boolean }>> {
  const body = String(text ?? '')
  if (!body.trim()) return { ok: false, error: 'The prompt is empty.' }
  const cleanRefs = [...new Set((refs ?? []).map((r) => String(r).trim()).filter(Boolean))]
  return getDb().transaction(async (tx) => {
    const [b] = await tx.select({ id: block.id }).from(block).where(and(eq(block.projectSlug, project), eq(block.id, blockId)))
    if (!b) return { ok: false as const, error: 'That block does not exist.' }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'pd-pv:' + blockId}))`)
    const [latest] = await tx.select().from(promptVersion).where(eq(promptVersion.blockId, blockId)).orderBy(desc(promptVersion.versionNumber)).limit(1)
    const { save, hash } = shouldSaveVersion(latest?.promptHash ?? null, body)
    if (!save && latest) return { ok: true as const, version: latest, created: false }
    const [row] = await tx.insert(promptVersion).values({
      blockId, versionNumber: (latest?.versionNumber ?? 0) + 1, promptText: body, promptHash: hash, refs: cleanRefs,
      createdBy: actor.id === 'local' ? null : actor.id,
    }).returning()
    await audit({ project, actor, action: 'prompt.version', objectType: 'block', objectId: blockId, detail: { version: row.versionNumber } }, tx)
    return { ok: true as const, version: row, created: true }
  })
}
