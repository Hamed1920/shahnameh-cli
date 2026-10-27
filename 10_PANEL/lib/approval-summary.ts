/** One human line per proposed action, for the approvals inbox. Pure. */

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

export function batchSummary(b: { batchId: string; name?: string | null; jobs: number; total: number | null }): string {
  const name = b.name && b.name !== b.batchId ? ` (${b.name})` : ''
  const price = b.total == null ? 'unpriced' : count(b.total, 'credit')
  return `Approve batch ${b.batchId}${name}: ${count(b.jobs, 'job')}, ${price}`
}

export function studioApproveSummary(p: { sessionId: string; genId: string; expectedTotal: number | null }): string {
  const price = p.expectedTotal == null ? 'unpriced' : count(p.expectedTotal, 'credit')
  return `Generate studio try ${p.genId} (session ${p.sessionId}): ${price}`
}

export function studioPickSummary(p: { hfJobId: string; take: string; entity?: string; name?: string }): string {
  const to = p.entity ? `as a look of ${p.entity}` : p.name ? `as new ${p.name}` : 'into the index'
  return `File studio result ${p.hfJobId}/${p.take} ${to}`
}

export function regenerateSummary(p: { jobId: string; decisionId?: string }): string {
  return `Regenerate job ${p.jobId}${p.decisionId ? ` (decision ${p.decisionId})` : ''}`
}
