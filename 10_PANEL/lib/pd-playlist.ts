// What each block of a sequence can play (database + files). Server only, behind authEnabled():
// import dynamically. The pure choice of source is lib/sequence-playlist.ts.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from './db/client.ts'
import { block, blockFinal, generation, reviewSubmission } from './db/schema.ts'
import { resolveGenerationFiles } from './pd-generations.ts'
import { gLabel } from './pd/numbering.ts'
import type { PlaylistBlock } from './sequence-playlist.ts'
import type { Project } from './projects'

/**
 * The blocks of a sequence with their active submission and Final. With `withAccepted` (production
 * only) each also carries its newest accepted generation that still has a file, for "best available".
 */
export async function playlistBlocks(pr: Project, sequenceId: string, withAccepted: boolean): Promise<PlaylistBlock[]> {
  const db = getDb()
  const blocks = await db.select().from(block).where(and(eq(block.projectSlug, pr.slug), eq(block.sequenceId, sequenceId), isNull(block.retiredAt))).orderBy(asc(block.displayOrder), asc(block.number))
  if (blocks.length === 0) return []
  const ids = blocks.map((b) => b.id)
  const gens = await db.select().from(generation).where(inArray(generation.blockId, ids))
  const gNum = new Map(gens.map((g) => [g.id, g.gNumber]))
  const subs = await db.select().from(reviewSubmission).where(inArray(reviewSubmission.blockId, ids))
  const subById = new Map(subs.map((s) => [s.id, s]))
  const finals = await db.select().from(blockFinal).where(inArray(blockFinal.blockId, ids))

  const accepted = new Map<string, { file: string; gLabel: string }>()
  if (withAccepted && gens.length) {
    const states = await resolveGenerationFiles(pr, gens)
    for (const g of [...gens].sort((a, b) => b.gNumber - a.gNumber)) {
      if (accepted.has(g.blockId)) continue
      const st = states.get(`${g.hfJobId ?? ''}|${g.candidate ?? ''}`)
      if (st?.decision === 'accepted' && st.file) accepted.set(g.blockId, { file: st.file, gLabel: gLabel(g.gNumber) })
    }
  }

  return blocks.map((b) => {
    const a = subs.find((s) => s.blockId === b.id && s.isActive)
    const f = finals.find((x) => x.blockId === b.id)
    const fs = f ? subById.get(f.submissionId) : undefined
    return {
      id: b.displayId, title: b.title, number: b.number, displayOrder: b.displayOrder,
      active: a ? { submissionId: a.id, round: a.roundNumber, gLabel: gLabel(gNum.get(a.generationId) ?? 0) } : null,
      final: f ? { submissionId: f.submissionId, round: fs?.roundNumber ?? null, gLabel: gLabel(gNum.get(f.generationId) ?? 0) } : null,
      accepted: accepted.get(b.id) ?? null,
    }
  })
}
