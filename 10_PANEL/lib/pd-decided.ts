// Decided for a blocks project (database + files). Server only, behind authEnabled().
// The grouping and filtering is pure: lib/decided-tree.ts.
import { eq } from 'drizzle-orm'
import { getDb } from './db/client.ts'
import { blockFinal, generation, reviewSubmission } from './db/schema.ts'
import type { TreeBlock, TreeSequence, Verdict } from './decided-tree.ts'
import { resolveGenerationFiles } from './pd-generations.ts'
import { listBlocks, listSequences } from './pd-store.ts'
import { gLabel } from './pd/numbering.ts'
import type { Actor } from './actor-core.ts'
import type { Project } from './projects'

export async function loadDecidedTree(pr: Project, viewer: Actor): Promise<{ sequences: TreeSequence[]; blocks: TreeBlock[] }> {
  const db = getDb()
  const seqs = await listSequences(pr.slug)
  const lines = (await Promise.all(seqs.map(async (s) => (await listBlocks(s.id, viewer)).map((b) => ({ ...b, sequenceId: s.id }))))).flat()
  const gens = await db.select().from(generation).where(eq(generation.projectSlug, pr.slug))
  const subs = await db.select({ s: reviewSubmission }).from(reviewSubmission).innerJoin(generation, eq(generation.id, reviewSubmission.generationId)).where(eq(generation.projectSlug, pr.slug))
  const finals = await db.select({ f: blockFinal }).from(blockFinal).innerJoin(generation, eq(generation.id, blockFinal.generationId)).where(eq(generation.projectSlug, pr.slug))
  const finalGen = new Set(finals.map((x) => x.f.generationId))
  const states = await resolveGenerationFiles(pr, gens)

  const blocks: TreeBlock[] = lines.map((b) => ({
    id: b.id, sequenceId: b.sequenceId, title: b.title, number: b.number, displayOrder: b.displayOrder, status: b.status,
    generations: gens.filter((g) => g.blockId === b.id).sort((x, y) => y.gNumber - x.gNumber).map((g) => ({
      id: g.id, gNumber: g.gNumber, gLabel: gLabel(g.gNumber), createdAt: g.createdAt.toISOString(), createdBy: g.createdBy,
      verdict: (states.get(`${g.hfJobId ?? ''}|${g.candidate ?? ''}`)?.decision ?? 'pending') as Verdict,
      rounds: subs.filter((x) => x.s.generationId === g.id).map((x) => ({ round: x.s.roundNumber, status: x.s.status as 'pending' | 'approved' | 'revision_requested' })).sort((a, c) => a.round - c.round),
      isFinal: finalGen.has(g.id),
    })),
  }))
  return { sequences: seqs.map((s) => ({ id: s.id, title: s.title, number: s.number, displayOrder: s.displayOrder })), blocks }
}
